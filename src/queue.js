/**
 * The board's work queue: which sessions need attention, in what order, and
 * which rows survive a filter.
 *
 * Pure: no DOM, no SDK, no host. `src/board.js` owns the elements and the
 * mirrors; this module owns the queue shape, and `scripts/test-queue.mjs`
 * exercises it under Node.
 *
 * The board used to list every session by recency, which turned it into an
 * archive: the fifteen newest sessions were often all finished, and the first
 * session with open work sat below them. A queue is the other question — "what
 * is unfinished?" — so the default scope asks the index summary that question
 * and orders the answer by urgency: blocked, then in progress, then the rest,
 * each newest first. An index without a summary is never hidden on a guess.
 */
import { isFullyFinished } from "./archive.js"

/**
 * Whether a session has open work.
 *
 * Read from the index summary when the session has one. An older index without
 * a summary returns `true`: the board loads that mirror and corrects itself,
 * rather than hiding a session before it has read it.
 */
export function hasOpenWork(meta) {
  if (!meta) return false
  if (Number.isFinite(meta.total)) return (meta.doing || 0) + (meta.pending || 0) > 0
  return true
}

/** Whether a session belongs in `scope` — open work / everything / fully finished. */
export function inScope(meta, scope) {
  if (!meta) return false
  if (scope === "open") return hasOpenWork(meta)
  if (scope === "done") return isFullyFinished(meta)
  return true
}

/** Urgency bands inside the open scope: blocked, in progress, the rest. */
export function openRank(meta) {
  if (!meta) return 2
  if ((meta.blocked || 0) > 0) return 0
  if ((meta.doing || 0) > 0) return 1
  return 2
}

/** Blocked first, then in progress, then pending-only; newest first inside a band. */
export function compareOpen(a, b) {
  const rank = openRank(a) - openRank(b)
  if (rank !== 0) return rank
  return (b.updatedAt || 0) - (a.updatedAt || 0)
}

/**
 * The sessions in `scope`, in the order the board draws them. `all` and `done`
 * keep the index's newest-first order; `open` re-sorts by urgency.
 */
export function scopeMetas(metas, scope) {
  const list = (Array.isArray(metas) ? metas : []).filter((meta) => inScope(meta, scope))
  if (scope !== "open") return list
  return [...list].sort(compareOpen)
}

/**
 * The indices a filtered tree keeps: every match, plus each ancestor that leads
 * to one. Parent cycles are tolerated — a chain stops when it revisits a node.
 *
 * Returns `{ keep, count }`: `keep` names indices in the original list, and
 * `count` is the number of actual matches (ancestors are context, not matches).
 */
export function matchIndices(todos, predicate) {
  const list = Array.isArray(todos) ? todos : []
  const byId = new Map()
  for (let i = 0; i < list.length; i += 1) {
    const id = list[i] && list[i].id
    if (typeof id === "string" && id !== "" && !byId.has(id)) byId.set(id, i)
  }
  const keep = new Set()
  for (let i = 0; i < list.length; i += 1) {
    if (predicate(list[i])) keep.add(i)
  }
  const count = keep.size
  for (const start of [...keep]) {
    const seen = new Set([start])
    let parentId = list[start] && list[start].parentId
    while (typeof parentId === "string" && parentId !== "" && byId.has(parentId)) {
      const parent = byId.get(parentId)
      if (seen.has(parent)) break
      seen.add(parent)
      if (!keep.has(parent)) keep.add(parent)
      parentId = list[parent] && list[parent].parentId
    }
  }
  return { keep, count }
}

/** The filtered list and its match count. Ancestors stay, but do not count. */
export function filterList(todos, predicate) {
  const list = Array.isArray(todos) ? todos : []
  const { keep, count } = matchIndices(list, predicate)
  return { todos: list.filter((_, index) => keep.has(index)), count }
}

/**
 * Whether an open task is waiting on a task that exists and is not completed.
 * `statusById` is built from the whole session, so a filtered tree keeps the
 * warning even when the dependency row itself was filtered away.
 */
export function isBlocked(todo, statusById) {
  if (!todo || (todo.status !== "pending" && todo.status !== "in_progress")) return false
  if (!Array.isArray(todo.dependsOn) || !(statusById instanceof Map)) return false
  return todo.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== "completed")
}

const MINUTE = 60000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A short, stable age for a card header. A future stamp reads as "just now". */
export function relativeTime(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return ""
  const delta = Math.max(0, (Number.isFinite(now) ? now : Date.now()) - at)
  if (delta < MINUTE) return "刚刚"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)} 天前`
  if (delta < 365 * DAY) return `${Math.floor(delta / (30 * DAY))} 个月前`
  return `${Math.floor(delta / (365 * DAY))} 年前`
}
