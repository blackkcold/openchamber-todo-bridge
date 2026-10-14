/**
 * The mirror document: the shape the OpenCode plugin writes and every surface
 * (the Work Status section, the rail panel, the task board) reads.
 *
 * Shared so the three surfaces agree on what a valid todo is and on what counts
 * as finished. Pure: no DOM, no SDK.
 */

export const STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"])

export const isFinished = (todo) => todo.status === "completed" || todo.status === "cancelled"

/**
 * Normalise an already-parsed mirror object. Defensive: the file is written by
 * another process and may be partial or a v1 (flat) copy. Unknown fields are
 * dropped, a bad entry is skipped rather than failing the whole list.
 */
export function normalizeDoc(data) {
  const raw = data && Array.isArray(data.todos) ? data.todos : []
  const todos = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue
    const text = typeof entry.content === "string" ? entry.content.trim() : ""
    if (!text) continue
    if (!STATUSES.has(entry.status)) continue
    const todo = {
      content: text,
      status: entry.status,
      priority: typeof entry.priority === "string" ? entry.priority : "",
    }
    if (typeof entry.id === "string" && entry.id !== "") todo.id = entry.id
    if (typeof entry.parentId === "string" && entry.parentId !== "") todo.parentId = entry.parentId
    if (typeof entry.phase === "string" && entry.phase !== "") todo.phase = entry.phase
    if (Array.isArray(entry.dependsOn)) {
      todo.dependsOn = entry.dependsOn.filter((dep) => typeof dep === "string" && dep !== "")
    }
    todos.push(todo)
  }
  const phases = data && Array.isArray(data.phases)
    ? data.phases.filter((phase) => typeof phase === "string" && phase !== "")
    : []
  return { todos, phases }
}

/** Parse a mirror file's text. Returns null only when the JSON is malformed. */
export function parseDoc(content) {
  let data
  try {
    data = JSON.parse(content)
  } catch {
    return null
  }
  return normalizeDoc(data)
}

/**
 * Parse the session index the plugin writes (`_index.json`).
 *
 * Returns `null` only when the JSON is malformed; a missing or partial entry is
 * skipped rather than failing the whole index. The summary fields (`title`,
 * `total`, counts, `byPhase`, `phases`) are optional: a v1 index — or one
 * written before the plugin learned to summarise — yields entries with just
 * `sessionID` / `updatedAt`, and the caller falls back to reading the mirror.
 */
export function parseIndex(content) {
  let data
  try {
    data = JSON.parse(content)
  } catch {
    return null
  }
  const raw = data && Array.isArray(data.sessions) ? data.sessions : []
  const out = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue
    const sessionID = typeof entry.sessionID === "string" ? entry.sessionID.trim() : ""
    if (sessionID === "") continue
    const num = (value) => (Number.isFinite(value) ? value : 0)
    const item = { sessionID, updatedAt: num(entry.updatedAt) }
    if (typeof entry.title === "string" && entry.title !== "") item.title = entry.title
    if (Number.isFinite(entry.total)) {
      item.total = entry.total
      item.done = num(entry.done)
      item.doing = num(entry.doing)
      item.pending = num(entry.pending)
      item.cancelled = num(entry.cancelled)
      item.blocked = num(entry.blocked)
      item.byPhase = entry.byPhase && typeof entry.byPhase === "object" ? entry.byPhase : {}
      item.phases = Array.isArray(entry.phases)
        ? entry.phases.filter((phase) => typeof phase === "string" && phase !== "")
        : []
    }
    out.push(item)
  }
  return out
}
