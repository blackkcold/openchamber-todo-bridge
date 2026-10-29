/**
 * Todos — the task board.
 *
 * A full-screen page: every session's tasks in one place, with a cross-session
 * summary, filters, a session selector, and a node detail. Opened from
 * OpenChamber's Extension pages menu.
 *
 * The default view is the work queue, not the archive: sessions with open work,
 * blocked first and newest first inside a band. "全部" and "已完成" are scopes on
 * the same list; a filter renders only matching rows (plus the ancestors that
 * lead to them), never the old dim-everything-else version.
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
import { applyHostReady, mountButton, mountSearchField, mountSelect, mountTabs } from "@openchamber/sdk/ui"

import { buildTree, INDENT, phaseColor, pruneFinished } from "./graph.js"
import { GUT_NODE, ensureGutStyle, gutterSvg } from "./gutter.js"
import { parseDoc, parseIndex } from "./doc.js"
import { filterList, hasOpenWork, inScope, isBlocked, relativeTime, scopeMetas } from "./queue.js"
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
  ARCHIVE_VERSION,
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
/** A quiet poll reuses the in-memory archive/prefs instead of two storage reads. */
const ARCHIVE_READ_TTL_MS = 10_000
const PREFS_READ_TTL_MS = 30_000
const TODOS_DIR = "~/.config/openchamber/todos"
const UNGROUPED = "未分组"
/** Sessions drawn before the first scroll; the sentinel loads the next batch. */
const BATCH = 15
/** Open rows a card draws before folding; the rest sit behind "还有 N 项". */
const CARD_TOP = 3

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
/**
 * sessionID -> { title, updatedAt, directory } from the host's own session list.
 * The index carries a task-derived label; the host knows the real chat title.
 * Read once per page, best effort: a host that refuses or lacks it leaves the
 * index label in place.
 */
let sessionInfo = new Map()
let sessionInfoLoaded = false
let sessionInfoLoading = false
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
/** sessionID -> the `updatedAt` whose mirror could not be read; retried when it moves. */
const docFailures = new Map()
let loadedCount = BATCH
let currentID = null
let renderSeq = 0
let loadingMore = false
const filter = { query: "", status: "all", phase: "all", scope: "open", session: "all" }
let selected = null
/** Session cards the reader expanded past the top three open rows. */
const expandedSessions = new Set()
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
/** When the stored archive was last read successfully, and whether we have one. */
let archiveReadAt = 0
let archiveReady = false
/** When the archive preferences were last read successfully. */
let prefsReadAt = 0
/** Set after a failed auto write (e.g. the document is over the size cap): stop the
 *  silent retry every poll, so a full archive is not written against every 4s. */
let sweepPaused = false
/**
 * The three candidate lists, recomputed from the index on every refresh — never a
 * mirror read. `manual` is the reader's explicit bulk run (all finished, no age
 * gate); `finished` is what the sweep may write; `stale` (open work, old) is only
 * ever counted and listed, and archived only when the reader ticks it.
 */
let candidates = { finished: [], stale: [], manual: [] }
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
/** The phase filter panel is open. */
let filterOpen = false
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

/**
 * The session label. The host's own title wins; the index summary is the
 * fallback, and a task-derived label is the last resort. A page that never got
 * the host list (no permission, older host) still reads exactly as before.
 */
function titleOf(meta, doc) {
  const info = meta ? sessionInfo.get(meta.sessionID) : null
  if (info && info.title) return info.title
  if (meta && meta.title) return meta.title
  const todos = doc ? doc.todos : []
  const active = todos.find((todo) => todo.status === "in_progress")
  const root = todos.find((todo) => !todo.parentId)
  return (active || root || {}).content || (meta ? meta.sessionID : "")
}

/** The directory a session belongs to, when the host list supplied it. */
function directoryOf(meta) {
  const info = meta ? sessionInfo.get(meta.sessionID) : null
  return info && info.directory ? info.directory : ""
}

function filtering() {
  return filter.query !== "" || filter.status !== "all" || filter.phase !== "all"
}

function matches(todo, statusById) {
  if (filter.status === "blocked") {
    if (!isBlocked(todo, statusById)) return false
  } else if (filter.status !== "all" && todo.status !== filter.status) return false
  if (filter.query && !todo.content.toLowerCase().includes(filter.query.toLowerCase())) return false
  // The cloud merges names that fold together, so the filter compares the folded
  // form too — otherwise a chip that says "P0 止血" would match nothing.
  if (filter.phase !== "all" && normalizePhase(todo.phase || "") !== filter.phase) return false
  return true
}

/** What a card draws, before and after a filter. */
function rowsFor(session) {
  // Finished work is hidden inside a session that still has open work. A
  // finished session shows its list, and an explicit status filter always wins.
  const open = session.todos.some((todo) => !isDone(todo.status))
  const wantsFinished = filter.status === "completed" || filter.status === "cancelled" || !open
  const base = wantsFinished ? session.todos : pruneFinished(session.todos)
  // `blocked` is a derived status, so the predicate needs the whole session's
  // status map even when the rows themselves are filtered.
  const statusById = new Map()
  for (const todo of session.todos) if (todo.id) statusById.set(todo.id, todo.status)
  if (!filtering()) {
    const openTodos = base.filter((todo) => !isDone(todo.status))
    const fold = openTodos.length > CARD_TOP &&
      session.sessionID !== currentID &&
      filter.session !== session.sessionID &&
      !expandedSessions.has(session.sessionID)
    if (!fold) return { todos: base, matches: 0, folded: 0, statusById }
    const first = new Set(openTodos.slice(0, CARD_TOP))
    const { todos } = filterList(base, (todo) => first.has(todo))
    return { todos, matches: 0, folded: openTodos.length - CARD_TOP, statusById }
  }
  const { todos, count } = filterList(base, (todo) => matches(todo, statusById))
  return { todos, matches: count, folded: 0, statusById }
}

/** Whether a loaded session has any row the active filter would draw. */
function hasMatch(meta) {
  const doc = docOf(meta)
  // A mirror that failed to load is shown with its retry card even under a
  // filter: silently dropping it would hide the only sign that work is missing.
  if (!doc) return docFailures.get(meta.sessionID) === meta.updatedAt
  return rowsFor(materialize(meta)).matches > 0
}

function scopeLabel() {
  if (filter.scope === "done") return "已完成会话"
  if (filter.scope === "all") return "全部会话"
  return "待办会话"
}

function scopeEmptyNote() {
  if (filter.scope === "done") return "还没有已完成的会话。"
  if (filter.scope === "open") return "没有待办会话。所有任务都已完成。"
  return archived.length
    ? "当前没有进行中的会话；下面是被收起的。"
    : "还没有任何会话的任务。在任一会话里触发一次任务更新（todowrite）即可。"
}

/** The session pinned to the top: the open session, when it belongs to the scope. */
function pinnedMeta() {
  const byCurrent = currentID ? metaOf(currentID) : null
  return byCurrent && inScope(byCurrent, filter.scope) ? byCurrent : null
}

/**
 * The session-level half of a filter, answered from the index summary. A
 * session whose summary already says "no blocked task" never has to open its
 * mirror for a blocked filter. An older index without a summary stays in the
 * candidate list and is decided after its mirror loads.
 */
function metaMatchesStatus(meta) {
  if (filter.status === "all") return true
  if (!meta || !Number.isFinite(meta.total)) return true
  if (filter.status === "blocked") return (meta.blocked || 0) > 0
  if (filter.status === "in_progress") return (meta.doing || 0) > 0
  if (filter.status === "pending") return (meta.pending || 0) > 0
  if (filter.status === "completed") return (meta.done || 0) > 0
  if (filter.status === "cancelled") return (meta.cancelled || 0) > 0
  return true
}

/** Phase names fold cosmetically, so compare the folded form to the chip key. */
function metaMatchesPhase(meta) {
  if (filter.phase === "all") return true
  if (!meta || !Number.isFinite(meta.total)) return true
  for (const [name, count] of Object.entries(meta.byPhase || {})) {
    if ((count || 0) > 0 && normalizePhase(name) === filter.phase) return true
  }
  return false
}

/**
 * The sessions the current scope and filter may draw, before any mirror is
 * opened. Status and phase are index questions; the text query still needs the
 * mirror, so it is applied card by card after this prefilter.
 */
function candidateMetas() {
  let list = scopeMetas(agenda, filter.scope)
  if (filter.status !== "all") list = list.filter(metaMatchesStatus)
  if (filter.phase !== "all") list = list.filter(metaMatchesPhase)
  return list
}

/** Every session below the pinned card, in the current scope's order. */
function listMetas() {
  const pinned = pinnedMeta()
  const pinnedID = pinned ? pinned.sessionID : null
  return candidateMetas().filter((meta) => meta.sessionID !== pinnedID)
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
  const need = metas.filter((meta) => !docOf(meta) && docFailures.get(meta.sessionID) !== meta.updatedAt)
  if (!need.length) return
  await Promise.all(need.map(async (meta) => {
    try {
      const { content } = await host.readFile(`${TODOS_DIR}/${meta.sessionID}.json`)
      const doc = parseDoc(content)
      if (doc) {
        docCache.set(meta.sessionID, { updatedAt: meta.updatedAt, todos: doc.todos, phases: doc.phases })
        docFailures.delete(meta.sessionID)
      } else {
        docFailures.set(meta.sessionID, meta.updatedAt)
      }
    } catch {
      // A missing or unreadable mirror is a card state, not a fatal board error.
      docFailures.set(meta.sessionID, meta.updatedAt)
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
function sessionHeader(meta, opts = {}, matchCount = 0) {
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
    ? `<button type="button" class="sess-act" data-archive="${esc(meta.sessionID)}" title="收起这个会话，放到「已收起」">收起</button>`
    : opts.restore
      ? `<button type="button" class="sess-act" data-restore="${esc(meta.sessionID)}" title="把这个会话移回最近会话">恢复</button>`
      : ""
  const counts = `${done}/${total}${matchCount ? ` · ${matchCount} 项匹配` : ""}`
  const title = titleOf(meta, doc)
  const directory = directoryOf(meta)
  return (
    `<div class="sess-head"><h3${directory ? ` title="${esc(directory)}"` : ""}>${esc(title)}</h3>` +
    `<span class="time">${relativeTime(meta.updatedAt)}</span>` +
    `<span class="cnt">${counts}</span>${action}</div>` +
    `<div class="prog"><i style="width:${pct}%"></i></div>`
  )
}

/** Finished work is hidden by default; this note stands in for a hidden tree. */
function hiddenNote(session) {
  const hidden = session.todos.length - pruneFinished(session.todos).length
  return `<div class="note" style="padding:4px 6px">${hidden} 项已完成，已隐藏（状态筛选「已完成」查看）。</div>`
}

/** Draw only the rows the filter kept; ancestors stay as context, not matches. */
function treeRowsHtml(session, visible) {
  const list = visible.todos
  if (!list.length) return hiddenNote(session)
  // `data-index` must name the original list, the one the detail panel reads.
  const original = new Map(session.todos.map((todo, index) => [todo, index]))
  const { rows } = buildTree(list, globalPhases)
  const html = rows
    .map((row) => {
      const width = row.depth * INDENT + GUT_NODE
      if (row.synthetic) {
        return (
          `<div class="row group" data-session="${esc(session.sessionID)}">` +
          `<span class="gut" style="width:${width}px">${gutterSvg(row, "")}</span>` +
          `<span class="txt group-label">${esc(row.content)}</span></div>`
        )
      }
      const todo = list[row.index]
      const index = original.get(todo)
      const sel = selected && selected.sessionID === session.sessionID && selected.index === index ? " sel" : ""
      const blocked = isBlocked(todo, visible.statusById) ? `<span class="pill blocked">受阻</span>` : ""
      const phase = todo.phase ? `<span class="pill">${esc(todo.phase)}</span>` : ""
      return (
        `<div class="row ${esc(todo.status)}${sel}" data-session="${esc(session.sessionID)}" data-index="${index}"` +
        ` role="button" tabindex="-1" aria-pressed="${sel ? "true" : "false"}">` +
        `<span class="gut" style="width:${width}px">${gutterSvg(row, todo.status)}</span>` +
        `<span class="txt">${esc(todo.content)}</span>${blocked}${phase}</div>`
      )
    })
    .join("")
  const more = visible.folded
    ? `<button type="button" class="row-more" data-expand-session="${esc(session.sessionID)}">还有 ${visible.folded} 项未完成</button>`
    : ""
  return html + more
}

function sessionCard(meta, current, archivedCard = false) {
  const doc = docOf(meta)
  let body = `<div class="note">加载中…</div>`
  let matchCount = 0
  if (doc) {
    const session = materialize(meta)
    const visible = rowsFor(session)
    matchCount = visible.matches
    body = treeRowsHtml(session, visible)
  } else if (docFailures.get(meta.sessionID) === meta.updatedAt) {
    body = `<div class="note">任务镜像读取失败。` +
      `<button type="button" class="link" data-retry-session="${esc(meta.sessionID)}">重试</button></div>`
  }
  const tag = current ? `<div class="pin-tag">当前会话</div>` : ""
  const opts = archivedCard ? { restore: true } : { archive: true }
  const cls = `sess${current ? " pinned" : ""}${archivedCard && !current ? " archived" : ""}`
  return `<section class="${cls}" data-session="${esc(meta.sessionID)}">${tag}${sessionHeader(meta, opts, matchCount)}${body}</section>`
}

/**
 * Ensure exactly one task row is a tab stop: the selected one, or the first.
 * Roving tabindex keeps 50 rows from becoming 50 Tab presses.
 */
function ensureRowTabStop() {
  const box = el("sessions")
  if (!box) return
  const rows = box.querySelectorAll(".row[data-index]")
  if (!rows.length) return
  const target = box.querySelector(".row.sel[data-index]") || rows[0]
  for (const row of rows) row.tabIndex = -1
  target.tabIndex = 0
}

/** Select a row and repaint; `focus` carries keyboard focus through the repaint. */
function selectRow(row, focus = false) {
  if (!row || row.dataset.index === undefined) return
  selected = { sessionID: row.dataset.session, index: Number(row.dataset.index) }
  paint()
  if (!focus) return
  const next = el("sessions").querySelector(".row.sel[data-index]")
  if (next) next.focus()
}

/** Move the roving tab stop one row up or down, and take focus with it. */
function moveRowFocus(row, step) {
  const box = el("sessions")
  if (!box) return
  const rows = [...box.querySelectorAll(".row[data-index]")]
  const at = rows.indexOf(row)
  if (at < 0) return
  const next = rows[Math.max(0, Math.min(rows.length - 1, at + step))]
  if (!next || next === row) return
  for (const item of rows) item.tabIndex = -1
  next.tabIndex = 0
  next.focus()
  next.scrollIntoView({ block: "nearest" })
}

function sentinelHtml(list, considered) {
  const more = considered.length < list.length
  let html = more
    ? `<div id="sentinel" class="sentinel">↓ 滚动到底加载下一批（还有 ${list.length - considered.length} 个会话）</div>`
    : `<div class="endnote">已到末尾 · 共 ${list.length} 个会话</div>`
  if (filter.query && more) {
    html += `<div class="endnote">文本搜索只作用于已加载的 ${considered.length} 个会话 · ` +
      `<button type="button" id="loadAll" class="link">加载全部以搜索</button></div>`
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
    ensureRowTabStop()
    observeSentinel()
    return
  }

  const pinned = pinnedMeta()
  const list = listMetas()
  const considered = list.slice(0, loadedCount)
  const shown = filtering() ? considered.filter(hasMatch) : considered
  const cards = shown.map((meta) => sessionCard(meta, false)).join("")
  const countNote = filtering() ? ` · 命中 ${shown.length} 个会话` : ""
  // A search shows matches, not the pinned session's header with no rows under it.
  const showPinned = Boolean(pinned) && (!filtering() || hasMatch(pinned))
  const pinnedCard = showPinned ? sessionCard(pinned, pinned.sessionID === currentID, isArchived(archive, pinned)) : ""
  const listBlock = list.length
    ? `<div class="divider">${scopeLabel()} · 已显示 ${considered.length} / ${list.length}${countNote}</div>` +
      (cards || `<div class="note">没有匹配的任务。</div>`) +
      sentinelHtml(list, considered)
    : (showPinned ? "" : `<div class="note">${scopeEmptyNote()}</div>`)
  box.innerHTML = undoBarHtml() + pinnedCard + listBlock + archivedSectionHtml()
  paintDetails()
  ensureRowTabStop()
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
    `<span>已收起 ${archived.length} 个会话</span>` +
    `<span class="n">${items} 项 · ${showArchived ? "收起" : "展开"}</span></button>`
  if (!showArchived) return `<div class="archive">${head}</div>`
  const shown = archivedLoadedCount >= archived.length ? archived : archived.slice(0, archivedLoadedCount)
  const more = archivedLoadedCount < archived.length
    ? `<div id="archivedSentinel" class="sentinel">↓ 加载更多已收起（还有 ${archived.length - archivedLoadedCount} 个）</div>`
    : `<div class="endnote">已到末尾 · 共 ${archived.length} 个已收起会话</div>`
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
  let doing = 0, pending = 0, done = 0, blocked = 0, total = 0, openSessions = 0
  const byPhase = {}
  for (const meta of agenda) {
    if (hasOpenWork(meta)) openSessions += 1
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
      if ((todo.status === "pending" || todo.status === "in_progress") && Array.isArray(todo.dependsOn) && todo.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== "completed")) blocked += 1
      const phase = todo.phase || ""
      byPhase[phase] = (byPhase[phase] || 0) + 1
    }
  }
  return { byPhase, stats: { doing, pending, done, blocked, total, openSessions } }
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
  const stat = (kind, label, cls = "") =>
    `<button type="button" class="stat${cls}" data-stat="${kind}">${label}</button>`
  const activeFilters = (filter.query ? 1 : 0) + (filter.status !== "all" ? 1 : 0) + (filter.phase !== "all" ? 1 : 0)
  el("summary").innerHTML =
    `<div class="stats">${stat("open", `<b title="有未完成任务的会话">${stats.openSessions} 个会话有未完成</b>`)}` +
    stat("doing", `${stats.doing} 个进行中`) +
    stat("pending", `${stats.pending} 个待办`) +
    stat("blocked", `${stats.blocked} 个受阻`, " blocked") +
    stat("done", `${stats.done} 个已完成`) +
    stat("total", `共 ${stats.total} 项`) +
    `<button type="button" class="stat filter" data-filter aria-expanded="${filterOpen}">` +
    `${filterOpen ? "收起筛选" : "筛选"}${activeFilters ? ` · ${activeFilters}` : ""}</button>` +
    (filtering() ? `<button type="button" class="stat clear" data-clear>清除筛选</button>` : "") +
    `</div>` +
    `<div class="phase-panel"${filterOpen ? "" : " hidden"}>` +
    `<div class="phases"><span class="ph-label">阶段分布</span>` +
    `<span class="ph-meta">${rows.length} 个非空 / ${globalPhases.length} 个名称</span>` +
    `<span class="ph-tools">${seg("count", "数量")}${seg("declare", "声明序")}${seg("name", "名称")}</span>` +
    `<button type="button" class="ph-toggle${phaseView.showEmpty ? " on" : ""}" data-show-empty>显示空阶段</button>` +
    (unknownCount
      ? `<button type="button" class="ph-toggle ai${classifying ? " on" : ""}" data-classify${classifying ? " disabled" : ""}>` +
        `${classifying ? "归类中…" : `归类 ${unknownCount} 个新阶段`}</button>`
      : "") +
    `<button type="button" class="ph-toggle${manageOpen ? " on" : ""}" data-manage>管理</button>` +
    `<button type="button" class="ph-close" data-filter-close aria-label="关闭筛选">×</button>` +
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
      : "") +
    `</div>`
}

/** Close the phase panel without repainting; callers paint once when ready. */
function closeFilterPanel() {
  if (!filterOpen) return
  filterOpen = false
  document.removeEventListener("pointerdown", onFilterOutside, true)
  document.removeEventListener("keydown", onFilterKey, true)
}

function onFilterOutside(event) {
  if (!filterOpen) return
  const summary = el("summary")
  if (summary && event.target instanceof Node && summary.contains(event.target)) return
  closeFilterPanel()
  paintSummary()
}

function onFilterKey(event) {
  if (!filterOpen || event.key !== "Escape") return
  event.preventDefault()
  closeFilterPanel()
  paintSummary()
  const button = el("summary") ? el("summary").querySelector("[data-filter]") : null
  if (button) button.focus()
}

/** Open or close the phase panel, moving focus with it. */
function setFilterOpen(open) {
  const next = Boolean(open)
  if (next === filterOpen) {
    if (next) paintSummary()
    return
  }
  if (!next) {
    closeFilterPanel()
    paintSummary()
    const button = el("summary") ? el("summary").querySelector("[data-filter]") : null
    if (button) button.focus()
    return
  }
  filterOpen = true
  paintSummary()
  document.addEventListener("pointerdown", onFilterOutside, true)
  document.addEventListener("keydown", onFilterKey, true)
  const first = el("summary") ? el("summary").querySelector(".phase-panel button, .phase-panel input") : null
  if (first) first.focus()
}

/** Clicking a chip is a filter, not a stat: same phase again clears it. */
function togglePhaseFilter(key) {
  filter.phase = filter.phase === key ? "all" : key
  loadedCount = BATCH
  lastKey = ""
  paintSummary()
  void renderBoard()
}

/** A click on the summary is a filter: sessions / tasks / one status. */
function applyStatFilter(kind) {
  if (kind === "open") {
    filter.scope = "open"
    filter.status = "all"
  } else if (kind === "done") {
    filter.scope = "all"
    filter.status = "completed"
  } else if (kind === "total") {
    filter.scope = "all"
    filter.status = "all"
  } else {
    filter.scope = "open"
    filter.status = kind
  }
  loadedCount = BATCH
  lastKey = ""
  if (controls.status) controls.status.update({ value: filter.status })
  updateScopeControl()
  closeFilterPanel()
  paintSummary()
  const box = el("sessions")
  if (box) box.scrollTop = 0
  void renderBoard()
}

/** Drop every task filter and return to the default queue. */
function clearFilters() {
  filter.query = ""
  filter.status = "all"
  filter.phase = "all"
  filter.scope = "open"
  loadedCount = BATCH
  lastKey = ""
  if (controls.search) controls.search.update({ value: "" })
  if (controls.status) controls.status.update({ value: "all" })
  updateScopeControl()
  closeFilterPanel()
  paintSummary()
  const box = el("sessions")
  if (box) box.scrollTop = 0
  void renderBoard()
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

/**
 * Fill the session labels from the host's own list, once per page.
 *
 * The index carries a task-derived label because the plugin never sees the chat
 * title. The host does. This is best effort: an older host, a refused
 * capability, or an empty project list simply leaves the index label in place.
 * The board paints from the index first and repaints when the labels arrive.
 */
async function loadSessionInfo() {
  if (sessionInfoLoaded || sessionInfoLoading || !host) return
  if (typeof host.listProjects !== "function" || typeof host.listSessions !== "function") {
    sessionInfoLoaded = true
    return
  }
  sessionInfoLoading = true
  try {
    const projects = await host.listProjects()
    const list = projects && Array.isArray(projects.projects) ? projects.projects : []
    const snapshots = await Promise.all(list.map((project) => host.listSessions(project.id).catch(() => null)))
    const next = new Map()
    for (const snapshot of snapshots) {
      const sessions = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : []
      for (const session of sessions) {
        if (!session || typeof session.id !== "string" || session.id === "") continue
        next.set(session.id, {
          title: typeof session.title === "string" ? session.title : "",
          updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
          directory: typeof session.directory === "string" ? session.directory : "",
        })
      }
    }
    if (next.size) {
      sessionInfo = next
      sessionInfoLoaded = true
      lastKey = ""
      void refresh()
    } else {
      sessionInfoLoaded = true
    }
  } catch {
    sessionInfoLoaded = true
  } finally {
    sessionInfoLoading = false
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

const STATUS_LABELS = { pending: "待办", in_progress: "进行中", completed: "已完成", cancelled: "已取消" }
const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" }
const statusLabel = (status) => STATUS_LABELS[status] || status || "—"
const priorityLabel = (priority) => PRIORITY_LABELS[priority] || priority || "—"

function paintDetails() {
  for (const handle of detailHandles) handle.dispose()
  detailHandles = []
  const box = el("details")
  const meta = selected ? metaOf(selected.sessionID) : null
  const doc = meta ? docOf(meta) : null
  const todo = doc && selected ? doc.todos[selected.index] : null
  // The detail is a drawer: absent until a row is chosen, and closed by its own
  // button. An empty 280px rail used to sit beside every board.
  box.classList.toggle("open", Boolean(todo))
  box.setAttribute("aria-hidden", todo ? "false" : "true")
  if (!todo) {
    box.innerHTML = ""
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
    `<div class="detail-head"><h3>任务详情</h3>` +
    `<button type="button" class="detail-close" id="detailClose" aria-label="关闭详情">×</button></div>` +
    `<div class="content">${esc(todo.content)}</div>` +
    `<div class="kv">状态：${esc(statusLabel(todo.status))}</div>` +
    `<div class="kv">阶段：${esc(todo.phase || "—")}</div>` +
    `<div class="kv">优先级：${esc(priorityLabel(todo.priority))}</div>` +
    `<div class="kv">依赖：<br>${depHtml}</div>` +
    `<div class="kv">会话：<span title="${esc(meta.sessionID)}">${esc(titleOf(meta, doc))}</span></div>` +
    (meta.sessionID === currentID ? "" : `<div class="kv">「交给 AI」只作用于当前会话。</div>`) +
    `<div class="actions" id="detailActions"></div>`
  const actions = el("detailActions")
  const open = document.createElement("div")
  actions.append(open)
  detailHandles.push(
    mountButton(open, { label: "打开会话", size: "sm", onClick: () => openSession(meta.sessionID) }),
  )
  // Compose has no session target: it writes into the chat box of the session
  // this page sits beside. Offering it for another session would silently aim the
  // instruction at the wrong conversation, so only the current one gets it.
  if (meta.sessionID === currentID) {
    const hand = document.createElement("div")
    actions.append(hand)
    detailHandles.push(
      mountButton(hand, { label: "交给 AI 处理", variant: "secondary", size: "sm", onClick: () => handOff(todo) }),
    )
  }
  const copy = document.createElement("div")
  actions.append(copy)
  detailHandles.push(
    mountButton(copy, { label: "复制", variant: "ghost", size: "sm", onClick: () => copyTodo(todo) }),
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

/** The ids an archive edit added: the ones it newly stamped. */
function addedIDs(previous, next) {
  const before = (previous && previous.sessions) || {}
  const after = (next && next.sessions) || {}
  return Object.keys(after).filter((id) => !(id in before))
}

/**
 * Apply the delta between `previous` and `entry` to the latest stored document.
 *
 * A manual edit must not replace the whole document: a poll's sweep may have
 * stamped another session while this click was in flight. Only the ids this edit
 * adds or removes are touched, so both edits survive. Pure.
 */
function mergeArchiveDelta(stored, previous, entry) {
  const before = (previous && previous.sessions) || {}
  const after = (entry && entry.sessions) || {}
  const sessions = { ...(stored && stored.sessions ? stored.sessions : {}) }
  for (const id of addedIDs(previous, entry)) {
    const at = after[id]
    if (Number.isFinite(at)) sessions[id] = at
  }
  for (const id of removedIDs(previous, entry)) delete sessions[id]
  return { version: ARCHIVE_VERSION, sessions }
}

/**
 * Serialize archive read/write pairs. The board is single-threaded, but a poll's
 * sweep and a manual click can interleave at an `await`; the queue keeps each
 * read-modify-write atomic relative to the other.
 */
let archiveTail = Promise.resolve()
function withArchiveLock(task) {
  const run = archiveTail.catch(() => {}).then(task)
  archiveTail = run.catch(() => {})
  return run
}

/**
 * One auto sweep: re-read the archive first, so a manual change made while this
 * poll's own read was in flight is merged rather than silently overwritten, then
 * set. Returns the stored value, or null when it was not written (a read that
 * cannot be confirmed is retried next poll; a failed write pauses the sweep).
 */
async function sweepArchive(ids, now) {
  return withArchiveLock(async () => {
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
    archive = next
    archiveReady = true
    archiveReadAt = Date.now()
    return next
  })
}

/** Persist the archive preferences; a refusal keeps them in memory for this page. */
async function savePrefs() {
  try {
    await host.storage.set(PREFS_KEY, prefs)
    prefsReadAt = Date.now()
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
    await withArchiveLock(async () => {
      const stored = parseArchive(await host.storage.get(ARCHIVE_KEY))
      const next = mergeArchiveDelta(stored, previous, entry)
      await host.storage.set(ARCHIVE_KEY, next)
      archive = next
    })
    archiveReady = true
    archiveReadAt = Date.now()
  } catch (error) {
    archive = previous
    archiveReady = false
    clearUndo()
    host.toast({ kind: "error", message: `收起未能保存：${(error && error.code) || error}` })
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
    "已收起 1 个会话",
    "已收起 1 个会话，可在「已收起」里恢复。",
  )
}

async function restoreSession(sessionID) {
  const previous = archive
  await commitArchive(withoutArchived(archive, [sessionID]), previous, "已恢复 1 个会话", "已恢复 1 个会话。")
}

/** Archive every candidate in `ids` as one undoable edit, then close the popover. */
async function archiveChosen(ids) {
  if (!ids.length) return
  staleIncluded = false
  closeArchivePopover()
  const previous = archive
  await commitArchive(
    withArchived(archive, ids, Date.now()),
    previous,
    `已收起 ${ids.length} 个会话`,
    `已收起 ${ids.length} 个会话，可在「已收起」里恢复。`,
  )
}

const idsOf = (list) => list.map((item) => item.sessionID)

/** One archive menu: the popover carries the executable counts and the actions. */
function paintArchiveControl() {
  if (controls.archive) controls.archive.update({ label: "⋯" })
  const button = el("archiveHost") ? el("archiveHost").querySelector("button") : null
  if (button) {
    button.title = "收起与会话设置"
    button.setAttribute("aria-label", "收起与会话设置")
  }
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
  document.removeEventListener("keydown", onArchiveKey, true)
}

/** Escape closes the popover; Tab stays inside it while it is open. */
function onArchiveKey(event) {
  if (!archiveOpen) return
  if (event.key === "Escape") {
    event.preventDefault()
    closeArchivePopover()
    const button = el("archiveHost") ? el("archiveHost").querySelector("button") : null
    if (button) button.focus()
    return
  }
  if (event.key !== "Tab") return
  const pop = el("archiveHost") ? el("archiveHost").querySelector(".arch-pop") : null
  if (!pop) return
  const items = [...pop.querySelectorAll("button:not(:disabled), input:not(:disabled)")]
    .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function toggleArchivePopover() {
  if (archiveOpen) {
    closeArchivePopover()
    return
  }
  archiveOpen = true
  renderArchivePopover()
  document.addEventListener("pointerdown", onOutsidePointer, true)
  document.addEventListener("keydown", onArchiveKey, true)
  const pop = el("archiveHost") ? el("archiveHost").querySelector(".arch-pop") : null
  if (!pop) return
  const focusable = pop.querySelector("button:not(:disabled), input:not(:disabled)")
  ;(focusable || pop).focus()
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
    pop.setAttribute("aria-label", "收起")
    pop.tabIndex = -1
    hostEl.append(pop)
  }
  const fin = candidates.finished.length
  const stale = candidates.stale.length
  const man = candidates.manual.length
  const all = man + (staleIncluded ? stale : 0)
  pop.innerHTML =
    `<div class="ap-head"><b>可收起 ${man} 个已完成会话</b>` +
    `<span>超期 ${fin} · 久未更新 ${stale}</span></div>` +
    `<div class="ap-row"><span class="ap-l">全部已完成 · 手动</span>` +
    `<b class="ap-n">${man}</b><span class="ap-tag manual">可执行</span></div>` +
    `<div class="ap-row"><span class="ap-l">已完成 · 超期 ${prefs.days} 天</span>` +
    `<b class="ap-n">${fin}</b><span class="ap-tag">自动</span></div>` +
    `<label class="ap-row ap-check${stale ? "" : " muted"}"><input type="checkbox" id="apStale"${staleIncluded ? " checked" : ""}${stale ? "" : " disabled"}>` +
    `<span class="ap-l">久未更新 · 仅提示</span><b class="ap-n">${stale}</b><span class="ap-tag manual">可选</span></label>` +
    `<div class="ap-hint">按钮只显示可以立即收起的数。久未更新仍是开放工作，只做提示；勾选后才随本次一并收起，仍可撤销。</div>` +
    `<div class="ap-hr"></div>` +
    `<label class="ap-row ap-check"><input type="checkbox" id="apAuto"${prefs.auto ? " checked" : ""}>` +
    `<span class="ap-l">自动收起已完成</span></label>` +
    `<div class="ap-row ap-days"><span>超过</span>` +
    `<input id="apDays" type="number" min="0" max="365" step="1" value="${prefs.days}" aria-label="超期天数">` +
    `<span>天</span></div>` +
    `<div class="ap-hr"></div>` +
    `<div class="ap-actions">` +
    `<button type="button" id="apManual" class="ap-btn pri"${man ? "" : " disabled"}>收起全部已完成 ${man}</button>` +
    `<button type="button" id="apFinished" class="ap-btn"${fin ? "" : " disabled"}>收起超期已完成 ${fin}</button>` +
    (staleIncluded && all ? `<button type="button" id="apAll" class="ap-btn">全部收起 ${all}</button>` : "") +
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
  const manualButton = pop.querySelector("#apManual")
  if (manualButton) manualButton.addEventListener("click", () => { void archiveChosen(idsOf(candidates.manual)) })
  const finishedButton = pop.querySelector("#apFinished")
  if (finishedButton) finishedButton.addEventListener("click", () => { void archiveChosen(idsOf(candidates.finished)) })
  const allButton = pop.querySelector("#apAll")
  if (allButton) allButton.addEventListener("click", () => {
    void archiveChosen([...idsOf(candidates.manual), ...idsOf(candidates.stale)])
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
  const previous = archive
  clearUndo()
  archive = target
  try {
    await withArchiveLock(async () => {
      const stored = parseArchive(await host.storage.get(ARCHIVE_KEY))
      const next = mergeArchiveDelta(stored, previous, target)
      await host.storage.set(ARCHIVE_KEY, next)
      archive = next
    })
    holdIDs(removedIDs(previous, target))
    archiveReady = true
    archiveReadAt = Date.now()
  } catch (error) {
    archive = previous
    archiveReady = false
    host.toast({ kind: "error", message: `撤销未能保存：${(error && error.code) || error}` })
  }
  lastKey = ""
  await refresh()
}

// ---- controls ----------------------------------------------------------------

function updateSessionOptions() {
  if (!controls.session) return
  const options = [{ id: "all", label: "全部会话" }, ...agenda.map((meta) => ({ id: meta.sessionID, label: truncate(titleOf(meta, docOf(meta)), 28) }))]
  controls.session.update({ options })
}

/** The scope tabs, with a count from the index summary alone. */
function updateScopeControl() {
  if (!controls.scope) return
  let open = 0
  let done = 0
  for (const meta of agenda) {
    if (hasOpenWork(meta)) open += 1
    else if (inScope(meta, "done")) done += 1
  }
  controls.scope.update({
    items: [
      { id: "open", label: "待办", count: open },
      { id: "all", label: "全部", count: agenda.length },
      { id: "done", label: "已完成", count: done },
    ],
    activeId: filter.scope,
  })
}

function mountToolbar() {
  controls.search = mountSearchField(el("searchHost"), {
    value: "", placeholder: "搜索任务…", label: "搜索任务",
    onChange: (value) => { filter.query = value; controls.search.update({ value }); paintSummary(); paint() },
  })
  controls.scope = mountTabs(el("scopeHost"), {
    items: [
      { id: "open", label: "待办" },
      { id: "all", label: "全部" },
      { id: "done", label: "已完成" },
    ],
    activeId: filter.scope,
    onChange: (id) => {
      filter.scope = id
      loadedCount = BATCH
      lastKey = ""
      updateScopeControl()
      void renderBoard()
    },
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
  controls.status = mountSelect(el("statusHost"), {
    label: "状态", value: "all",
    options: [
      { id: "all", label: "全部状态" }, { id: "in_progress", label: "进行中" },
      { id: "pending", label: "待办" }, { id: "blocked", label: "受阻" },
      { id: "completed", label: "已完成" }, { id: "cancelled", label: "已取消" },
    ],
    onChange: (value) => {
      filter.status = value
      loadedCount = BATCH
      lastKey = ""
      controls.status.update({ value })
      paintSummary()
      void renderBoard()
    },
  })
  controls.archive = mountButton(el("archiveHost"), {
    label: "⋯",
    variant: "secondary",
    size: "sm",
    onClick: () => { toggleArchivePopover() },
  })

  el("sessions").addEventListener("scroll", onSessionsScroll, { passive: true })
  el("summary").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest("[data-filter]")) { setFilterOpen(!filterOpen); return }
    if (target.closest("[data-filter-close]")) { setFilterOpen(false); return }
    const stat = target.closest("[data-stat]")
    if (stat) { applyStatFilter(stat.dataset.stat); return }
    if (target.closest("[data-clear]")) { clearFilters(); return }
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
    const retry = target.closest("[data-retry-session]")
    if (retry) {
      docFailures.delete(retry.dataset.retrySession)
      lastKey = ""
      void renderBoard()
      return
    }
    const expand = target.closest("[data-expand-session]")
    if (expand) { expandedSessions.add(expand.dataset.expandSession); paint(); return }
    const archiveButton = target.closest("[data-archive]")
    if (archiveButton) { void archiveSession(archiveButton.dataset.archive); return }
    const restoreButton = target.closest("[data-restore]")
    if (restoreButton) { void restoreSession(restoreButton.dataset.restore); return }
    const row = target.closest(".row")
    if (!row || row.dataset.index === undefined) return
    selectRow(row)
  })
  el("sessions").addEventListener("keydown", (event) => {
    const row = event.target instanceof Element ? event.target.closest(".row[data-index]") : null
    if (!row) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      selectRow(row, true)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      moveRowFocus(row, event.key === "ArrowDown" ? 1 : -1)
    }
  })
  el("details").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest("#detailClose")) {
      selected = null
      paint()
      const row = el("sessions").querySelector(".row[data-index]")
      if (row) row.focus()
      return
    }
    const link = target.closest("[data-goto]")
    if (!link || !selected) return
    selected = { sessionID: selected.sessionID, index: Number(link.dataset.goto) }
    paint()
    const next = el("sessions").querySelector(".row.sel[data-index]")
    if (next) next.focus()
  })
}

// ---- lifecycle ---------------------------------------------------------------

/**
 * The index metas, re-read only when the file's stat moved.
 *
 * The stamp is the cheap half of the pair: the host still answers with one
 * round trip, but a quiet poll never ships or parses the workspace index.
 * `host.stat` is absent on older hosts, which simply falls back to reading.
 *
 * Returns `{ metas, moved }`: `moved` says the index was re-read, so the caller
 * can refresh the archive at the same time instead of on every poll.
 */
async function readIndexMetas() {
  const path = `${TODOS_DIR}/_index.json`
  let stamp = ""
  if (typeof host.stat === "function") {
    const info = await host.stat(path)
    stamp = `${info.kind}:${info.size}:${info.mtime}`
    if (indexMetas !== null && stamp === indexStamp) return { metas: indexMetas, moved: false }
  }
  const { content } = await host.readFile(path)
  const metas = parseIndex(content)
  if (metas === null) throw new Error("BAD_INDEX")
  indexStamp = stamp
  indexMetas = metas
  return { metas, moved: true }
}

async function refresh() {
  if (!host) return
  // Read once per page: the learned taxonomy changes only when this page writes it.
  if (!taxonomyLoaded) await loadTaxonomy()
  let metas
  let indexMoved = true
  try {
    const read = await readIndexMetas()
    metas = read.metas
    indexMoved = read.moved
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
  //
  // A quiet poll does not need to read it again: the in-memory document is current
  // within `ARCHIVE_READ_TTL_MS`, and an index move or an archive edit forces a
  // fresh read. This keeps idle polling to the index stat instead of two storage
  // round trips every five seconds.
  const nowForReads = Date.now()
  const archiveStale = !archiveReady || indexMoved || nowForReads - archiveReadAt > ARCHIVE_READ_TTL_MS
  let rawArchive
  if (archiveStale) {
    try {
      rawArchive = await host.storage.get(ARCHIVE_KEY)
      readOk = true
      archiveReady = true
      archiveReadAt = Date.now()
    } catch {
      rawArchive = undefined
      readOk = false
      archiveReady = false
    }
  } else {
    rawArchive = archive
    readOk = true
  }
  let nextArchive = parseArchive(rawArchive)

  // Preferences: a host that refuses or lacks them keeps the in-memory default.
  // The TTL is longer than the archive's: a preference changes only when a reader
  // opens this popover, so a 30-second lag is invisible next to the saved round trips.
  if (prefsReadAt === 0 || nowForReads - prefsReadAt > PREFS_READ_TTL_MS) {
    try {
      const stored = parsePrefs(await host.storage.get(PREFS_KEY))
      if (stored.auto !== prefs.auto || stored.days !== prefs.days) prefs = stored
      prefsReadAt = Date.now()
    } catch {
      /* keep the current preference; retry next poll */
    }
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
    candidates.manual.length,
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
  updateScopeControl()
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
    void loadSessionInfo()
    start()
  })
  host.onSession((session) => {
    sessionBusy = Boolean(session && session.busy === true)
    setCurrent(session)
    reschedule()
  })
}

boot()
