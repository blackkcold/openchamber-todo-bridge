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
import { TOP_N, buildRows, familyIndex, groupFamilies, normalizePhase, splitTop } from "./taxonomy.js"
import {
  TAXONOMY_KEY,
  buildPrompt,
  describeGenerateError,
  emptyStore,
  failStore,
  gate,
  hashNames,
  mergeStore,
  parseAnswer,
  parseStore,
  rollbackStore,
  unknownNames,
} from "./taxonomy-ai.js"
import {
  ARCHIVE_KEY,
  PREFS_KEY,
  archiveCandidates,
  autoArchiveIDs,
  clampDays,
  emptyArchive,
  emptyPrefs,
  isArchived,
  parseArchive,
  parsePrefs,
  partition,
  withArchived,
  withoutArchived,
} from "./archive.js"

/**
 * The board is a workspace view, not a live transcript: the index only moves
 * when some session writes its list. Follow a running turn more closely, idle
 * slowly, and read nothing while the page is hidden.
 */
const BUSY_POLL_MS = 1500
const IDLE_POLL_MS = 5000
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
/** The loop is enabled; nothing turns it off yet, but a fatal error may. */
let polling = false
/** Whether the current session's turn is in flight, as last reported by the host. */
let sessionBusy = false
let lastKey = ""
/**
 * The index as last read, with the stamp (`kind:size:mtime`) it was read at.
 *
 * `_index.json` is the whole workspace, so it is the one file whose cost grows
 * with use: a few tens of KB parsed every poll. The stamp makes a quiet poll a
 * 200-byte stat instead of a full read and parse.
 */
let indexStamp = ""
let indexMetas = null
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
/** The reader's archive preferences ({ auto, days }), from storage. */
let prefs = emptyPrefs()
/** id -> the time it was restored or undone: held out of the sweep until it moves. */
const hold = {}
/** Whether the stored archive could be read on the last refresh — the sweep gate. */
let readOk = false
/** Set after a failed auto write (e.g. the document is over the size cap): stop the
 *  silent retry every poll, so a full archive is not written against every 4s. */
let sweepPaused = false
/**
 * The two candidate lists, recomputed from the index on every refresh — never a
 * mirror read. `finished` is what the sweep may write; `stale` (open work, old) is
 * only ever counted and listed, and archived only when the reader ticks it.
 */
let candidates = { finished: [], stale: [] }
/** Whether the reader ticked "include the still-open ones" in the popover. */
let staleIncluded = false
/** The archive popover is open. */
let archiveOpen = false
/**
 * The reader's phase view: chip order, whether empty phases are drawn, whether the
 * cloud is fully expanded, and which family is drilled into. Page state, not data.
 */
const phaseView = { sort: "count", showEmpty: false, expanded: false, openFamily: "" }
/** The learned taxonomy applied to the view: label overrides, family overrides, pins. */
let taxonomy = { aliases: {}, familyMap: {}, pinned: [] }
/** The whole stored document (aliases, gates, rollback snapshot) behind `taxonomy`. */
let taxonomyStore = emptyStore()
/** The store has been read once; later refreshes reuse it, so a poll costs no read. */
let taxonomyLoaded = false
/** A classification request is in flight. */
let classifying = false
/** The "no Small Model" toast is shown once per page, not once per failure. */
let aiToastShown = false
/** The management panel is open. */
let manageOpen = false
/** The explicit Small Model probe: idle / running / ok / fail, with its message. */
let aiTest = { state: "idle", text: "" }
/** When the page became visible; the automatic pass waits out a short idle first. */
let aiArmedAt = Date.now()

const ARCHIVE_UNDO_MS = 9000
/** A freshly opened board stays quiet this long before it may ask the model. */
const IDLE_AI_MS = 5000

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
  // The cloud merges names that fold together, so the filter compares the folded
  // form too — otherwise a chip that says "P0 止血" would match nothing.
  if (filter.phase !== "all" && normalizePhase(todo.phase || "") !== filter.phase) return false
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
  const opts = archivedCard ? { restore: true } : { archive: true }
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

/**
 * One pass over the agenda for both the stat totals and the workspace's phase
 * counts. Index summaries carry both, so this never opens a mirror.
 */
function workspaceCounts() {
  let doing = 0, pending = 0, done = 0, blocked = 0, total = 0
  const byPhase = {}
  for (const meta of agenda) {
    if (Number.isFinite(meta.total)) {
      total += meta.total
      done += meta.done || 0
      doing += meta.doing || 0
      pending += meta.pending || 0
      blocked += meta.blocked || 0
      for (const [phase, count] of Object.entries(meta.byPhase || {})) {
        byPhase[phase] = (byPhase[phase] || 0) + count
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
      byPhase[phase] = (byPhase[phase] || 0) + 1
    }
  }
  return { byPhase, stats: { doing, pending, done, blocked, total } }
}

function phaseChipHtml(row) {
  const on = filter.phase === row.key ? " on" : ""
  return `<button type="button" class="ph-chip${on}" data-phase="${esc(row.key)}" title="${esc(row.key)} · ${esc(row.family)}">` +
    `<i style="background:${colorAt(row.colorIndex)}"></i><span>${esc(row.label)}</span><b>${row.count}</b></button>`
}

function familyChipHtml(group) {
  const on = phaseView.openFamily === group.family ? " on" : ""
  return `<button type="button" class="ph-fam${on}" data-family="${esc(group.family)}" title="展开 ${esc(group.family)}">` +
    `<i style="background:${colorAt(familyIndex(group.family))}"></i>${esc(group.family)}<b>${group.count}</b>` +
    `<span class="ph-caret">${on ? "◂" : "▸"}</span></button>`
}

/**
 * The phase cloud. Three densities, in the order a reader needs them: the top
 * phases (which is what the eye wants), the families (which is what the workspace
 * actually means), and a drill-down per family. Everything is derived from the
 * index in one pass; nothing here costs a file read.
 */
function paintSummary() {
  const { byPhase, stats } = workspaceCounts()
  const { rows, ungrouped } = buildRows(byPhase, {
    aliases: taxonomy.aliases,
    familyMap: taxonomy.familyMap,
    pinned: taxonomy.pinned,
    sort: phaseView.sort,
    showEmpty: phaseView.showEmpty,
  })
  const groups = groupFamilies(rows)
  const unknownCount = unknownNames(byPhase, taxonomyStore, Number.MAX_SAFE_INTEGER).length
  const openGroup = phaseView.openFamily ? groups.find((group) => group.family === phaseView.openFamily) || null : null
  if (phaseView.openFamily && !openGroup) phaseView.openFamily = ""
  const budget = phaseView.expanded ? rows.length : TOP_N
  const { shown, hidden } = openGroup ? { shown: openGroup.rows, hidden: 0 } : splitTop(rows, budget)
  const seg = (mode, label) =>
    `<button type="button" class="ph-seg${phaseView.sort === mode ? " on" : ""}" data-sort="${mode}">${label}</button>`
  const more = hidden
    ? `<button type="button" class="ph-more" data-expand>+ ${hidden} 其他</button>`
    : phaseView.expanded && rows.length > TOP_N && !openGroup
      ? `<button type="button" class="ph-more" data-collapse>收起</button>`
      : ""
  const ungroupedChip = ungrouped
    ? `<span class="ph-chip static"><i style="background:${colorAt(-1)}"></i><span>${esc(UNGROUPED)}</span><b>${ungrouped}</b></span>`
    : ""
  el("summary").innerHTML =
    `<div class="stats"><b>${agenda.length} 会话</b> <span>◐ ${stats.doing} 进行中</span>` +
    `<span>○ ${stats.pending} 待办</span><span class="blocked">⛓ ${stats.blocked} 受阻</span>` +
    `<span>✓ ${stats.done} 完成</span><span>共 ${stats.total} 项</span></div>` +
    `<div class="phases"><span class="ph-label">阶段分布</span>` +
    `<span class="ph-meta">${rows.length} 个非空 / ${globalPhases.length} 个名称</span>` +
    `<span class="ph-tools">${seg("count", "数量")}${seg("declare", "声明序")}${seg("name", "名称")}</span>` +
    `<button type="button" class="ph-toggle${phaseView.showEmpty ? " on" : ""}" data-show-empty>显示空阶段</button>` +
    (unknownCount
      ? `<button type="button" class="ph-toggle ai${classifying ? " on" : ""}" data-classify${classifying ? " disabled" : ""}>` +
        `${classifying ? "归类中…" : `归类 ${unknownCount} 个新阶段`}</button>`
      : "") +
    `<button type="button" class="ph-toggle${manageOpen ? " on" : ""}" data-manage>管理</button>` +
    `</div>` +
    `<div class="ph-row">${shown.map(phaseChipHtml).join("") || `<span class="ph-none">暂无阶段</span>`}${more}${openGroup ? "" : ungroupedChip}</div>` +
    (groups.length
      ? `<div class="ph-row ph-fams">` +
        (openGroup ? `<button type="button" class="ph-back" data-family="">← 全部</button>` : "") +
        groups.map(familyChipHtml).join("") +
        `</div>`
      : "") +
    (manageOpen
      ? `<div class="ph-manage">` +
        `<div class="ph-manage-head"><b>阶段管理</b>` +
        (taxonomyStore.previous ? `<button type="button" class="ph-toggle" data-undo-classify>回滚上一版</button>` : "") +
        `<button type="button" class="ph-toggle" data-manage>收起</button></div>` +
        `<div class="ph-manage-list">` +
        (rows.length
          ? rows
              .slice(0, 24)
              .map((row) =>
                `<label class="ph-manage-row"><input type="checkbox" data-pin="${esc(row.key)}"${row.pin >= 0 ? " checked" : ""}>` +
                `<span>${esc(row.label)}</span><b>${row.count}</b><i>${esc(row.family)}</i></label>`,
              )
              .join("")
          : `<span class="ph-none">暂无阶段</span>`) +
        `</div>` +
        `<div class="ph-ai">` +
        `<span class="ph-ai-l">Small Model</span>` +
        `<button type="button" class="ph-toggle" data-ai-test${aiTest.state === "running" ? " disabled" : ""}>` +
        `${aiTest.state === "running" ? "请求中…" : "测试连接"}</button>` +
        (aiTest.text
          ? `<span class="ph-ai-msg ${aiTest.state}">${esc(aiTest.text)}</span>`
          : `<span class="ph-ai-hint">发一次最小请求：不写词表、不占归类配额</span>`) +
        `</div>` +
        `<div class="ph-hint">勾选即置顶：无论怎么排序，置顶的阶段都在第一行。归类只影响显示，回滚不碰任务数据。</div>` +
        `</div>`
      : "")
}

/** Clicking a chip is a filter, not a stat: same phase again clears it. */
function togglePhaseFilter(key) {
  filter.phase = filter.phase === key ? "all" : key
  if (controls.phase) controls.phase.update({ value: filter.phase })
  lastKey = ""
  paintSummary()
  paint()
}

// ---- learned taxonomy --------------------------------------------------------

/** Point the view at a store. The view never reads the store directly. */
function applyStore(next) {
  taxonomyStore = next
  taxonomy = { aliases: next.aliases, familyMap: next.familyMap, pinned: next.pinned }
}

/** Read the store once per page. A host that refuses it leaves the rules only. */
async function loadTaxonomy() {
  if (taxonomyLoaded || !host) return
  taxonomyLoaded = true
  try {
    applyStore(parseStore(await host.storage.get(TAXONOMY_KEY)))
  } catch {
    applyStore(emptyStore())
  }
}

async function saveTaxonomy() {
  try {
    await host.storage.set(TAXONOMY_KEY, taxonomyStore)
  } catch {
    /* the view already applied it; a reload simply falls back to the rules */
  }
}

/**
 * The automatic pass. Four gates and an in-flight guard stand between a poll and a
 * model call, so a quiet board never spends anything: the words must be new, the
 * cooldown expired, the daily budget unspent, and no backoff pending.
 */
function maybeClassify() {
  if (classifying || !host || typeof host.generate !== "function") return
  if (document.hidden || sessionBusy) return
  if (Date.now() - aiArmedAt < IDLE_AI_MS) return
  const { byPhase } = workspaceCounts()
  const names = unknownNames(byPhase, taxonomyStore)
  if (!names.length) return
  const hash = hashNames(names)
  if (!gate(taxonomyStore, hash, Date.now()).ok) return
  void runClassify(names, hash)
}

/**
 * One request, one frozen result. The answer is validated against the exact batch,
 * so an invented label or family is dropped instead of entering the store.
 */
async function runClassify(names, hash) {
  if (classifying || !names.length) return
  classifying = true
  paintSummary()
  try {
    const { system, prompt } = buildPrompt(names, taxonomyStore)
    const result = await host.generate({ prompt, system, maxOutputTokens: 2000 })
    const answer = parseAnswer(result && result.text, names)
    if (!answer.map.length) throw new Error("EMPTY_ANSWER")
    applyStore(mergeStore(taxonomyStore, answer, hash, Date.now()))
    await saveTaxonomy()
  } catch (error) {
    const code = String((error && error.code) || "")
    applyStore(failStore(taxonomyStore, Date.now(), code === "NO_MODEL" ? "no-model" : ""))
    await saveTaxonomy()
    // The permission/model problem is the reader's to fix; say it once, then stay quiet.
    if (!aiToastShown && (code === "NO_MODEL" || code === "PERMISSION_DENIED" || code === "UNSUPPORTED")) {
      aiToastShown = true
      host.toast({ kind: "info", message: "未配置 Small Model，阶段归类暂用内置规则。" })
    }
  } finally {
    classifying = false
    lastKey = ""
    void refresh()
  }
}

/** The reader asked for it: skip the gates, keep the in-flight guard. */
function runClassifyNow() {
  const { byPhase } = workspaceCounts()
  const names = unknownNames(byPhase, taxonomyStore)
  if (!names.length) return
  void runClassify(names, hashNames(names))
}

/** Undo the last learned batch. The words go back to being unknown, and may retry. */
async function undoClassification() {
  if (!taxonomyStore.previous) return
  applyStore(rollbackStore(taxonomyStore, Date.now()))
  await saveTaxonomy()
  lastKey = ""
  await refresh()
}

/** Pin (or unpin) a phase: pinned rows are drawn first in every sort mode. */
function togglePin(key, on) {
  const pinned = taxonomyStore.pinned.filter((name) => name !== key)
  if (on) pinned.push(key)
  applyStore({ ...taxonomyStore, pinned })
  void saveTaxonomy()
  paintSummary()
}

/**
 * The explicit Small Model probe.
 *
 * One tiny request, no store writes, no gate consumption: it must be safe to press
 * while diagnosing, and its result must not change what the automatic pass does.
 * This is the only place the reader can see *why* classification is or is not
 * working — the automatic path stays silent by design.
 */
async function testSmallModel() {
  if (aiTest.state === "running") return
  if (!host || typeof host.generate !== "function") {
    aiTest = { state: "fail", text: "当前 OpenChamber 不支持主机生成（需 2.0.4+）" }
    paintSummary()
    return
  }
  aiTest = { state: "running", text: "" }
  paintSummary()
  const started = Date.now()
  try {
    const result = await host.generate({
      prompt: "Reply with exactly: ok",
      system: "Answer with one word. No punctuation, no prose.",
      maxOutputTokens: 8,
    })
    const text = String((result && result.text) || "").replace(/\s+/g, " ").trim()
    const ms = Date.now() - started
    aiTest = text
      ? { state: "ok", text: `已连通 · 返回「${truncate(text, 24)}」· ${ms}ms` }
      : { state: "fail", text: "模型返回了空内容" }
  } catch (error) {
    aiTest = { state: "fail", text: describeGenerateError(error && error.code) }
  }
  paintSummary()
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

/** Ids the auto sweep must leave in view: the open session and the filtered one. */
function keepIDs() {
  const ids = []
  if (currentID) ids.push(currentID)
  if (filter.session !== "all") ids.push(filter.session)
  return ids
}

/** Hold `ids` out of the auto sweep until each of them runs `todowrite` again. */
function holdIDs(ids, at = Date.now()) {
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id === "string" && id !== "") hold[id] = at
  }
}

/** The ids an archive edit removed: the ones a restore or an undo brought back. */
function removedIDs(previous, next) {
  const before = (previous && previous.sessions) || {}
  const after = (next && next.sessions) || {}
  return Object.keys(before).filter((id) => !(id in after))
}

/**
 * One auto sweep: re-read the archive first, so a manual change made while this
 * poll's own read was in flight is merged rather than silently overwritten, then
 * set. Returns the stored value, or null when it was not written (a read that
 * cannot be confirmed is retried next poll; a failed write pauses the sweep).
 */
async function sweepArchive(ids, now) {
  let base = archive
  try {
    base = parseArchive(await host.storage.get(ARCHIVE_KEY))
  } catch {
    return null
  }
  const next = withArchived(base, ids, now)
  try {
    await host.storage.set(ARCHIVE_KEY, next)
  } catch {
    sweepPaused = true
    return null
  }
  return next
}

/** Persist the archive preferences; a refusal keeps them in memory for this page. */
async function savePrefs() {
  try {
    await host.storage.set(PREFS_KEY, prefs)
  } catch (error) {
    host.toast({ kind: "error", message: `偏好未能保存：${(error && error.code) || error}` })
  }
}

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
  // Anything this write un-archives (a restore, or a later undo of an archive)
  // stays out of the sweep until the session runs todowrite again.
  holdIDs(removedIDs(previous, entry))
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

/** Archive every candidate in `ids` as one undoable edit, then close the popover. */
async function archiveChosen(ids) {
  if (!ids.length) return
  archiveOpen = false
  staleIncluded = false
  renderArchivePopover()
  const previous = archive
  await commitArchive(
    withArchived(archive, ids, Date.now()),
    previous,
    `已归档 ${ids.length} 个会话`,
    `已归档 ${ids.length} 个会话，可在「已归档」里恢复。`,
  )
}

const idsOf = (list) => list.map((item) => item.sessionID)

/** The button's label is the candidate count; it is the only thing a poll touches. */
function paintArchiveControl() {
  const total = candidates.finished.length + candidates.stale.length
  if (controls.archive) controls.archive.update({ label: total ? `归档候选 ${total}` : "归档候选 0" })
  if (archiveOpen) renderArchivePopover()
}

function onOutsidePointer(event) {
  const hostEl = el("archiveHost")
  if (hostEl && event.target instanceof Node && hostEl.contains(event.target)) return
  closeArchivePopover()
}

function closeArchivePopover() {
  archiveOpen = false
  const hostEl = el("archiveHost")
  const pop = hostEl ? hostEl.querySelector(".arch-pop") : null
  if (pop) pop.remove()
  document.removeEventListener("pointerdown", onOutsidePointer, true)
}

function toggleArchivePopover() {
  if (archiveOpen) {
    closeArchivePopover()
    return
  }
  archiveOpen = true
  renderArchivePopover()
  document.addEventListener("pointerdown", onOutsidePointer, true)
}

/**
 * The popover: what the two candidate lists hold, the sweep switch and its age
 * threshold, and the two bulk actions. Rebuilt only while open — a closed popover
 * costs nothing per poll.
 */
function renderArchivePopover() {
  const hostEl = el("archiveHost")
  if (!hostEl) return
  let pop = hostEl.querySelector(".arch-pop")
  if (!archiveOpen) {
    if (pop) pop.remove()
    return
  }
  if (!pop) {
    pop = document.createElement("div")
    pop.className = "arch-pop"
    pop.setAttribute("role", "dialog")
    pop.setAttribute("aria-label", "归档")
    hostEl.append(pop)
  }
  const fin = candidates.finished.length
  const stale = candidates.stale.length
  const all = fin + (staleIncluded ? stale : 0)
  pop.innerHTML =
    `<div class="ap-head"><b>归档候选 ${fin + stale}</b>` +
    `<span>已完成 ${fin} · 超期 ${stale}</span></div>` +
    `<div class="ap-row"><span class="ap-l">已完成 · 超期 ${prefs.days} 天</span>` +
    `<b class="ap-n">${fin}</b><span class="ap-tag">自动</span></div>` +
    `<label class="ap-row ap-check${stale ? "" : " muted"}"><input type="checkbox" id="apStale"${staleIncluded ? " checked" : ""}${stale ? "" : " disabled"}>` +
    `<span class="ap-l">超期未完成 · 仅提示</span><b class="ap-n">${stale}</b><span class="ap-tag manual">手动</span></label>` +
    `<div class="ap-hint">未勾选时只计数，不进任何自动流程；勾选后才随本次一并归档，仍可撤销。</div>` +
    `<div class="ap-hr"></div>` +
    `<label class="ap-row ap-check"><input type="checkbox" id="apAuto"${prefs.auto ? " checked" : ""}>` +
    `<span class="ap-l">自动归档已完成</span></label>` +
    `<div class="ap-row ap-days"><span>超过</span>` +
    `<input id="apDays" type="number" min="0" max="365" step="1" value="${prefs.days}" aria-label="超期天数">` +
    `<span>天</span></div>` +
    `<div class="ap-hr"></div>` +
    `<div class="ap-actions">` +
    `<button type="button" id="apFinished" class="ap-btn"${fin ? "" : " disabled"}>仅归档已完成 ${fin}</button>` +
    (staleIncluded && all ? `<button type="button" id="apAll" class="ap-btn pri">全部归档 ${all}</button>` : "") +
    `</div>`

  const staleBox = pop.querySelector("#apStale")
  if (staleBox) {
    staleBox.addEventListener("change", () => {
      staleIncluded = staleBox.checked
      renderArchivePopover()
    })
  }
  const autoBox = pop.querySelector("#apAuto")
  if (autoBox) {
    autoBox.addEventListener("change", () => {
      prefs.auto = autoBox.checked
      void savePrefs()
      lastKey = ""
      void refresh()
    })
  }
  const daysInput = pop.querySelector("#apDays")
  if (daysInput) {
    daysInput.addEventListener("change", () => {
      const next = clampDays(daysInput.value, prefs.days)
      daysInput.value = String(next)
      if (next === prefs.days) return
      prefs.days = next
      void savePrefs()
      lastKey = ""
      void refresh()
    })
  }
  const finishedButton = pop.querySelector("#apFinished")
  if (finishedButton) finishedButton.addEventListener("click", () => { void archiveChosen(idsOf(candidates.finished)) })
  const allButton = pop.querySelector("#apAll")
  if (allButton) allButton.addEventListener("click", () => {
    void archiveChosen([...idsOf(candidates.finished), ...idsOf(candidates.stale)])
  })
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
  holdIDs(removedIDs(archive, target))
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
  const { byPhase } = workspaceCounts()
  const { rows } = buildRows(byPhase, { aliases: taxonomy.aliases, familyMap: taxonomy.familyMap, showEmpty: false })
  // The count belongs in the label: with 150 names the list was unreadable, and
  // sorting by count is the only order a reader can act on.
  const options = [{ id: "all", label: "全部阶段" }]
  for (const row of rows) options.push({ id: row.key, label: `${row.label} (${row.count})` })
  if (filter.phase !== "all" && !rows.some((row) => row.key === filter.phase)) {
    options.push({ id: filter.phase, label: filter.phase })
  }
  controls.phase.update({ options, value: filter.phase })
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
  // One control for both the sweep and the bulk run: the count is the button's
  // label, and the settings live behind it, so the toolbar keeps a single row.
  controls.archive = mountButton(el("archiveHost"), {
    label: "归档候选 0",
    variant: "secondary",
    size: "sm",
    onClick: () => { toggleArchivePopover() },
  })

  el("sessions").addEventListener("scroll", onSessionsScroll, { passive: true })
  el("summary").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    const chip = target.closest("[data-phase]")
    if (chip) { togglePhaseFilter(chip.dataset.phase); return }
    const family = target.closest("[data-family]")
    if (family) {
      phaseView.openFamily = phaseView.openFamily === family.dataset.family ? "" : family.dataset.family
      paintSummary()
      return
    }
    const sort = target.closest("[data-sort]")
    if (sort) { phaseView.sort = sort.dataset.sort; paintSummary(); return }
    if (target.closest("[data-show-empty]")) { phaseView.showEmpty = !phaseView.showEmpty; paintSummary(); return }
    if (target.closest("[data-expand]")) { phaseView.expanded = true; paintSummary(); return }
    if (target.closest("[data-collapse]")) { phaseView.expanded = false; paintSummary(); return }
    if (target.closest("[data-classify]")) { runClassifyNow(); return }
    if (target.closest("[data-ai-test]")) { void testSmallModel(); return }
    if (target.closest("[data-manage]")) { manageOpen = !manageOpen; paintSummary(); return }
    if (target.closest("[data-undo-classify]")) { void undoClassification(); return }
  })
  el("summary").addEventListener("change", (event) => {
    const target = event.target instanceof Element ? event.target : null
    const box = target ? target.closest("[data-pin]") : null
    if (!box) return
    togglePin(box.dataset.pin, box.checked)
  })
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

/**
 * The index metas, re-read only when the file's stat moved.
 *
 * The stamp is the cheap half of the pair: the host still answers with one
 * round trip, but a quiet poll never ships or parses the workspace index.
 * `host.stat` is absent on older hosts, which simply falls back to reading.
 */
async function readIndexMetas() {
  const path = `${TODOS_DIR}/_index.json`
  let stamp = ""
  if (typeof host.stat === "function") {
    const info = await host.stat(path)
    stamp = `${info.kind}:${info.size}:${info.mtime}`
    if (indexMetas !== null && stamp === indexStamp) return indexMetas
  }
  const { content } = await host.readFile(path)
  const metas = parseIndex(content)
  if (metas === null) throw new Error("BAD_INDEX")
  indexStamp = stamp
  indexMetas = metas
  return metas
}

async function refresh() {
  if (!host) return
  // Read once per page: the learned taxonomy changes only when this page writes it.
  if (!taxonomyLoaded) await loadTaxonomy()
  let metas
  try {
    metas = await readIndexMetas()
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
  // `readOk` remembers that this read succeeded: the auto sweep is skipped when it
  // did not, so an unreadable archive is never replaced with a blind empty set.
  let rawArchive
  try {
    rawArchive = await host.storage.get(ARCHIVE_KEY)
    readOk = true
  } catch {
    rawArchive = undefined
    readOk = false
  }
  let nextArchive = parseArchive(rawArchive)

  // Preferences: a host that refuses or lacks them keeps the in-memory default.
  try {
    const stored = parsePrefs(await host.storage.get(PREFS_KEY))
    if (stored.auto !== prefs.auto || stored.days !== prefs.days) prefs = stored
  } catch {
    /* keep the current preference */
  }

  // Silent auto sweep: set finished sessions past the age threshold aside on their
  // own, with no toast and no undo. Open work is never swept — the stale list is
  // only counted. Skipped when storage could not be read, when the preference is
  // off, or after a failed write. The open and filtered sessions are left in view.
  if (prefs.auto && readOk && !sweepPaused) {
    const now = Date.now()
    const ids = autoArchiveIDs(metas, nextArchive, { keep: keepIDs(), hold, now, readOk, days: prefs.days })
    if (ids.length) {
      const merged = await sweepArchive(ids, now)
      if (merged) nextArchive = merged
    }
  }

  const phases = []
  const seen = new Set()
  for (const meta of metas) {
    for (const phase of (meta.phases || [])) if (phase && !seen.has(phase)) { seen.add(phase); phases.push(phase) }
    for (const phase of Object.keys(meta.byPhase || {})) if (phase && !seen.has(phase)) { seen.add(phase); phases.push(phase) }
  }
  // Recomputed here, not in the paint: the button's count must track the index.
  // The two counts join the dirty key so a session crossing the threshold — or a
  // change in the days setting — repaints, while a quiet poll still does nothing.
  candidates = archiveCandidates(metas, nextArchive, { keep: keepIDs(), hold, now: Date.now(), days: prefs.days })
  const key = JSON.stringify([
    metas, loadedCount, filter, currentID, nextArchive, showArchived, archivedLoadedCount,
    prefs.auto, prefs.days, hold, candidates.finished.length, candidates.stale.length,
  ])
  if (key === lastKey) return
  lastKey = key

  allMetas = metas
  archive = nextArchive
  const split = partition(metas, archive, currentID)
  agenda = split.active
  archived = split.archived
  globalPhases = phases
  if (filter.session !== "all") {
    const chosen = metaOf(filter.session)
    // Bounce to "all" when the filtered session is gone or filed away — but not the
    // open one: single-viewing the current session and archiving it keeps it in view.
    if (!chosen || (isArchived(archive, chosen) && chosen.sessionID !== currentID)) filter.session = "all"
  }
  updateSessionOptions()
  // Rebuilt whenever the counts move, not just the names: the label carries the count.
  updatePhaseOptions()
  paintSummary()
  paintArchiveControl()
  await renderBoard()
}

const pollDelay = () => (sessionBusy ? BUSY_POLL_MS : IDLE_POLL_MS)

/** Arm the next read, unless the loop is off or the page is hidden. */
function arm() {
  if (!polling || document.hidden) return
  clearTimeout(timer)
  timer = setTimeout(tick, pollDelay())
}

async function tick() {
  timer = null
  try {
    await refresh()
    // Outside `refresh`: a quiet poll returns early on an unchanged key, and the
    // automatic pass still has to get a chance once the idle window has passed.
    maybeClassify()
  } finally {
    arm()
  }
}

function start() {
  polling = true
  if (timer !== null) return
  arm()
}

function reschedule() {
  if (!polling) return
  arm()
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(timer)
    timer = null
    return
  }
  if (!polling) return
  aiArmedAt = Date.now()
  void refresh()
  arm()
})

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
    // No `requestTimeoutMs` on purpose: the SDK then gives ordinary calls 20 s and
    // `generate` its own 90 s. Overriding it would cap the model at the file-read
    // timeout, which is why a slow Small Model used to fail as HOST_TIMEOUT.
    host = connectHost()
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
    start()
  })
  host.onSession((session) => {
    sessionBusy = Boolean(session && session.busy === true)
    setCurrent(session)
    reschedule()
  })
}

boot()
