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
 * The sessions an "archive everything finished" run should set aside: every meta
 * that is not already archived, is not the session in view, and has no open work.
 */
export function finishedSessionIDs(metas, entry, keepActiveID) {
  const ids = []
  for (const meta of Array.isArray(metas) ? metas : []) {
    if (meta.sessionID === keepActiveID) continue
    if (isArchived(entry, meta)) continue
    if (isFullyFinished(meta)) ids.push(meta.sessionID)
  }
  return ids
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
