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
const ROW_ENTER_MS = 180
const ROW_TOGGLE_MS = 220
const COMPLETION_STRIKE_MS = 180
const COMPLETION_FLIGHT_MS = 220
const TYPEWRITER_STEP_MS = 14
const MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
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
let refreshSequence = 0
let booted = false
/** The plugin install runs once per page load, not on every host refresh. */
let installChecked = false
let setupNote = ""
/** Reader's choice, kept per session so a re-render does not collapse it back. */
let openFinished = false
let finishedFor = null
let observedTaskSession = null
let previousTaskKeys = new Set()
const pendingTypewriterKeys = new Set()
const completedAtEnd = new Map()
let completionSequence = 0
let motionEpoch = 0
const completionTransitions = new Map()
const exitingRows = new Set()
const completionGhosts = new Set()
let suppressAnimationsForNextPaint = true

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

function statusMarkHtml(status) {
  if (status === "completed") return '<span class="tick"></span>'
  if (status === "in_progress") return '<span class="dot"></span>'
  if (status === "cancelled") return '<span class="dash"></span>'
  return ""
}

function textHtml(content, typing) {
  if (!typing) return `<span class="txt">${esc(content)}</span>`

  const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null
  const characters = segmenter
    ? Array.from(segmenter.segment(content), (part) => part.segment)
    : Array.from(content)
  const chars = characters.map((character, index) =>
    `<span class="type-char" aria-hidden="true" style="--type-delay:${Math.min(index * TYPEWRITER_STEP_MS, 2200)}ms">${esc(character)}</span>`,
  ).join("")

  return `<span class="txt typewriter" role="text" aria-label="${esc(content)}">${chars}</span>`
}

function itemHtml(todo, key, typing = false) {
  const mark = PRIORITY_MARK[todo.priority] || ""
  const pri = mark ? `<span class="pri ${PRIORITY_CLASS[todo.priority] || ""}">${mark}</span>` : ""

  return (
    `<div class="item ${esc(todo.status)}" data-row-key="${esc(key)}" data-status="${esc(todo.status)}">` +
    `<span class="box">${statusMarkHtml(todo.status)}</span>` +
    `${textHtml(todo.content, typing)}${pri}</div>`
  )
}

/** Rows for the current list: open work in order, then the finished fold. */
function buildRows(list) {
  const occurrences = new Map()
  const keyByTodo = new Map()
  for (const todo of list) {
    const occurrence = occurrences.get(todo.content) || 0
    occurrences.set(todo.content, occurrence + 1)
    keyByTodo.set(todo, `item:${JSON.stringify([todo.content, occurrence])}`)
  }

  const open = order(list.filter((todo) => !isFinished(todo)))
  const finished = list.filter(isFinished).sort((a, b) => {
    const aOrder = completedAtEnd.get(keyByTodo.get(a))
    const bOrder = completedAtEnd.get(keyByTodo.get(b))
    if (aOrder === undefined && bOrder === undefined) return 0
    if (aOrder === undefined) return -1
    if (bOrder === undefined) return 1
    return aOrder - bOrder
  })
  const rows = open.map((todo) => ({ kind: "item", status: todo.status, key: keyByTodo.get(todo), todo }))

  if (finished.length) {
    const expanded = openFinished && finishedFor === sessionID
    rows.push({ kind: "fold", status: "fold", key: "fold", count: finished.length, expanded })
    if (expanded) {
      for (const todo of finished) {
        rows.push({ kind: "item", status: todo.status, key: keyByTodo.get(todo), todo })
      }
    }
  }

  return rows
}

function rowHtml(row, typing = false) {
  if (row.kind === "fold") {
    return `<button class="fold" type="button" data-row-key="fold" data-count="${row.count}" aria-expanded="${row.expanded}">已完成 ${row.count} 项</button>`
  }
  return itemHtml(row.todo, row.key, typing)
}

function createRowNode(row, typing = false) {
  const template = document.createElement("template")
  template.innerHTML = rowHtml(row, typing)
  return template.content.firstElementChild
}

function updateRowNode(node, row, animateStatus = true) {
  if (row.kind === "fold") {
    const expanded = String(row.expanded)
    if (node.getAttribute("aria-expanded") !== expanded) node.setAttribute("aria-expanded", expanded)
    const count = String(row.count)
    if (node.dataset.count !== count) {
      node.dataset.count = count
      node.textContent = `已完成 ${row.count} 项`
    }
    return
  }

  const todo = row.todo
  const previousStatus = node.dataset.status
  if (node.dataset.rowKey !== row.key) node.dataset.rowKey = row.key
  if (previousStatus !== todo.status) {
    node.dataset.status = todo.status
    node.className = `item ${todo.status}`
    node.removeAttribute("data-completion-phase")
  }
  const text = node.querySelector(".txt")
  if (text.textContent !== todo.content) text.textContent = todo.content

  if (previousStatus !== todo.status) {
    const box = node.querySelector(".box")
    box.innerHTML = statusMarkHtml(todo.status)
    if (animateStatus && todo.status === "completed" && !reducedMotion()) {
      const tick = box.querySelector(".tick")
      if (tick) {
        node.classList.add("just-completed")
        tick.addEventListener("animationend", () => node.classList.remove("just-completed"), { once: true })
      }
    }
  }

  const mark = PRIORITY_MARK[todo.priority] || ""
  let priority = node.querySelector(".pri")
  if (!mark) {
    priority?.remove()
  } else {
    if (!priority) {
      priority = document.createElement("span")
      node.append(priority)
    }
    const className = `pri ${PRIORITY_CLASS[todo.priority] || ""}`
    if (priority.className !== className) priority.className = className
    if (priority.textContent !== mark) priority.textContent = mark
  }
}

function taskKeys(list) {
  const occurrences = new Map()
  return new Set(list.map((todo) => {
    const occurrence = occurrences.get(todo.content) || 0
    occurrences.set(todo.content, occurrence + 1)
    return `item:${JSON.stringify([todo.content, occurrence])}`
  }))
}

function rememberTaskKeys(list) {
  const current = taskKeys(list)
  if (observedTaskSession === sessionID) {
    for (const key of current) {
      if (!previousTaskKeys.has(key)) pendingTypewriterKeys.add(key)
    }
  } else {
    pendingTypewriterKeys.clear()
  }
  for (const key of pendingTypewriterKeys) {
    if (!current.has(key)) pendingTypewriterKeys.delete(key)
  }
  for (const key of completedAtEnd.keys()) {
    if (!current.has(key)) completedAtEnd.delete(key)
  }
  previousTaskKeys = current
  observedTaskSession = sessionID
  return pendingTypewriterKeys
}

function cancelRowAnimations() {
  motionEpoch += 1
  const body = el("body")
  for (const animation of body.getAnimations({ subtree: true })) animation.cancel()
  for (const node of body.querySelectorAll(".just-completed")) node.classList.remove("just-completed")

  for (const { node, row } of completionTransitions.values()) {
    completedAtEnd.set(row.key, ++completionSequence)
    node.querySelector(".strike-sweep")?.remove()
    node.classList.remove("completion-marking")
    node.removeAttribute("data-completion-phase")
    if (node.isConnected) updateRowNode(node, row, false)
  }
  completionTransitions.clear()

  for (const node of exitingRows) {
    node.classList.remove("row-exiting")
    node.removeAttribute("data-exiting")
  }
  exitingRows.clear()

  for (const ghost of completionGhosts) ghost.remove()
  completionGhosts.clear()
}

function animateRow(node, from, to, duration, onFinish) {
  const epoch = motionEpoch
  const animation = node.animate([from, to], {
    duration,
    easing: MOTION_EASING,
    fill: "both",
  })
  animation.finished.then(() => {
    animation.cancel()
    if (epoch === motionEpoch && onFinish) onFinish()
  }, () => {})
  return animation
}

function animateRowEnter(node) {
  const height = node.getBoundingClientRect().height
  const style = getComputedStyle(node)
  animateRow(node,
    { height: "0px", opacity: 0, transform: "translateY(-4px)", paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" },
    { height: `${height}px`, opacity: 1, transform: "translateY(0)", paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, overflow: "hidden" },
    ROW_TOGGLE_MS,
  )
}

function animateRowExit(node, epoch) {
  const height = node.getBoundingClientRect().height
  const style = getComputedStyle(node)
  node.classList.add("row-exiting")
  node.dataset.exiting = "true"
  exitingRows.add(node)
  const animation = node.animate([
    { height: `${height}px`, opacity: 1, transform: "translateY(0)", paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, overflow: "hidden" },
    { height: "0px", opacity: 0, transform: "translateY(-4px)", paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" },
  ], { duration: ROW_TOGGLE_MS, easing: MOTION_EASING, fill: "both" })
  animation.finished.then(() => {
    animation.cancel()
    if (epoch !== motionEpoch) return
    exitingRows.delete(node)
    node.remove()
    if (exitingRows.size === 0) applyListHeight(true)
  }, () => {})
}

function completionGhost(body, source, row) {
  const sourceRect = source.getBoundingClientRect()
  const bodyRect = body.getBoundingClientRect()
  const ghost = source.cloneNode(true)
  updateRowNode(ghost, row, false)
  ghost.classList.add("completion-ghost")
  ghost.removeAttribute("data-row-key")
  ghost.dataset.motionOnly = "true"
  ghost.setAttribute("aria-hidden", "true")
  ghost.inert = true
  ghost.style.position = "absolute"
  ghost.style.left = `${sourceRect.left - bodyRect.left + body.scrollLeft}px`
  ghost.style.top = `${sourceRect.top - bodyRect.top + body.scrollTop}px`
  ghost.style.width = `${sourceRect.width}px`
  ghost.style.height = `${sourceRect.height}px`
  ghost.style.margin = "0"
  ghost.style.zIndex = "2"
  ghost.style.pointerEvents = "none"
  body.append(ghost)
  completionGhosts.add(ghost)
  return { ghost, sourceRect }
}

function animateCompletionGhosts(body, ghosts) {
  const fold = Array.from(body.children).find((node) => node.dataset.rowKey === "fold")
  if (!fold) {
    for (const { ghost } of ghosts) {
      completionGhosts.delete(ghost)
      ghost.remove()
    }
    return
  }

  const target = fold.getBoundingClientRect()
  for (const { ghost, sourceRect } of ghosts) {
    const deltaX = target.left - sourceRect.left
    const deltaY = target.top - sourceRect.top
    animateRow(ghost,
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${deltaX}px, ${deltaY}px) scale(.82)`, opacity: 0 },
      COMPLETION_FLIGHT_MS,
      () => {
        completionGhosts.delete(ghost)
        ghost.remove()
      },
    )
  }
}

function finishCompletionTransitions(entries, animateStructure) {
  const epoch = motionEpoch
  const animations = entries.map(({ node, row }) => {
    completionTransitions.set(row.key, { node, row })
    node.classList.add("completion-marking")
    node.dataset.completionPhase = "strike"
    const sweep = document.createElement("span")
    sweep.className = "strike-sweep"
    sweep.setAttribute("aria-hidden", "true")
    node.querySelector(".txt").append(sweep)
    return sweep.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: COMPLETION_STRIKE_MS, easing: "linear", fill: "both" },
    )
  })

  Promise.all(animations.map((animation) => animation.finished.catch(() => null))).then(() => {
    for (const animation of animations) animation.cancel()
    if (epoch !== motionEpoch) return

    for (const { node, row } of entries) {
      completedAtEnd.set(row.key, ++completionSequence)
      completionTransitions.delete(row.key)
      node.querySelector(".strike-sweep")?.remove()
      node.classList.remove("completion-marking")
      node.removeAttribute("data-completion-phase")
    }

    const foldCollapsed = !(openFinished && finishedFor === sessionID)
    const ghostRows = foldCollapsed
      ? new Map(entries.map(({ row }) => [row.key, row]))
      : new Map()
    const result = reconcileRows(buildRows(painted), {
      animate: animateStructure,
      newTaskKeys: pendingTypewriterKeys,
      skipCompletionDetection: true,
      ghostRows,
    })
    applyListHeight(result.entering.length > 0)
  })
}

function reconcileRows(rows, options = {}) {
  const body = el("body")
  const animate = options.animate !== false && !reducedMotion()
  const previous = Array.from(body.children).filter((node) => node.dataset.motionOnly !== "true")
  const byKey = new Map(previous.filter((node) => node.dataset.rowKey).map((node) => [node.dataset.rowKey, node]))

  if (animate && !options.skipCompletionDetection) {
    const occurrences = new Map()
    const completing = painted
      .filter((todo) => todo.status === "completed")
      .map((todo) => {
        const occurrence = occurrences.get(todo.content) || 0
        occurrences.set(todo.content, occurrence + 1)
        const row = { kind: "item", status: todo.status, key: `item:${JSON.stringify([todo.content, occurrence])}`, todo }
        return { node: byKey.get(row.key), row }
      })
      .filter(({ node }) => node && node.dataset.status !== "completed")
    if (completing.length) {
      finishCompletionTransitions(completing, animate)
      return { staged: true, entering: [] }
    }
  }

  const firstTops = new Map(previous.map((node) => [node, node.getBoundingClientRect().top]))
  const used = new Set()
  const entering = []
  let cursor = body.firstElementChild
  while (cursor && cursor.dataset.motionOnly === "true") cursor = cursor.nextElementSibling

  for (const row of rows) {
    let node = byKey.get(row.key)
    if (node) {
      updateRowNode(node, row)
    } else {
      const isNewTask = row.kind === "item" && options.newTaskKeys?.has(row.key)
      node = createRowNode(row, isNewTask && animate)
      if (isNewTask) pendingTypewriterKeys.delete(row.key)
      entering.push(node)
    }
    used.add(node)

    if (node !== cursor) body.insertBefore(node, cursor)
    else cursor = cursor.nextElementSibling
    while (cursor && cursor.dataset.motionOnly === "true") cursor = cursor.nextElementSibling
  }

  const ghosts = []
  const epoch = motionEpoch
  for (const node of previous) {
    if (used.has(node)) continue
    const ghostRow = options.ghostRows?.get(node.dataset.rowKey)
    if (ghostRow) {
      ghosts.push(completionGhost(body, node, ghostRow))
      node.remove()
    } else if (animate) {
      animateRowExit(node, epoch)
    } else {
      node.remove()
    }
  }

  if (ghosts.length) animateCompletionGhosts(body, ghosts)
  animateRows(body, firstTops, entering, previous.some((node) => node.dataset.rowKey), used, animate)
  return { staged: false, entering }
}

function animateRows(body, firstTops, entering, hadRows, used, animate) {
  if (!animate || reducedMotion()) return

  for (const [node, firstTop] of firstTops) {
    if (!used.has(node) || !node.isConnected) continue
    const deltaY = firstTop - node.getBoundingClientRect().top
    if (Math.abs(deltaY) < 1) continue
    animateRow(node,
      { transform: `translateY(${deltaY}px)` },
      { transform: "translateY(0)" },
      ROW_ENTER_MS,
    )
  }

  if (hadRows && entering.length > 0) {
    const epoch = motionEpoch
    requestAnimationFrame(() => {
      if (epoch !== motionEpoch || reducedMotion()) return
      for (const node of entering) {
        if (node.isConnected) animateRowEnter(node)
      }
    })
  }
}

/** The rows currently in the list — the scroll container's own children. */
const rowNodes = () => Array.from(el("body").children)
  .filter((node) => node.dataset.motionOnly !== "true")

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
function applyHeight(height, immediate = false) {
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
  }, first || immediate ? 0 : HEIGHT_SETTLE_MS)
}

function applyListHeight(immediate = false) {
  const top = el("top")
  applyHeight(frameHeight(top.offsetHeight || 22), immediate)
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
  const starts = rowNodes().map((node) => node.offsetTop)
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
  cancelRowAnimations()
  if (!todos.length) {
    rememberTaskKeys(todos)
    paintPlain('<div class="empty">No todos for this session.</div>')
    return
  }

  painted = todos
  const newTaskKeys = rememberTaskKeys(todos)
  const animate = !suppressAnimationsForNextPaint
  suppressAnimationsForNextPaint = false
  el("root").dataset.mode = "work"

  const top = el("top")
  const done = todos.filter(isFinished).length
  top.dataset.empty = "false"
  el("count").textContent = `${done}/${todos.length}`
  top.querySelector("#bar > i").style.transform = `scaleX(${done / todos.length})`

  const result = reconcileRows(buildRows(todos), { animate, newTaskKeys })
  if (!result.staged) applyListHeight(result.entering.length > 0)
}

/**
 * Message-only states — empty list, no session, errors, the setup note.
 *
 * Rendered with the body content-sized (`#root[data-mode="empty"]`), so the
 * body's own height is the honest answer for how tall the section should be:
 * there is no list and no scroll to feed back into the measurement.
 */
function paintPlain(html) {
  cancelRowAnimations()
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
  if (!sessionID) {
    refreshSequence += 1
    paintMessage("No session.")
    return
  }

  const sequence = ++refreshSequence
  const requestedSessionID = sessionID
  const isCurrent = () => sequence === refreshSequence && requestedSessionID === sessionID
  let content
  try {
    const result = await host.readFile(file(requestedSessionID))
    content = result && result.content
  } catch (error) {
    if (!isCurrent()) return
    const code = error && error.code
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
    // Nothing to read. The install notice explains a panel that is empty
    // because the plugin was just placed and has not written a list yet — it
    // never masks a list that does exist, so a version bump that rewrites the
    // plugin cannot hide the todos behind the notice until a reload.
    if (setupNote) {
      paintSetupNote(setupNote)
      return
    }
    paintMessage(code === "NOT_FOUND" ? "No todos for this session." : "Could not read todos.")
    return
  }

  if (!isCurrent()) return
  const todos = parse(content)
  if (todos === null) {
    paintMessage("Todo list is not valid JSON.")
    return
  }

  // Skip the DOM write when nothing changed, so a poll does not disturb
  // scrolling or the finished-group toggle.
  const key = JSON.stringify([requestedSessionID, todos, openFinished])
  if (key === lastKey) return
  lastKey = key
  paint(todos)
}

function start() {
  if (timer !== null) return
  timer = setInterval(() => { void refresh() }, POLL_MS)
}

function stop() {
  refreshSequence += 1
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
      cancelRowAnimations()
      sessionID = next
      lastKey = ""
      openFinished = false
      finishedFor = null
      observedTaskSession = null
      previousTaskKeys.clear()
      pendingTypewriterKeys.clear()
      completedAtEnd.clear()
      completionSequence = 0
      suppressAnimationsForNextPaint = true
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

  host.onSession((session) => {
    const next = session && typeof session.id === "string" ? session.id : null
    if (next !== sessionID) {
      cancelRowAnimations()
      sessionID = next
      openFinished = false
      finishedFor = null
      observedTaskSession = null
      previousTaskKeys.clear()
      pendingTypewriterKeys.clear()
      completedAtEnd.clear()
      completionSequence = 0
      suppressAnimationsForNextPaint = true
    }
    lastKey = ""
    void refresh()
  })
}

boot()
