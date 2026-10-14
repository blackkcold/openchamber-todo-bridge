/**
 * Todos — the task board.
 *
 * A full-screen page: every session's tasks in one place, with a cross-session
 * summary, filters, a view switch (task tree / phase-swimlane graph), a session
 * selector, and a node detail. Opened from OpenChamber's Extension pages menu.
 *
 * Windowed. The board used to read every mirror each poll and render every one
 * of them, which stalls once a machine accumulates a few hundred sessions. Now
 * it reads only `_index.json` (which carries a summary per session), renders the
 * current session pinned plus the most recent `BATCH` sessions, and loads more —
 * and the mirrors for the trees — only as the reader scrolls or filters.
 *
 * Read-only in v1 — the one action is "hand it to the AI", which composes an
 * instruction into the chat box (no capability needed) rather than writing the
 * mirror back and fighting the agent's whole-list rewrite.
 *
 * Reads `~/.config/openchamber/todos/*.json`, the same mirrors the plugin writes
 * and the section reads.
 */
import { connectHost } from "@openchamber/sdk"
import { applyHostReady, mountButton, mountCheckbox, mountSearchField, mountSelect } from "@openchamber/sdk/ui"

import { buildTree, INDENT, phaseColor, pruneFinished } from "./graph.js"
import { DAG_COL, dagLayout } from "./dag.js"
import { GUT_NODE, ensureGutStyle, gutterSvg } from "./gutter.js"
import { parseDoc, parseIndex } from "./doc.js"
import {
  ARCHIVE_KEY,
  emptyArchive,
  finishedSessionIDs,
  isArchived,
  parseArchive,
  partition,
  withArchived,
  withoutArchived,
} from "./archive.js"

const POLL_MS = 4000
const REQUEST_TIMEOUT_MS = 8000
const TODOS_DIR = "~/.config/openchamber/todos"
const UNGROUPED = "未分组"
const CHIP_W = DAG_COL - 34
const CHIP_H = 26
/** Sessions drawn before the first scroll; the sentinel loads the next batch. */
const BATCH = 15

ensureGutStyle(document)

const el = (id) => document.getElementById(id)
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
))
const truncate = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const colorAt = (index) => (index >= 0 ? phaseColor(index) : "var(--oc-muted, #6f6e69)")
const isDone = (status) => status === "completed" || status === "cancelled"

let host = null
let mounted = false
let timer = null
let lastKey = ""
/** Every session, newest first, from the index alone — no mirror is opened for this. */
let allMetas = []
/** The sessions to show: `allMetas` minus the ones the reader has set aside. */
let agenda = []
/** The sessions set aside, newest first — not loaded, not rendered until the fold opens. */
let archived = []
/** The reader's archive, read from `host.storage` (never the mirrors or the index). */
let archive = emptyArchive()
/** Whether the set-aside fold is open; while closed, its mirrors are never read. */
let showArchived = false
/** How many set-aside sessions the open fold has drawn so far. */
let archivedLoadedCount = BATCH
let globalPhases = []
/** sessionID -> { updatedAt, todos, phases }: the tree needs this; the index does not. */
const docCache = new Map()
let loadedCount = BATCH
let currentID = null
let renderSeq = 0
let loadingMore = false
const filter = { query: "", status: "all", phase: "all", view: "tree", session: "all", showFinished: false }
let selected = null
const controls = {}
let detailHandles = []
/** IntersectionObservers for the load-more sentinels, one per open list. */
let observers = []
/** The last archive change, offered back as an undo for a few seconds. */
let undo = null
let undoTimer = null

const ARCHIVE_UNDO_MS = 9000

// ---- index metadata ----------------------------------------------------------

/** A meta by session id, from the whole index (set-aside sessions included). */
const metaOf = (sessionID) => allMetas.find((meta) => meta.sessionID === sessionID) || null

/** The loaded mirror for a meta, or null when it is not loaded / is stale. */
function docOf(meta) {
  const cached = meta ? docCache.get(meta.sessionID) : null
  return cached && cached.updatedAt === meta.updatedAt ? cached : null
}

/** A task-derived label, from the index summary or, failing that, the mirror. */
function titleOf(meta, doc) {
  if (meta && meta.title) return meta.title
  const todos = doc ? doc.todos : []
  const active = todos.find((todo) => todo.status === "in_progress")
  const root = todos.find((todo) => !todo.parentId)
  return (active || root || {}).content || (meta ? meta.sessionID : "")
}

function filtering() {
  return filter.query !== "" || filter.status !== "all" || filter.phase !== "all"
}

function matches(todo) {
  if (filter.query && !todo.content.toLowerCase().includes(filter.query.toLowerCase())) return false
  if (filter.status !== "all" && todo.status !== filter.status) return false
  if (filter.phase !== "all" && (todo.phase || "") !== filter.phase) return false
  return true
}

/** The session pinned to the top: the open session if indexable, else the newest. */
function pinnedMeta() {
  const byCurrent = currentID ? metaOf(currentID) : null
  return byCurrent || agenda[0] || null
}

/** Every session below the pinned card, newest first. */
function listMetas() {
  const pinned = pinnedMeta()
  const pinnedID = pinned ? pinned.sessionID : null
  return agenda.filter((meta) => meta.sessionID !== pinnedID)
}

/** The metas whose mirrors the current view actually needs. */
function windowMetas() {
  if (filter.session !== "all") {
    const meta = metaOf(filter.session)
    return meta ? [meta] : []
  }
  const pinned = pinnedMeta()
  const shown = listMetas().slice(0, loadedCount)
  const out = (pinned ? [pinned] : []).concat(shown)
  // Set-aside sessions are read only when the fold is open — never by default.
  if (showArchived) out.push(...archived.slice(0, archivedLoadedCount))
  return out
}

// ---- mirrors (lazy) ----------------------------------------------------------

/** Read the mirrors the window needs that are not cached at their current mtime. */
async function ensureDocs(metas) {
  const need = metas.filter((meta) => !docOf(meta))
  if (!need.length) return
  await Promise.all(need.map(async (meta) => {
    try {
      const { content } = await host.readFile(`${TODOS_DIR}/${meta.sessionID}.json`)
      const doc = parseDoc(content)
      if (doc) docCache.set(meta.sessionID, { updatedAt: meta.updatedAt, todos: doc.todos, phases: doc.phases })
    } catch {
      /* a partial or unreadable file is skipped, not fatal */
    }
  }))
}

// ---- rendering ---------------------------------------------------------------

function materialize(meta) {
  const doc = docOf(meta)
  return {
    sessionID: meta.sessionID,
    updatedAt: meta.updatedAt,
    todos: doc ? doc.todos : [],
    phases: doc ? doc.phases : [],
  }
}

/** Header counts: from the index summary when present, else from the mirror. */
function sessionHeader(meta, opts = {}) {
  const doc = docOf(meta)
  let done, total
  if (Number.isFinite(meta.total)) {
    total = meta.total
    done = (meta.done || 0) + (meta.cancelled || 0)
  } else {
    const todos = doc ? doc.todos : []
    total = todos.length
    done = todos.filter((todo) => isDone(todo.status)).length
  }
  const pct = total ? Math.round((done / total) * 100) : 0
  const action = opts.archive
    ? `<button type="button" class="sess-act" data-archive="${esc(meta.sessionID)}" title="把这个会话收进已归档">归档</button>`
    : opts.restore
      ? `<button type="button" class="sess-act" data-restore="${esc(meta.sessionID)}" title="把这个会话移回最近会话">恢复</button>`
      : ""
  return (
    `<div class="sess-head"><h3>${esc(titleOf(meta, doc))}</h3>` +
    `<span class="cnt">${done}/${total}</span>${action}</div>` +
    `<div class="prog"><i style="width:${pct}%"></i></div>`
  )
}

/** Finished work is hidden by default; this note stands in for a hidden tree. */
function hiddenNote(session) {
  const hidden = session.todos.length - pruneFinished(session.todos).length
  return `<div class="note" style="padding:4px 6px">${hidden} 项已完成，已隐藏（勾选「显示已完成」查看）。</div>`
}

function treeRowsHtml(session) {
  const list = filter.showFinished ? session.todos : pruneFinished(session.todos)
  if (!list.length) return hiddenNote(session)
  // `data-index` must name the original list, the one the detail panel reads.
  const original = new Map(session.todos.map((todo, index) => [todo, index]))
  const { rows } = buildTree(list, globalPhases)
  const active = filtering()
  return rows
    .map((row) => {
      const width = row.depth * INDENT + GUT_NODE
      if (row.synthetic) {
        return (
          `<div class="row group" data-session="${esc(session.sessionID)}">` +
          `<span class="gut" style="width:${width}px">${gutterSvg(row, "")}</span>` +
          `<span class="txt group-label" style="color:${phaseColor(row.colorIndex)}">${esc(row.content)}</span></div>`
        )
      }
      const todo = list[row.index]
      const index = original.get(todo)
      const dim = active && !matches(todo) ? " dim" : ""
      const sel = selected && selected.sessionID === session.sessionID && selected.index === index ? " sel" : ""
      const blocked = row.blocked ? `<span class="pill blocked">受阻</span>` : ""
      const phase = todo.phase ? `<span class="pill">${esc(todo.phase)}</span>` : ""
      return (
        `<div class="row ${esc(todo.status)}${dim}${sel}" data-session="${esc(session.sessionID)}" data-index="${index}">` +
        `<span class="gut" style="width:${width}px">${gutterSvg(row, todo.status)}</span>` +
        `<span class="txt">${esc(todo.content)}</span>${blocked}${phase}</div>`
      )
    })
    .join("")
}

/** The phase-swimlane graph for one session: lanes, edges, chips. */
function swimlaneSvg(session) {
  const list = filter.showFinished ? session.todos : pruneFinished(session.todos)
  if (!list.length) return hiddenNote(session)
  const { nodes, edges, lanes, width, height } = dagLayout(list, globalPhases)
  const parts = []
  for (const lane of lanes) {
    const color = colorAt(lane.colorIndex)
    parts.push(`<rect x="0" y="${lane.y}" width="${width}" height="${lane.height}" fill="${color}" opacity="0.05"/>`)
    parts.push(`<text x="6" y="${lane.y + 16}" font-size="11" font-weight="600" fill="${color}">${esc(lane.name)}</text>`)
  }
  for (const edge of edges) {
    const a = nodes[edge.from]
    const b = nodes[edge.to]
    const dx = Math.max(18, Math.abs(b.x - a.x) * 0.45)
    const d = `M${a.x} ${a.y} C${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
    const depends = edge.kind === "depends"
    parts.push(
      `<path d="${d}" fill="none" stroke="${depends ? "var(--oc-error, #af3029)" : "var(--oc-muted, #b9b7ad)"}"` +
      ` stroke-width="1.5" opacity="${depends ? 0.9 : 0.7}"${depends ? ' stroke-dasharray="3 3"' : ""}/>`,
    )
  }
  for (const node of nodes) {
    const x = node.x - CHIP_W / 2
    const y = node.y - CHIP_H / 2
    const phase = colorAt(node.colorIndex)
    const text = esc(truncate(node.content, 15))
    if (isDone(node.status) || node.status === "in_progress") {
      const fill = isDone(node.status) ? "var(--oc-success, #66800b)" : "var(--oc-primary, #205ea6)"
      parts.push(`<rect x="${x}" y="${y}" width="${CHIP_W}" height="${CHIP_H}" rx="7" fill="${fill}"/>`)
      if (node.status === "in_progress") {
        parts.push(`<rect x="${x - 3}" y="${y - 3}" width="${CHIP_W + 6}" height="${CHIP_H + 6}" rx="9" fill="none" stroke="${fill}" stroke-width="1.6" opacity="0.5"/>`)
      }
      parts.push(`<text x="${node.x}" y="${node.y + 4}" font-size="10" fill="#fff" text-anchor="middle">${text}${isDone(node.status) ? " ✓" : " ◐"}</text>`)
    } else {
      const stroke = node.blocked ? "var(--oc-error, #af3029)" : phase
      parts.push(
        `<rect x="${x}" y="${y}" width="${CHIP_W}" height="${CHIP_H}" rx="7" fill="none" stroke="${stroke}" stroke-width="1.6"${node.blocked ? ' stroke-dasharray="4 3"' : ""}/>`,
      )
      parts.push(`<text x="${node.x}" y="${node.y + 4}" font-size="10" fill="var(--oc-fg, #100f0f)" text-anchor="middle">${text}${node.blocked ? " ⛓" : " ○"}</text>`)
    }
  }
  return `<div class="swim"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="${esc(titleOf({ sessionID: session.sessionID }))}">${parts.join("")}</svg></div>`
}

function sessionCard(meta, current, archivedCard = false) {
  const doc = docOf(meta)
  const body = doc
    ? (filter.view === "swimlane" ? swimlaneSvg(materialize(meta)) : treeRowsHtml(materialize(meta)))
    : `<div class="note">加载中…</div>`
  const tag = current ? `<div class="pin-tag">当前会话</div>` : ""
  const opts = archivedCard ? { restore: true } : (current ? {} : { archive: true })
  const cls = `sess${current ? " pinned" : ""}${archivedCard && !current ? " archived" : ""}`
  return `<section class="${cls}" data-session="${esc(meta.sessionID)}">${tag}${sessionHeader(meta, opts)}${body}</section>`
}

/** Whether a loaded session holds a task matching the active filter. */
function hasMatch(meta) {
  const doc = docOf(meta)
  return Boolean(doc && doc.todos.some(matches))
}

function sentinelHtml(list, considered) {
  const more = considered.length < list.length
  let html = more
    ? `<div id="sentinel" class="sentinel">↓ 滚动到底加载下一批（还有 ${list.length - considered.length} 个会话）</div>`
    : `<div class="endnote">已到末尾 · 共 ${list.length} 个会话</div>`
  if (filtering() && more) {
    html += `<div class="endnote">筛选只作用于已加载的 ${considered.length} 个会话 · ` +
      `<button type="button" id="loadAll" class="link">加载全部以筛选</button></div>`
  }
  return html
}

function paint() {
  const box = el("sessions")

  if (filter.session !== "all") {
    const meta = metaOf(filter.session)
    box.innerHTML = undoBarHtml() + (meta
      ? sessionCard(meta, meta.sessionID === currentID, isArchived(archive, meta))
      : `<div class="note">该会话已不存在。</div>`)
    paintDetails()
    observeSentinel()
    return
  }

  const pinned = pinnedMeta()
  const list = listMetas()
  const considered = list.slice(0, loadedCount)
  const shown = filtering() ? considered.filter(hasMatch) : considered
  const cards = shown.map((meta) => sessionCard(meta, false)).join("")
  const countNote = filtering() ? ` · 命中 ${shown.length}` : ""
  const main = pinned
    ? sessionCard(pinned, true, isArchived(archive, pinned)) +
      `<div class="divider">最近会话 · 已显示 ${considered.length} / ${list.length}${countNote}</div>` +
      (cards || `<div class="note">没有匹配的任务。</div>`) +
      sentinelHtml(list, considered)
    : (archived.length
        ? `<div class="note">当前没有进行中的会话；下面是已归档的。</div>`
        : `<div class="note">还没有任何会话的任务。在任一会话里触发一次任务更新（todowrite）即可。</div>`)
  box.innerHTML = undoBarHtml() + main + archivedSectionHtml()
  paintDetails()
  observeSentinel()
}

/**
 * The set-aside sessions: one collapsed row by default, cards only once opened.
 * The count is derived from the index alone, so a closed fold costs no file read.
 */
function archivedSectionHtml() {
  if (!archived.length) return ""
  const items = archived.reduce((n, meta) => n + (Number.isFinite(meta.total) ? meta.total : 0), 0)
  const head =
    `<button type="button" class="arch-fold" id="archiveToggle" aria-expanded="${showArchived}">` +
    `<span>🗄 已归档 ${archived.length} 个会话</span>` +
    `<span class="n">${items} 项 · ${showArchived ? "收起" : "展开"}</span></button>`
  if (!showArchived) return `<div class="archive">${head}</div>`
  const shown = archivedLoadedCount >= archived.length ? archived : archived.slice(0, archivedLoadedCount)
  const more = archivedLoadedCount < archived.length
    ? `<div id="archivedSentinel" class="sentinel">↓ 加载更多已归档（还有 ${archived.length - archivedLoadedCount} 个）</div>`
    : `<div class="endnote">已到末尾 · 共 ${archived.length} 个已归档会话</div>`
  const restoreAll = archived.length > 1
    ? `<div class="endnote"><button type="button" class="link" id="restoreAll">全部恢复</button></div>`
    : ""
  return `<div class="archive">${head}${shown.map((meta) => sessionCard(meta, false, true)).join("")}${more}${restoreAll}</div>`
}

/** The undo for the last archive change, shown in place of the classic toast button. */
function undoBarHtml() {
  if (!undo) return ""
  return (
    `<div class="undo-bar"><span>${esc(undo.label)}</span>` +
    `<button type="button" id="undoBtn">撤销</button>` +
    `<button type="button" id="undoDismiss" aria-label="关闭">×</button></div>`
  )
}

/** Load the next batch (or everything) when the sentinel scrolls into view. */
function loadMore() {
  if (loadingMore || !el("sentinel")) return
  loadingMore = true
  loadedCount += BATCH
  void renderBoard().finally(() => { loadingMore = false })
}

function loadAll() {
  if (loadingMore) return
  loadingMore = true
  loadedCount = Number.MAX_SAFE_INTEGER
  void renderBoard().finally(() => { loadingMore = false })
}

/** Load the next batch of set-aside sessions when the fold's sentinel appears. */
function loadMoreArchived() {
  if (loadingMore || !el("archivedSentinel")) return
  loadingMore = true
  archivedLoadedCount += BATCH
  void renderBoard().finally(() => { loadingMore = false })
}

/** Open or close the set-aside fold. Opening is what pulls its mirrors in. */
function toggleArchived() {
  showArchived = !showArchived
  archivedLoadedCount = BATCH
  void renderBoard()
}

function disconnectObservers() {
  for (const io of observers) io.disconnect()
  observers = []
}

/** Watch a load-more sentinel and fire `onHit` when it nears the viewport. */
function attachObserver(node, onHit) {
  if (typeof IntersectionObserver === "undefined") return
  const io = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) onHit()
  }, { root: el("sessions"), rootMargin: "600px" })
  io.observe(node)
  observers.push(io)
}

function observeSentinel() {
  disconnectObservers()
  const loadAllButton = el("loadAll")
  if (loadAllButton) loadAllButton.addEventListener("click", () => loadAll())
  const main = el("sentinel")
  if (main) attachObserver(main, loadMore)
  const folded = el("archivedSentinel")
  if (folded) attachObserver(folded, loadMoreArchived)
}

/** Backup for a throttled IntersectionObserver: load when the list nears its end. */
function onSessionsScroll() {
  const box = el("sessions")
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 400) loadMore()
}

/** Ensure the window's mirrors, then paint — guarded against overlapping runs. */
async function renderBoard() {
  const seq = (renderSeq += 1)
  await ensureDocs(windowMetas())
  if (seq !== renderSeq) return
  paint()
}

function paintSummary() {
  let doing = 0, pending = 0, done = 0, blocked = 0, total = 0
  const byPhase = new Map()
  for (const meta of agenda) {
    if (Number.isFinite(meta.total)) {
      total += meta.total
      done += meta.done || 0
      doing += meta.doing || 0
      pending += meta.pending || 0
      blocked += meta.blocked || 0
      for (const [phase, count] of Object.entries(meta.byPhase || {})) {
        byPhase.set(phase, (byPhase.get(phase) || 0) + count)
      }
      continue
    }
    // An index written before the plugin learned to summarise: count from the
    // mirror when it is loaded, so the bar fills in as the reader scrolls.
    const doc = docOf(meta)
    if (!doc) continue
    const statusById = new Map()
    for (const todo of doc.todos) if (todo.id) statusById.set(todo.id, todo.status)
    for (const todo of doc.todos) {
      total += 1
      if (todo.status === "completed") done += 1
      else if (todo.status === "in_progress") doing += 1
      else if (todo.status === "pending") pending += 1
      if (Array.isArray(todo.dependsOn) && todo.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== "completed")) blocked += 1
      const phase = todo.phase || ""
      byPhase.set(phase, (byPhase.get(phase) || 0) + 1)
    }
  }
  const ungrouped = byPhase.get("") || 0
  const phaseChips = globalPhases
    .map((phase) => {
      const index = globalPhases.indexOf(phase)
      return `<span class="pg"><i style="background:${colorAt(index)}"></i>${esc(phase)} <b>${byPhase.get(phase) || 0}</b></span>`
    })
    .join("") +
    (ungrouped ? `<span class="pg"><i style="background:${colorAt(-1)}"></i>${esc(UNGROUPED)} <b>${ungrouped}</b></span>` : "")
  el("summary").innerHTML =
    `<div class="stats"><b>${agenda.length} 会话</b> <span>◐ ${doing} 进行中</span>` +
    `<span>○ ${pending} 待办</span><span class="blocked">⛓ ${blocked} 受阻</span><span>✓ ${done} 完成</span>` +
    `<span>共 ${total} 项</span></div>` +
    `<div class="phases"><span style="color:var(--b-muted)">阶段分布</span>${phaseChips}</div>`
}

function paintDetails() {
  for (const handle of detailHandles) handle.dispose()
  detailHandles = []
  const box = el("details")
  const meta = selected ? metaOf(selected.sessionID) : null
  const doc = meta ? docOf(meta) : null
  const todo = doc && selected ? doc.todos[selected.index] : null
  if (!todo) {
    box.innerHTML = `<h3>任务详情</h3><div class="kv">点击左侧任务查看详情。</div>`
    return
  }
  const todos = doc.todos
  const deps = Array.isArray(todo.dependsOn) ? todo.dependsOn : []
  const depHtml = deps.length
    ? deps.map((id) => {
        const index = todos.findIndex((t) => t.id === id)
        if (index < 0) return `${esc(id)}（未找到）`
        const dep = todos[index]
        return `<a data-goto="${index}">${esc(dep.content)}</a>${dep.status === "completed" ? " ✓" : "（未完成 → 受阻）"}`
      }).join("<br>")
    : "—"
  box.innerHTML =
    `<h3>任务详情</h3>` +
    `<div class="content">${esc(todo.content)}</div>` +
    `<div class="kv">状态：${esc(todo.status)}</div>` +
    `<div class="kv">阶段：${esc(todo.phase || "—")}</div>` +
    `<div class="kv">优先级：${esc(todo.priority || "—")}</div>` +
    `<div class="kv">依赖：<br>${depHtml}</div>` +
    `<div class="kv">会话：${esc(meta.sessionID)}</div>` +
    `<div class="actions" id="detailActions"></div>`
  const actions = el("detailActions")
  const hand = document.createElement("div")
  const copy = document.createElement("div")
  const open = document.createElement("div")
  actions.append(hand, copy, open)
  detailHandles.push(
    mountButton(hand, { label: "交给 AI 处理", size: "sm", onClick: () => handOff(todo) }),
    mountButton(copy, { label: "复制", variant: "secondary", size: "sm", onClick: () => copyTodo(todo) }),
    mountButton(open, { label: "打开会话", variant: "ghost", size: "sm", onClick: () => openSession(meta.sessionID) }),
  )
}

/** Open the session a task belongs to. */
function openSession(sessionID) {
  Promise.resolve(host.openSession(sessionID)).catch(() => {
    try { host.toast({ kind: "error", message: "需要授权「sessions」才能打开会话。" }) } catch { /* host gone */ }
  })
}

// ---- actions -----------------------------------------------------------------

async function handOff(todo) {
  try {
    await host.compose({
      text: `处理 todo 列表里的任务：「${todo.content}」，并在列表中更新它的状态。`,
      mode: "append",
    })
    host.toast({ kind: "success", message: "已放入聊天输入框，确认后发送。" })
  } catch (error) {
    const code = error && error.code
    host.toast({ kind: "error", message: code === "NO_SESSION" ? "请先打开一个会话，再交给 AI。" : `放入失败：${code || error}` })
  }
}

async function copyTodo(todo) {
  try {
    await host.writeClipboard(todo.content)
    host.toast({ kind: "success", message: "已复制任务内容。" })
  } catch {
    /* clipboard refused; nothing useful to say */
  }
}

// ---- archiving ---------------------------------------------------------------

/**
 * Setting a session aside is board state, not todo data: it is written to the
 * extension's own `host.storage`, never to a mirror — writing a mirror would
 * fight a live agent's whole-list rewrite. It survives a restart, and a session
 * that runs `todowrite` again resurfaces on its own (see `src/archive.js`).
 */

/** Offer the last archive change back as an undo for a few seconds. */
function armUndo(label, entry) {
  undo = { label, entry }
  if (undoTimer !== null) clearTimeout(undoTimer)
  undoTimer = setTimeout(() => {
    undo = null
    undoTimer = null
    paint()
  }, ARCHIVE_UNDO_MS)
}

function clearUndo() {
  undo = null
  if (undoTimer !== null) {
    clearTimeout(undoTimer)
    undoTimer = null
  }
}

/**
 * Apply a new archive value: write it, then repaint from the source of truth. On
 * a write failure the in-memory value and the undo roll back, so the board never
 * shows a state the host did not accept.
 */
async function commitArchive(entry, previous, label, successMessage) {
  archive = entry
  armUndo(label, previous)
  try {
    await host.storage.set(ARCHIVE_KEY, archive)
  } catch (error) {
    archive = previous
    clearUndo()
    host.toast({ kind: "error", message: `归档未能保存：${(error && error.code) || error}` })
    lastKey = ""
    await refresh()
    return
  }
  lastKey = ""
  await refresh()
  host.toast({ kind: "success", message: successMessage })
}

async function archiveSession(sessionID) {
  const previous = archive
  await commitArchive(
    withArchived(archive, [sessionID], Date.now()),
    previous,
    "已归档 1 个会话",
    "已归档 1 个会话，可在「已归档」里恢复。",
  )
}

async function restoreSession(sessionID) {
  const previous = archive
  await commitArchive(withoutArchived(archive, [sessionID]), previous, "已恢复 1 个会话", "已恢复 1 个会话。")
}

/** Archive every session with no open work; skip the one in view and the archived. */
async function archiveFinished() {
  const ids = finishedSessionIDs(allMetas, archive, currentID)
  if (!ids.length) {
    host.toast({ kind: "info", message: "没有已完成的会话可归档。" })
    return
  }
  const previous = archive
  await commitArchive(
    withArchived(archive, ids, Date.now()),
    previous,
    `已归档 ${ids.length} 个会话`,
    `已归档 ${ids.length} 个已完成会话，可在「已归档」里恢复。`,
  )
}

async function restoreAllArchived() {
  const ids = archived.map((meta) => meta.sessionID)
  if (!ids.length) return
  const previous = archive
  await commitArchive(withoutArchived(archive, ids), previous, `已恢复 ${ids.length} 个会话`, `已恢复 ${ids.length} 个会话。`)
}

async function performUndo() {
  if (!undo) return
  const target = undo.entry
  clearUndo()
  archive = target
  try {
    await host.storage.set(ARCHIVE_KEY, archive)
  } catch (error) {
    host.toast({ kind: "error", message: `撤销未能保存：${(error && error.code) || error}` })
  }
  lastKey = ""
  await refresh()
}

// ---- controls ----------------------------------------------------------------

function updateSessionOptions() {
  if (!controls.session) return
  const options = [{ id: "all", label: "全部会话" }, ...agenda.map((meta) => ({ id: meta.sessionID, label: truncate(meta.title || meta.sessionID, 28) }))]
  controls.session.update({ options })
}

function updatePhaseOptions() {
  if (!controls.phase) return
  const options = [{ id: "all", label: "全部阶段" }, ...globalPhases.map((phase) => ({ id: phase, label: phase }))]
  controls.phase.update({ options })
}

function mountToolbar() {
  controls.search = mountSearchField(el("searchHost"), {
    value: "", placeholder: "搜索任务…", label: "搜索任务",
    onChange: (value) => { filter.query = value; controls.search.update({ value }); paint() },
  })
  controls.session = mountSelect(el("sessionHost"), {
    label: "会话", value: "all", options: [{ id: "all", label: "全部会话" }], searchable: true,
    onChange: (value) => {
      filter.session = value
      loadedCount = BATCH
      controls.session.update({ value })
      void renderBoard()
    },
  })
  controls.view = mountSelect(el("viewHost"), {
    label: "视图", value: "tree",
    options: [{ id: "tree", label: "任务树" }, { id: "swimlane", label: "泳道图" }],
    onChange: (value) => { filter.view = value; controls.view.update({ value }); paint() },
  })
  controls.status = mountSelect(el("statusHost"), {
    label: "状态", value: "all",
    options: [
      { id: "all", label: "全部状态" }, { id: "in_progress", label: "进行中" },
      { id: "pending", label: "待办" }, { id: "completed", label: "已完成" }, { id: "cancelled", label: "已取消" },
    ],
    onChange: (value) => { filter.status = value; controls.status.update({ value }); paint() },
  })
  controls.phase = mountSelect(el("phaseHost"), {
    label: "阶段", value: "all", options: [{ id: "all", label: "全部阶段" }],
    onChange: (value) => { filter.phase = value; controls.phase.update({ value }); paint() },
  })
  controls.finished = mountCheckbox(el("finishedHost"), {
    label: "显示已完成",
    checked: false,
    onChange: (checked) => {
      filter.showFinished = checked
      controls.finished.update({ checked })
      paint()
    },
  })
  controls.archive = mountButton(el("archiveHost"), {
    label: "批量归档已完成",
    variant: "secondary",
    size: "sm",
    onClick: () => { void archiveFinished() },
  })

  el("sessions").addEventListener("scroll", onSessionsScroll, { passive: true })
  el("sessions").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest("#archiveToggle")) { toggleArchived(); return }
    if (target.closest("#restoreAll")) { void restoreAllArchived(); return }
    if (target.closest("#undoBtn")) { void performUndo(); return }
    if (target.closest("#undoDismiss")) { clearUndo(); paint(); return }
    const archiveButton = target.closest("[data-archive]")
    if (archiveButton) { void archiveSession(archiveButton.dataset.archive); return }
    const restoreButton = target.closest("[data-restore]")
    if (restoreButton) { void restoreSession(restoreButton.dataset.restore); return }
    const row = target.closest(".row")
    if (!row || row.dataset.index === undefined) return
    selected = { sessionID: row.dataset.session, index: Number(row.dataset.index) }
    paint()
  })
  el("details").addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("[data-goto]") : null
    if (!link || !selected) return
    selected = { sessionID: selected.sessionID, index: Number(link.dataset.goto) }
    paint()
  })
}

// ---- lifecycle ---------------------------------------------------------------

async function refresh() {
  if (!host) return
  let metas
  try {
    const { content } = await host.readFile(`${TODOS_DIR}/_index.json`)
    metas = parseIndex(content)
    if (metas === null) throw new Error("BAD_INDEX")
  } catch (error) {
    const code = error && error.code
    const message = String((error && error.message) || "")
    el("sessions").innerHTML = `<div class="note">${
      message === "BAD_INDEX"
        ? "任务索引损坏。"
        : code === "NOT_FOUND"
          ? "任务索引尚未生成：在任一会话里触发一次任务更新（todowrite）即可。"
          : `读取失败：${esc(code || message || String(error))}`
    }</div>`
    return
  }

  // The archive lives in the extension's own storage. A host that refuses it, or
  // does not answer, simply means "nothing is set aside" — the board still works.
  let rawArchive
  try {
    rawArchive = await host.storage.get(ARCHIVE_KEY)
  } catch {
    rawArchive = undefined
  }
  const nextArchive = parseArchive(rawArchive)

  const phases = []
  const seen = new Set()
  for (const meta of metas) {
    for (const phase of (meta.phases || [])) if (phase && !seen.has(phase)) { seen.add(phase); phases.push(phase) }
    for (const phase of Object.keys(meta.byPhase || {})) if (phase && !seen.has(phase)) { seen.add(phase); phases.push(phase) }
  }
  const key = JSON.stringify([metas, loadedCount, filter, currentID, nextArchive, showArchived, archivedLoadedCount])
  if (key === lastKey) return
  lastKey = key

  const phasesChanged = JSON.stringify(phases) !== JSON.stringify(globalPhases)
  allMetas = metas
  archive = nextArchive
  const split = partition(metas, archive, currentID)
  agenda = split.active
  archived = split.archived
  globalPhases = phases
  if (filter.session !== "all") {
    const chosen = metaOf(filter.session)
    if (!chosen || isArchived(archive, chosen)) filter.session = "all"
  }
  updateSessionOptions()
  if (phasesChanged) updatePhaseOptions()
  el("legend").innerHTML = globalPhases
    .map((phase, index) => `<span class="lg"><i style="background:${phaseColor(index)}"></i>${esc(phase)}</span>`)
    .join("")
  paintSummary()
  await renderBoard()
}

function insideHostFrame() {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

function setCurrent(session) {
  const next = session && typeof session.id === "string" ? session.id : null
  if (next === currentID) return
  currentID = next
  lastKey = ""
  if (host) void renderBoard()
}

function boot() {
  if (!insideHostFrame()) {
    el("sessions").innerHTML = `<div class="note">请在 OpenChamber 中打开此页。</div>`
    return
  }
  try {
    host = connectHost({ requestTimeoutMs: REQUEST_TIMEOUT_MS })
  } catch {
    el("sessions").innerHTML = `<div class="note">无法连接 OpenChamber。</div>`
    return
  }
  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement)
    if (mounted) return
    mounted = true
    currentID = ctx && ctx.session && typeof ctx.session.id === "string" ? ctx.session.id : null
    mountToolbar()
    void refresh()
    if (timer === null) timer = setInterval(() => { void refresh() }, POLL_MS)
  })
  host.onSession((session) => setCurrent(session))
}

boot()
