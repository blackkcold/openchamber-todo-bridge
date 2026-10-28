/**
 * Session archiving for the task board.
 *
 * The board is otherwise read-only: it renders the per-session todo mirrors the
 * OpenCode plugin writes and never writes them back — writing would fight a live
 * agent's whole-list rewrite. Archiving a session is not a change to the todos at
 * all; it is the reader setting a dead session aside so it leaves "recent". That
 * is the board's own state, not the todo data's, so it lives in the extension's
 * `host.storage` under one key — never in a mirror, and never in `_index.json`.
 *
 * Pure: no DOM, no SDK, no host. `src/board.js` owns the storage calls; this
 * module owns the shape, and `scripts/test-archive.mjs` exercises it under Node.
 *
 * Resurfacing is a comparison, not a write. A session is archived only while its
 * archive stamp is at or after the session's last update. The moment the session
 * runs `todowrite` again the plugin bumps `_index.json`'s `updatedAt` past the
 * stamp, and the session returns to the list on its own — no unwatch, nothing
 * mutated. That is also why a stale entry is harmless: it can only ever hide a
 * session that has not moved since it was set aside.
 */

/** The single `host.storage` key the board keeps its archive under. */
export const ARCHIVE_KEY = "archive"
/** The stored document's shape version, for a future migration. */
export const ARCHIVE_VERSION = 1
/** A second key for the reader's archive preferences (`{ auto, days }`). Kept apart
 *  from the archive document so a preference never has to be taught to
 *  `parseArchive`. */
export const PREFS_KEY = "archive:prefs"
/** The preferences document's shape version. v2 added the age threshold. */
export const PREFS_VERSION = 2
/** How long a finished session stays in "recent" before the sweep sets it aside. */
export const DEFAULT_DAYS = 7
/** The farthest an age threshold may reach. A year is already "all of it". */
export const MAX_DAYS = 365
const DAY_MS = 86400000

/** An empty archive: what a missing, unreadable, or unknown value becomes. */
export function emptyArchive() {
  return { version: ARCHIVE_VERSION, sessions: {} }
}

/**
 * Normalise a stored archive value.
 *
 * Defensive: the value is durable JSON and may have been written by an older
 * version, or be anything at all. Unknown fields are dropped, a bad entry is
 * skipped, and a whole non-object becomes the empty archive rather than throwing.
 */
export function parseArchive(raw) {
  const out = emptyArchive()
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out
  const src = raw.sessions
  if (src === null || typeof src !== "object" || Array.isArray(src)) return out
  for (const [sessionID, at] of Object.entries(src)) {
    if (typeof sessionID !== "string" || sessionID === "") continue
    if (!Number.isFinite(at)) continue
    out.sessions[sessionID] = at
  }
  return out
}

/** The default preferences: automatic archiving is on, after a week. */
export function emptyPrefs() {
  return { version: PREFS_VERSION, auto: true, days: DEFAULT_DAYS }
}

/** A whole number of days, clamped to a range a threshold can actually mean. */
export function clampDays(value, fallback = DEFAULT_DAYS) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_DAYS, Math.max(0, Math.floor(n)))
}

/**
 * Normalise a stored preferences value. Defensive like `parseArchive`: anything
 * that is not a boolean `auto` (a missing value, a string, an array) leaves the
 * default in place, so an unknown value never turns the sweep on or off by surprise.
 *
 * A v1 document has no `days`. It migrates to 0 — "no age gate" — because that is
 * exactly what v1 did: a finished session was set aside on the next poll. Reading it
 * as the new default of 7 would change behaviour behind the reader's back.
 */
export function parsePrefs(raw) {
  const out = emptyPrefs()
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out
  if (typeof raw.auto === "boolean") out.auto = raw.auto
  if (Number.isFinite(raw.days)) out.days = clampDays(raw.days)
  else if (raw.version === 1) out.days = 0
  return out
}

/**
 * Whether a session is currently archived: it was set aside at or after its own
 * last update. A session that has run `todowrite` since (its index `updatedAt`
 * moved past the stamp) is not archived, so it resurfaces without any write.
 */
export function isArchived(entry, meta) {
  if (!entry || !meta || typeof meta.sessionID !== "string") return false
  const at = entry.sessions ? entry.sessions[meta.sessionID] : undefined
  if (!Number.isFinite(at)) return false
  const updated = Number.isFinite(meta.updatedAt) ? meta.updatedAt : 0
  return at >= updated
}

/**
 * Split the index metas into the ones to show and the ones set aside, keeping the
 * incoming (newest-first) order. `keepActiveID` is never archived — the session
 * the reader is in stays visible even if it was set aside in an earlier run.
 */
export function partition(metas, entry, keepActiveID) {
  const active = []
  const archived = []
  for (const meta of Array.isArray(metas) ? metas : []) {
    if (meta.sessionID === keepActiveID || !isArchived(entry, meta)) active.push(meta)
    else archived.push(meta)
  }
  return { active, archived }
}

/**
 * Whether a session has no open work: it has tasks and every one is completed or
 * cancelled. Read from the index summary alone — no mirror is opened. An entry
 * without a summary (an older v1 index) returns false, so it is never bulk
 * archived on a guess.
 */
export function isFullyFinished(meta) {
  if (!meta || !Number.isFinite(meta.total) || meta.total <= 0) return false
  return (meta.doing || 0) === 0 && (meta.pending || 0) === 0
}

/**
 * The three lists the board shows: the reader's explicit bulk run, and the two
 * lists the automatic sweep reasons about.
 *
 * - `manual` — every session with no open work that the reader may file **now**:
 *   no age gate and no `blocked` gate. This is the restored "archive all
 *   finished" action; the reader is asking for it explicitly. The same guards as
 *   the sweep still apply (`keep`, `hold`, already-archived, a future stamp).
 * - `finished` — no open work and older than `days`: the only list the silent
 *   sweep may write. `days: 0` means "no age gate", which is what v1 did.
 * - `stale` — still has open work but has not moved for `days`: **counted and
 *   listed, never archived automatically.** Hiding open work would lose it.
 *
 * `manual` is built before the age/blocked filters, so a finished session that
 * is blocked (or is inside the threshold) is still offered to the reader. The
 * sweep never consumes it: `autoArchiveIDs()` keeps reading `finished`.
 *
 * Guards shared with the sweep: the sessions in `keep` (the open one and the one
 * being filtered), `hold` (restored or undone, until they move again), a clock
 * that went backwards, and anything with a blocked task — a blocked session wants
 * attention, not filing. The `blocked` guard applies to the sweep lists only.
 *
 * Pure, index-only: `meta.updatedAt` and `meta.blocked` already carry everything
 * this needs, so a poll never opens a mirror to decide.
 */
export function archiveCandidates(metas, entry, opts = {}) {
  const finished = []
  const stale = []
  const manual = []
  const keep = new Set(Array.isArray(opts.keep) ? opts.keep : [])
  const hold = opts.hold && typeof opts.hold === "object" ? opts.hold : {}
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const days = clampDays(opts.days, 0)
  for (const meta of Array.isArray(metas) ? metas : []) {
    if (!meta || typeof meta.sessionID !== "string" || meta.sessionID === "") continue
    if (keep.has(meta.sessionID)) continue
    if (isArchived(entry, meta)) continue
    const updated = Number.isFinite(meta.updatedAt) ? meta.updatedAt : 0
    if (updated > now) continue
    const restored = Number.isFinite(hold[meta.sessionID]) ? hold[meta.sessionID] : -Infinity
    if (updated <= restored) continue
    const age = (now - updated) / DAY_MS
    const item = { sessionID: meta.sessionID, ageDays: Math.floor(age) }
    const done = isFullyFinished(meta)
    // The reader's explicit action: finished now, regardless of age or blocked.
    if (done) manual.push(item)
    if (age < days) continue
    if ((meta.blocked || 0) > 0) continue
    if (done) finished.push(item)
    else stale.push(item)
  }
  return { finished, stale, manual }
}

/**
 * The sessions an automatic sweep should set aside. Thin wrapper over
 * `archiveCandidates` so the count the reader sees and the ids the sweep writes
 * can never disagree.
 *
 * - `opts.keep` — ids to leave alone: the open session and the one being filtered.
 * - `opts.hold` — id -> the time it was restored or undone; a session stays out of
 *   the sweep until it runs `todowrite` again (its `updatedAt` passes that time).
 * - `opts.now` — the sweep time. A session updated after it (a clock that went
 *   backwards) is skipped: a stamp could never hide it, so trying would only write.
 * - `opts.days` — the age threshold. Absent means 0, which is v1's "any finished".
 * - `opts.readOk` — false when the stored archive could not be read. Skip entirely,
 *   so an unreadable archive is never replaced with a blind set.
 */
export function autoArchiveIDs(metas, entry, opts = {}) {
  if (!opts.readOk) return []
  return archiveCandidates(metas, entry, opts).finished.map((item) => item.sessionID)
}

/** A copy of `entry` with `ids` stamped as archived at `now`. Pure. */
export function withArchived(entry, ids, now) {
  const sessions = { ...(entry && entry.sessions ? entry.sessions : {}) }
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id === "string" && id !== "") sessions[id] = now
  }
  return { version: ARCHIVE_VERSION, sessions }
}

/** A copy of `entry` with `ids` removed from the archive. Pure. */
export function withoutArchived(entry, ids) {
  const sessions = { ...(entry && entry.sessions ? entry.sessions : {}) }
  for (const id of Array.isArray(ids) ? ids : []) delete sessions[id]
  return { version: ARCHIVE_VERSION, sessions }
}
