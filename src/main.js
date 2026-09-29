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
 *     200px section spends its height on open work. The state travels with the
 *     list, so a re-render does not undo the reader's choice.
 *   - Priority is a 3px dot rather than a text label: it has to be visible at a
 *     glance without competing with the task text.
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

import { ensureInstalled, PLUGIN_DIR_PATH } from "./plugin-install.js"

const POLL_MS = 2000
const REQUEST_TIMEOUT_MS = 3000
const BOOT_WATCHDOG_MS = 1600
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

function paint(todos) {
  const top = el("top")
  const body = el("body")

  if (!todos.length) {
    top.dataset.empty = "true"
    body.innerHTML = '<div class="empty">No todos for this session.</div>'
    return
  }

  const done = todos.filter(isFinished).length
  const active = order(todos.filter((t) => !isFinished(t)))
  const finished = todos.filter(isFinished)

  top.dataset.empty = "false"
  el("count").textContent = `${done}/${todos.length}`
  top.querySelector("#bar > i").style.width = `${Math.round((done / todos.length) * 100)}%`

  let html = active.map(itemHtml).join("")

  if (finished.length) {
    const expanded = openFinished && finishedFor === sessionID
    html +=
      `<button id="fold" type="button" aria-expanded="${expanded}">` +
      `已完成 ${finished.length} 项</button>` +
      (expanded ? finished.map(itemHtml).join("") : "")
  }

  body.innerHTML = html

  const fold = el("fold")
  if (fold) {
    fold.hidden = false
    fold.addEventListener("click", () => {
      openFinished = !(openFinished && finishedFor === sessionID)
      finishedFor = sessionID
      paint(todos)
    })
  }
}

function paintMessage(text) {
  el("top").dataset.empty = "true"
  el("body").innerHTML = `<div class="empty">${esc(text)}</div>`
}

/**
 * One-time notice when this run had to place the plugin.
 *
 * Shown inside the section rather than as a toast: it explains why todos will
 * stay empty until the next message, which is exactly what the reader is
 * looking at. Nothing is written when the plugin is already current.
 */
function paintSetupNote(reason) {
  const top = el("top")
  const body = el("body")
  top.dataset.empty = "true"

  const lead =
    reason === "write-failed"
      ? "Could not install the OpenCode plugin."
      : "OpenCode plugin installed."

  const detail =
    reason === "write-failed"
      ? `The section stays empty until it is there. Install it by hand from <code>opencode-plugin/</code> in the repo.`
      : `Send any message in this session to start a fresh turn — it loads without a restart. Written to <code>${esc(PLUGIN_DIR_PATH)}</code>.`

  body.innerHTML = `<div class="empty"><b>${lead}</b><br>${detail}</div>`
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
    // missing or stale. Nothing here edits `opencode.json`.
    if (!installChecked) {
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
