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
