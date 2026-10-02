/**
 * Todos — OpenChamber Work Status section.
 *
 * Reads the per-session todo file that the companion OpenCode plugin writes and
 * renders it as a checklist in OpenChamber's Work Status panel.
 *
 * Data path (read-only from this side):
 *   ~/.config/openchamber/todos/<sessionID>.json
 *   { sessionID, todos: [{ content, status, priority? }], updatedAt }
 *
 * Presentation choices, and why:
 *   - Work in progress is pinned above pending items. The open list is what the
 *     reader cares about, and a long tail of pending work should not push the
 *     active item out of view.
 *   - Finished items collapse into one summary row that expands on click, so the
 *     section spends its height on open work. The state travels with the
 *     list, so a re-render does not undo the reader's choice.
 *   - Priority is a 3px dot rather than a text label: it has to be visible at a
 *     glance without competing with the task text.
 *   - The section is sized to its content, up to the host's 320px ceiling
 *     (`src/viewport.js` owns the bounds and the arithmetic). The height is
 *     *measured* from the rows it is about to show rather than estimated from a
 *     row count, because a row is only approximately the same height as the
 *     next — the finished-group row is a control, and a long task name wraps.
 *   - Past that ceiling the list is an ordinary native scroll container: wheel,
 *     keyboard, touch and the scrollbar all belong to the browser, and the
 *     section never intercepts them. A scroll rests on a row boundary, or on the
 *     bottom, so the last row stays reachable; ten seconds after the reader's
 *     own last scroll the list returns to the top.
 *
 * Notes on the host contract (checked against @openchamber/sdk 2.0.4):
 *   - `applyHostReady` lives at the `@openchamber/sdk/ui` entrypoint and is what
 *     writes the `--oc-*` variables onto the frame root. Without it the page has
 *     no host colours or font. `onReady` fires again on every host refresh, so
 *     the theme is re-applied each time.
 *   - `connectHost` throws only when there is no `window`; inside a plain tab it
 *     returns a client whose calls reject. Readiness travels by postMessage, so
 *     a frame with no host would otherwise sit on "Loading…" forever. Hence the
 *     boot watchdog and the no-parent check below.
 */

import { connectHost } from "@openchamber/sdk"
import { applyHostReady } from "@openchamber/sdk/ui"

import {
  clamp,
  clampScroll,
  MAX_H,
  MIN_H,
  nearestIndex,
} from "./viewport.js"
import { ensureInstalled, PLUGIN_DIR_PATH } from "./plugin-install.js"

const POLL_MS = 2000
const REQUEST_TIMEOUT_MS = 3000
const BOOT_WATCHDOG_MS = 1600
/** The height in `package.json`. The first paint is exempt from the delta gate. */
const MANIFEST_H = 56
/**
 * Injected by the build. The shipped build (`scripts/build.ts`) sets it false.
 * The UI-only test build (`scripts/build-test-extension.ts`) sets it true: that
 * package renders the list and nothing else, reading what the stable
 * extension's OpenCode plugin already mirrors, and never touches OpenCode.
 */
const UI_ONLY = typeof __TODO_BRIDGE_UI_ONLY__ === "boolean" ? __TODO_BRIDGE_UI_ONLY__ : false
/** A reader idle this long is returned to the top of the list. */
const IDLE_MS = 10000
/** Scroll this long settles before snapping to a row start. */
const SNAP_QUIET_MS = 110
/** A height change smaller than this is not worth a round trip to the host. */
const HEIGHT_DELTA = 8
/** Coalescing window, so a burst of height changes settles into one resize. */
const HEIGHT_SETTLE_MS = 150
const STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"])
const PRIORITY_CLASS = { high: "high", medium: "medium", low: "low" }
/** Rising mark: one chevron for medium, two for high, a dot for ordinary work. */
const PRIORITY_MARK = {
  high: "⌃⌃",
  medium: "⌃",
  low: "·",
}

const el = (id) => document.getElementById(id)

let host = null
let sessionID = null
let timer = null
let lastKey = ""
let booted = false
/** The plugin install runs once per page load, not on every host refresh. */
let installChecked = false
let setupNote = ""
/** Reader's choice, kept per session so a re-render does not collapse it back. */
let openFinished = false
let finishedFor = null

// ---- height and scroll state ----
/** The list as last painted, so a fold click can relayout without a file read. */
let painted = []
/** Last height handed to the host, and the pending coalesced change to it. */
let lastHeight = MANIFEST_H
let heightTimer = null
let idleTimer = null
let snapTimer = null

function file(sessionID) {
  return `~/.config/openchamber/todos/${sessionID}.json`
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ))
}

/** Defensive read: the file is written by another process and may be partial. */
function parse(content) {
  let data
  try {
    data = JSON.parse(content)
  } catch {
    return null
  }
  const raw = data && Array.isArray(data.todos) ? data.todos : []
  const todos = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue
    const text = typeof entry.content === "string" ? entry.content.trim() : ""
    if (!text) continue
    if (!STATUSES.has(entry.status)) continue
    todos.push({
      content: text,
      status: entry.status,
      priority: typeof entry.priority === "string" ? entry.priority : "",
    })
  }
  return todos
}

const isFinished = (t) => t.status === "completed" || t.status === "cancelled"

/** Work in progress first, then pending, then whatever order they arrived in. */
function order(list) {
  const rank = { in_progress: 0, pending: 1 }
  return list
    .map((todo, index) => ({ todo, index }))
    .sort((a, b) => {
      const ra = rank[a.todo.status] ?? 9
      const rb = rank[b.todo.status] ?? 9
      return ra === rb ? a.index - b.index : ra - rb
    })
    .map((entry) => entry.todo)
}

function itemHtml(todo) {
  const mark = PRIORITY_MARK[todo.priority] || ""
  const pri = mark ? `<span class="pri ${PRIORITY_CLASS[todo.priority] || ""}">${mark}</span>` : ""
  let box = '<span class="box"></span>'
  if (todo.status === "completed") box = '<span class="box"><span class="tick"></span></span>'
  else if (todo.status === "in_progress") box = '<span class="box"><span class="dot"></span></span>'
  else if (todo.status === "cancelled") box = '<span class="box"><span class="dash"></span></span>'

  return (
    `<div class="item ${esc(todo.status)}">` +
    box +
    `<span class="txt">${esc(todo.content)}</span>${pri}</div>`
  )
}

/** Rows for the current list: open work in order, then the finished fold. */
function buildRows(list) {
  const open = order(list.filter((todo) => !isFinished(todo)))
  const finished = list.filter(isFinished)
  const rows = open.map((todo) => ({ kind: "item", status: todo.status, key: todo.content, todo }))

  if (finished.length) {
    const expanded = openFinished && finishedFor === sessionID
    rows.push({ kind: "fold", status: "fold", key: "fold", count: finished.length, expanded })
    if (expanded) {
      for (const todo of finished) {
        rows.push({ kind: "item", status: todo.status, key: todo.content, todo })
      }
    }
  }

  return rows
}

function rowHtml(row) {
  if (row.kind === "fold") {
    return `<button class="fold" type="button" aria-expanded="${row.expanded}">已完成 ${row.count} 项</button>`
  }
  return itemHtml(row.todo)
}

/** The rows currently in the list — the scroll container's own children. */
const rowNodes = () => Array.from(el("body").children)

/** Whether the list is taller than the space the frame gives it. */
function canScroll() {
  const body = el("body")
  return body.scrollHeight > body.clientHeight + 1
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** Honour the reader's motion preference; otherwise animate. */
const smooth = () => (reducedMotion() ? "auto" : "smooth")

/**
 * The height the section wants: the whole list, measured, up to the host's cap.
 *
 * `offsetTop + offsetHeight` of the last row rather than the sum of the rows'
 * heights: a row can carry a top margin (the fold has 4px), and that gap is part
 * of the space the rows need. A sum of border-box heights would miss it.
 *
 * The frame is elastic — it grows to fit every todo and only stops at the host's
 * 320px ceiling, past which the list scrolls. Capping at a fixed row count
 * instead clipped a tall (multi-line) last row even when there was room to show
 * it whole.
 */
function frameHeight(headerH) {
  const rows = rowNodes()
  if (rows.length === 0) return MIN_H
  const last = rows[rows.length - 1]
  const content = last.offsetTop + last.offsetHeight
  return clamp(headerH + Math.round(content) + bodyPadding(), MIN_H, MAX_H)
}

/**
 * The height the section wants, coalesced and gated.
 *
 * Both thresholds are about what the reader sees rather than about the number:
 * a change under `HEIGHT_DELTA` is a resize nobody can see, and a burst inside
 * `HEIGHT_SETTLE_MS` is one resize. The first paint is exempt from both — the
 * frame still carries the manifest's height then, and holding an 8px gate would
 * leave it visibly wrong for as long as the gate holds.
 */
function applyHeight(height) {
  const wanted = clamp(height, MIN_H, MAX_H)
  if (wanted === lastHeight) return

  const first = lastHeight === MANIFEST_H
  if (!first && Math.abs(wanted - lastHeight) < HEIGHT_DELTA) return

  clearTimeout(heightTimer)
  heightTimer = setTimeout(() => {
    heightTimer = null
    if (wanted === lastHeight) return
    lastHeight = wanted
    try {
      // An async rejection is the host going away mid-flight; it is not worth
      // un-remembering the height we asked for. A synchronous throw means there
      // is no `setHeight` at all, so nothing was asked for.
      if (host) void host.setHeight(wanted).catch(() => {})
    } catch {
      lastHeight = MANIFEST_H
    }
  }, first ? 0 : HEIGHT_SETTLE_MS)
}

/**
 * Snap a rested scroll to a row boundary, or to the bottom.
 *
 * The gap the browser leaves between the scroll settling and this running is
 * what makes it feel like a settle rather than a fight: a scroll still in
 * progress keeps re-arming the timer.
 *
 * The bottom is a resting place in its own right. Snapping only to row starts
 * meant the last row, whose start sits *above* the maximum scroll, could never
 * be reached — every attempt to scroll to the end sprang back up to that row's
 * top. So both are candidates and the nearer one wins; at the bottom the last
 * row is fully visible.
 */
function snap() {
  snapTimer = null
  const body = el("body")
  const max = body.scrollHeight - body.clientHeight
  if (max <= 0) return
  const here = body.scrollTop
  const starts = Array.from(body.children).map((node) => node.offsetTop)
  const rowTarget = clampScroll(starts[nearestIndex(here, starts)], max)
  const target = Math.max(0, max - here) < Math.abs(rowTarget - here) ? max : rowTarget
  if (Math.abs(target - here) < 1) return
  body.scrollTo({ top: target, behavior: smooth() })
}

/**
 * Return to the top of the list.
 *
 * The in-progress item is always first (`order` pins it), so "where the work
 * is" is simply the top. `<= 1` rather than `<= 0`: a smooth scroll can settle a
 * fraction short of zero, and treating that as "not home yet" made the return
 * fire again every ten seconds forever. Landing home is final — it does not
 * re-arm.
 */
function returnToWork() {
  idleTimer = null
  const body = el("body")
  if (body.scrollTop <= 1) return
  body.scrollTo({ top: 0, behavior: smooth() })
}

function clearIdle() {
  if (idleTimer === null) return
  clearTimeout(idleTimer)
  idleTimer = null
}

/**
 * Arm the idle return — from the reader's own scrolling, and nothing else.
 *
 * The scroll event used to arm it, which was wrong twice over: the snap and the
 * return itself scroll the container, so each one re-armed the timer (the
 * return fired again every ten seconds), and a poll-driven repaint could too.
 * Only a real input counts now.
 */
function armIdle() {
  clearIdle()
  if (!canScroll()) return
  idleTimer = setTimeout(returnToWork, IDLE_MS)
}

/** Keys the browser scrolls a focused box with; arming on them is not intercepting them. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "])

/**
 * Input: the fold click, the settle snap, and the signals that arm the idle
 * return.
 *
 * Everything here is passive or non-prevented, so wheel, touch, arrow keys,
 * PageUp/PageDown and the scrollbar all stay the browser's native scroll
 * handling on the `overflow-y: auto` body — a short list never takes the rail's
 * wheel. The extra listeners only mark "the reader scrolled"; they never move
 * the list or cancel an event.
 */
function wireInput() {
  const body = el("body")
  /** A drag on the list or its bar: the one manual scroll that fires no wheel. */
  let pointerDown = false

  body.addEventListener("click", (event) => {
    const fold = event.target instanceof Element ? event.target.closest(".fold") : null
    if (!fold) return
    openFinished = !(openFinished && finishedFor === sessionID)
    finishedFor = sessionID
    // The poll's key carries the fold state; clear it so the next read repaints.
    lastKey = ""
    if (painted.length) paint(painted)
  })

  body.addEventListener("scroll", () => {
    // A drag scrolls the container without a wheel event; the pointer being down
    // is what distinguishes it from our own snap/return scrolls.
    if (pointerDown) armIdle()
    clearTimeout(snapTimer)
    snapTimer = setTimeout(snap, SNAP_QUIET_MS)
  }, { passive: true })

  body.addEventListener("wheel", armIdle, { passive: true })
  body.addEventListener("touchmove", armIdle, { passive: true })
  body.addEventListener("keydown", (event) => {
    if (SCROLL_KEYS.has(event.key)) armIdle()
  })
  body.addEventListener("pointerdown", () => { pointerDown = true })
  // Clear on every way a drag can end, including one released outside the frame:
  // a flag stuck true would let the snap's own scroll re-arm the idle return.
  const releaseDrag = () => { pointerDown = false }
  window.addEventListener("pointerup", releaseDrag)
  window.addEventListener("pointercancel", releaseDrag)
  window.addEventListener("blur", releaseDrag)
}

/** Padding the body carries around the list, from its own stylesheet. */
function bodyPadding() {
  const style = getComputedStyle(el("body"))
  return Math.round((parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0))
}

function paint(todos) {
  if (!todos.length) {
    paintPlain('<div class="empty">No todos for this session.</div>')
    return
  }

  painted = todos
  el("root").dataset.mode = "work"

  const top = el("top")
  const done = todos.filter(isFinished).length
  top.dataset.empty = "false"
  el("count").textContent = `${done}/${todos.length}`
  top.querySelector("#bar > i").style.width = `${Math.round((done / todos.length) * 100)}%`

  // One replacement for the whole list. The scroll container keeps its
  // `scrollTop` across the swap, so a poll that changes a row does not move the
  // reader. The height is measured from what just rendered.
  el("body").innerHTML = buildRows(todos).map(rowHtml).join("")
  applyHeight(frameHeight(top.offsetHeight || 22))
}

/**
 * Message-only states — empty list, no session, errors, the setup note.
 *
 * Rendered with the body content-sized (`#root[data-mode="empty"]`), so the
 * body's own height is the honest answer for how tall the section should be:
 * there is no list and no scroll to feed back into the measurement.
 */
function paintPlain(html) {
  painted = []
  clearIdle()
  clearTimeout(snapTimer)
  snapTimer = null
  clearTimeout(heightTimer)
  heightTimer = null

  el("root").dataset.mode = "empty"
  el("top").dataset.empty = "true"
  el("body").innerHTML = html
  el("body").scrollTop = 0

  applyHeight(Math.max(MIN_H, Math.round(el("body").offsetHeight)))
}

function paintMessage(text) {
  paintPlain(`<div class="empty">${esc(text)}</div>`)
}

/**
 * One-time notice when this run had to place the plugin.
 *
 * Shown inside the section rather than as a toast: it explains why todos will
 * stay empty until the next message, which is exactly what the reader is
 * looking at. Nothing is written when the plugin is already current.
 */
function paintSetupNote(reason) {
  const lead =
    reason === "write-failed"
      ? "Could not install the OpenCode plugin."
      : "OpenCode plugin installed."

  const detail =
    reason === "write-failed"
      ? `The section stays empty until it is there. Install it by hand from <code>opencode-plugin/</code> in the repo.`
      : `Send any message in this session to start a fresh turn — it loads without a restart. Written to <code>${esc(PLUGIN_DIR_PATH)}</code>.`

  paintPlain(`<div class="empty"><b>${lead}</b><br>${detail}</div>`)
}

async function refresh() {
  if (!host) return
  // The install notice explains an empty panel, so it takes precedence over the
  // file read until the reader does something.
  if (setupNote) {
    paintSetupNote(setupNote)
    return
  }
  if (!sessionID) {
    paintMessage("No session.")
    return
  }

  let content
  try {
    const result = await host.readFile(file(sessionID))
    content = result && result.content
  } catch (error) {
    const code = error && error.code
    if (code === "NOT_FOUND") {
      paintMessage("No todos for this session.")
      return
    }
    if (code === "NOT_GRANTED") {
      paintMessage("This section was not allowed to read the todo file.")
      stop()
      return
    }
    if (code === "DISABLED" || code === "HOST_UNAVAILABLE") {
      paintMessage("Todo data is not available.")
      stop()
      return
    }
    if (error instanceof Error && error.name === "TypeError") {
      // postMessage structure rejected by the frame policy, not a data problem.
      paintMessage("This OpenChamber build does not support reading the todo file.")
      stop()
      return
    }
    paintMessage("Could not read todos.")
    return
  }

  const todos = parse(content)
  if (todos === null) {
    paintMessage("Todo list is not valid JSON.")
    return
  }

  // Skip the DOM write when nothing changed, so a poll does not disturb
  // scrolling or the finished-group toggle.
  const key = sessionID + "\u0000" + (content || "") + "\u0000" + String(openFinished)
  if (key === lastKey) return
  lastKey = key
  paint(todos)
}

function start() {
  if (timer !== null) return
  timer = setInterval(() => { void refresh() }, POLL_MS)
}

function stop() {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

/** The iframe's parent is OpenChamber; a top-level tab has itself as parent. */
function insideHostFrame() {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

function boot() {
  // Not framed: there is no host to talk to, so say so instead of waiting.
  if (!insideHostFrame()) {
    paintMessage("Open this inside OpenChamber to see todos.")
    return
  }

  const watchdog = setTimeout(() => {
    if (booted) return
    paintMessage("Connecting to OpenChamber…")
  }, BOOT_WATCHDOG_MS)

  try {
    host = connectHost({ requestTimeoutMs: REQUEST_TIMEOUT_MS })
  } catch (error) {
    clearTimeout(watchdog)
    paintMessage(error && error.code === "HOST_UNAVAILABLE"
      ? "Open this inside OpenChamber to see todos."
      : "Could not connect to OpenChamber.")
    return
  }

  // Registered once, on `#body`, so a repaint that replaces the rows does not
  // take the handlers with it.
  wireInput()

  host.onReady((ctx) => {
    if (!booted) {
      booted = true
      clearTimeout(watchdog)
    }
    // Writes the host's `--oc-*` variables, font, size and `data-oc-surface`
    // onto the frame root. Runs on every refresh so theme changes follow.
    applyHostReady(ctx, document.documentElement)

    const next = ctx && ctx.session && typeof ctx.session.id === "string" ? ctx.session.id : null
    if (next !== sessionID) {
      sessionID = next
      lastKey = ""
      openFinished = false
      finishedFor = null
    }

    // Place the OpenCode plugin if this run is the first one, then render.
    // It only runs once per page load, and only writes when the copy on disk is
    // missing or stale. Nothing here edits `opencode.json`. The UI-only build
    // skips this entirely: it has no plugin half and reads the mirror the
    // stable extension's plugin writes.
    if (!installChecked && !UI_ONLY) {
      installChecked = true
      void ensureInstalled(host)
        .then((outcome) => {
          if (outcome.ok && outcome.reason === "current") return
          const failed = !outcome.ok || String(outcome.reason).startsWith("write-failed")
          setupNote = failed ? "write-failed" : outcome.reason
          lastKey = ""
        })
        .catch(() => {
          setupNote = "write-failed"
          lastKey = ""
        })
        .finally(() => {
          void refresh()
          start()
        })
      return
    }

    void refresh()
    start()
  })

  host.onSession(() => {
    lastKey = ""
    void refresh()
  })
}

boot()
