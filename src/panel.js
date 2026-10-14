/**
 * Todos — the rail panel.
 *
 * The current session's task tree, deliberately minimal: no filters, no
 * details, no cross-session view (the full board has those). It reads the same
 * per-session mirror the Work Status section reads and draws the same tree, so
 * the panel and the section agree.
 *
 * A section-only extension cannot use `page`, and `page` requires `panel.entry`
 * — so this panel is what makes the full board possible. It is also useful on
 * its own: an always-there view of the session's tasks.
 */
import { connectHost } from "@openchamber/sdk"
import { applyHostReady, mountButton } from "@openchamber/sdk/ui"

import { buildTree, finishedCount, INDENT, phaseColor, pruneFinished } from "./graph.js"
import { GUT_NODE, ensureGutStyle, gutterSvg } from "./gutter.js"
import { parseDoc } from "./doc.js"

const POLL_MS = 2000
const REQUEST_TIMEOUT_MS = 3000
const BOOT_WATCHDOG_MS = 1600
const TODOS_DIR = "~/.config/openchamber/todos"

ensureGutStyle(document)

const el = (id) => document.getElementById(id)
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
))

let host = null
let sessionID = null
let booted = false
let mounted = false
let jumpButton = null
/** Reader's choice: reveal finished work. Off by default. */
let openFinished = false
/** The last painted document, so the fold can re-render without a file read. */
let lastDoc = null
let timer = null
let lastKey = ""

/** A task-derived label, since the mirror carries no session title. */
function titleFor(doc) {
  const active = doc.todos.find((todo) => todo.status === "in_progress")
  const root = doc.todos.find((todo) => !todo.parentId)
  return (active || root || {}).content || "本会话任务"
}

/** Show the "jump to session" button only when there is a session to open. */
function syncJump() {
  const container = el("jumpHost")
  if (container) container.hidden = !sessionID || jumpButton === null
}

/** Mounted once; opens the session whose tree the panel is showing. */
function mountJump() {
  jumpButton = mountButton(el("jumpHost"), {
    label: "跳转到会话",
    variant: "secondary",
    size: "xs",
    onClick: () => {
      if (!sessionID) return
      Promise.resolve(host.openSession(sessionID)).catch(() => {
        try { host.toast({ kind: "error", message: "需要授权「sessions」才能跳转到会话。" }) } catch { /* host gone */ }
      })
    },
  })
}

function rowHtml(tree, todo) {
  const width = tree.depth * INDENT + GUT_NODE
  if (tree.synthetic) {
    return (
      `<div class="row group" data-status="">` +
      `<span class="gut" style="width:${width}px">${gutterSvg(tree, "")}</span>` +
      `<span class="txt group-label" style="color:${phaseColor(tree.colorIndex)}">${esc(todo.content)}</span></div>`
    )
  }
  return (
    `<div class="row ${esc(todo.status)}" data-status="${esc(todo.status)}">` +
    `<span class="gut" style="width:${width}px">${gutterSvg(tree, todo.status)}</span>` +
    `<span class="txt">${esc(todo.content)}</span></div>`
  )
}

function render(doc) {
  lastDoc = doc
  const kept = pruneFinished(doc.todos)
  const shown = openFinished ? doc.todos : kept
  const { rows, phases } = buildTree(shown, doc.phases)
  const done = finishedCount(doc.todos)
  const total = doc.todos.length

  el("title").textContent = titleFor(doc)
  el("meta").textContent = `${done}/${total}`
  el("bar").firstElementChild.style.width = `${total ? Math.round((done / total) * 100) : 0}%`

  el("legend").innerHTML = phases
    .map((phase, index) => `<span class="lg"><i style="background:${phaseColor(index)}"></i>${esc(phase)}</span>`)
    .join("")

  const body = rows.map((row) => rowHtml(row, row.synthetic ? { content: row.content } : shown[row.index])).join("")
  const hidden = total - kept.length
  const fold = hidden
    ? `<button class="fold" type="button" data-fold aria-expanded="${openFinished}">已完成 ${hidden} 项</button>`
    : ""
  el("list").innerHTML = body + fold
  syncJump()
}

/** The finished fold reveals the done work on demand (and hides it again). */
el("list").addEventListener("click", (event) => {
  const fold = event.target instanceof Element ? event.target.closest("[data-fold]") : null
  if (!fold) return
  openFinished = !openFinished
  if (lastDoc) render(lastDoc)
})

function paintMessage(text) {
  el("title").textContent = "Todos"
  el("meta").textContent = ""
  el("bar").firstElementChild.style.width = "0"
  el("legend").innerHTML = ""
  el("list").innerHTML = `<div class="empty">${esc(text)}</div>`
  syncJump()
}

async function refresh() {
  if (!host) return
  if (!sessionID) {
    paintMessage("打开一个会话以查看它的任务树。")
    return
  }
  let content
  try {
    content = (await host.readFile(`${TODOS_DIR}/${sessionID}.json`)).content
  } catch (error) {
    const code = error && error.code
    paintMessage(code === "NOT_GRANTED" ? "未获授权读取任务文件。" : "本会话暂无任务。")
    return
  }
  const doc = parseDoc(content)
  if (!doc) {
    paintMessage("任务列表不是合法 JSON。")
    return
  }
  const key = JSON.stringify([sessionID, doc.todos, doc.phases])
  if (key === lastKey) return
  lastKey = key
  render(doc)
}

function start() {
  if (timer !== null) return
  timer = setInterval(() => { void refresh() }, POLL_MS)
}

function insideHostFrame() {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

function boot() {
  if (!insideHostFrame()) {
    paintMessage("请在 OpenChamber 中打开此页。")
    return
  }
  const watchdog = setTimeout(() => {
    if (!booted) paintMessage("连接 OpenChamber 中…")
  }, BOOT_WATCHDOG_MS)

  try {
    host = connectHost({ requestTimeoutMs: REQUEST_TIMEOUT_MS })
  } catch (error) {
    clearTimeout(watchdog)
    paintMessage(error && error.code === "HOST_UNAVAILABLE" ? "请在 OpenChamber 中打开此页。" : "无法连接 OpenChamber。")
    return
  }

  host.onReady((ctx) => {
    if (!booted) {
      booted = true
      clearTimeout(watchdog)
    }
    applyHostReady(ctx, document.documentElement)
    if (!mounted) {
      mounted = true
      mountJump()
    }
    const next = ctx && ctx.session && typeof ctx.session.id === "string" ? ctx.session.id : null
    if (next !== sessionID) {
      sessionID = next
      openFinished = false
      lastKey = ""
    }
    void refresh()
    start()
  })

  host.onSession((session) => {
    const next = session && typeof session.id === "string" ? session.id : null
    if (next !== sessionID) {
      sessionID = next
      openFinished = false
    }
    lastKey = ""
    void refresh()
  })
}

boot()
