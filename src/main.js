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
 * The section is loaded only while the panel is visible and this section is
 * expanded, so a light poll is enough; it is cleared on teardown.
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

const POLL_MS = 2000
const REQUEST_TIMEOUT_MS = 3000
const BOOT_WATCHDOG_MS = 1600
const MARK = { pending: "[ ]", in_progress: "[•]", completed: "[x]", cancelled: "[-]" }
const STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"])

const el = (id) => document.getElementById(id)

let host = null
let sessionID = null
let timer = null
let lastKey = ""
let booted = false

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

function paint(todos) {
  const head = el("head")
  const body = el("body")

  if (!todos.length) {
    head.textContent = "Todo"
    body.innerHTML = '<div class="empty">No todos for this session.</div>'
    return
  }

  const done = todos.filter((t) => t.status === "completed").length
  head.textContent = `Todo [${done}/${todos.length}]`
  body.innerHTML = todos
    .map((t) => {
      const pri = t.priority ? `<span class="pri">${esc(t.priority)}</span>` : ""
      return (
        `<div class="row ${esc(t.status)}">` +
        `<span class="mark">${MARK[t.status]}</span>` +
        `<span class="text">${esc(t.content)}</span>${pri}</div>`
      )
    })
    .join("")
}

function paintMessage(text) {
  el("head").textContent = "Todo"
  el("body").innerHTML = `<div class="empty">${esc(text)}</div>`
}

async function refresh() {
  if (!host) return
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

  // Skip the DOM write when nothing changed, so a poll does not disturb scrolling.
  const key = sessionID + "\u0000" + (content || "")
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
