/**
 * openchamber-todo-bridge — OpenCode plugin.
 *
 * OpenCode v2 removed the `todowrite` / `todoread` tools (intentionally: the
 * maintainers found them to slow the agent down). Nothing replaced them for
 * tools that want to *read* the list, so an external UI has no supported way to
 * show progress.
 *
 * This plugin does two things, and owns both halves:
 *
 *   1. Registers `todowrite` / `todoread` again, with V1-compatible fields, and
 *      keeps the list in OpenCode's plugin storage. The current list is injected
 *      as transient tail context on each model request while tasks are open, so the
 *      model keeps track of it across long conversations and compaction.
 *
 *   2. Mirrors the list to a plain per-session JSON file, which the companion
 *      OpenChamber extension reads into the Work Status panel. This is the only
 *      shared channel available: OpenCode v2 has no todo HTTP endpoint, no todo
 *      event, and no plugin API for the native todo table, so a file is the one
 *      medium both sides can reach.
 *
 * It deliberately does not depend on any other plugin.
 *
 * Data file:
 *   <TODO_BRIDGE_DIR>/<sessionID>.json     (default ~/.config/openchamber/todos)
 *   { version: 2, sessionID, phases?, todos: [{ content, status, priority?, id?,
 *     parentId?, phase?, dependsOn? }], updatedAt }
 *   A v1 file (no `version`, flat items) is still read; the extra fields are
 *   optional and only drive the visual task tree.
 *
 *   <TODO_BRIDGE_DIR>/_index.json          the sessions the board reads, newest
 *   first, each with a summary (title, counts, phases) so the board can render
 *   its summary bar and headers without opening every mirror.
 */

import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"]
const TODO_PRIORITIES = ["high", "medium", "low"]
const STORAGE_PREFIX = "todos/"
/** The session index the board reads (the board may not `listDir` the folder). */
const INDEX_NAME = "_index.json"
const MARK = { pending: "[ ]", in_progress: "[•]", completed: "[x]", cancelled: "[-]" }

/**
 * Write-time input limits. They live in `normalize()` only: the JSON schema
 * stays byte-identical so the tools prefix (and its cache) is untouched. A list
 * stored by an older version may exceed these; `parseRecord()` still reads it,
 * so existing sessions keep displaying and mirroring.
 */
const MAX_TODOS = 200
const MAX_CONTENT = 500
const MAX_ID = 64
const MAX_PHASE = 64
const MAX_DEPENDS = 20
const MAX_PHASES = 20

/** Where the mirror writes. Override for testing with TODO_BRIDGE_DIR. */
function mirrorDir() {
  const override = process.env.TODO_BRIDGE_DIR
  if (typeof override === "string" && override.trim() !== "") return override.trim()
  return join(homedir(), ".config", "openchamber", "todos")
}

const storageKey = (sessionID) => `${STORAGE_PREFIX}${sessionID}`

/** A non-empty trimmed string, or a readable error for the model to correct. */
function requireString(value, what) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${what} must be a non-empty string`)
  }
  return value.trim()
}

/**
 * Validates a `todowrite` payload. Throws with a readable message so the model
 * can correct itself instead of silently losing the list.
 *
 * The structure fields (`id`, `parentId`, `phase`, `dependsOn`, top-level
 * `phases`) are optional and drive the visual task tree; a present one is still
 * validated, so a typo is caught rather than drawn as a broken tree.
 */
export function normalize(input) {
  if (input === null || typeof input !== "object" || !("todos" in input)) {
    throw new Error("todowrite requires a `todos` array")
  }
  const raw = input.todos
  if (!Array.isArray(raw)) throw new Error("`todos` must be an array")
  if (raw.length > MAX_TODOS) {
    throw new Error(`todowrite accepts at most ${MAX_TODOS} todos (got ${raw.length})`)
  }

  const todos = raw.map((entry, index) => {
    const at = `todo #${index + 1}`
    if (entry === null || typeof entry !== "object") {
      throw new Error(`${at} must be an object`)
    }
    const content = typeof entry.content === "string" ? entry.content.trim() : ""
    if (!content) throw new Error(`${at} requires a non-empty \`content\` string`)
    if (content.length > MAX_CONTENT) {
      throw new Error(`${at} \`content\` must be at most ${MAX_CONTENT} characters (got ${content.length})`)
    }
    if (!TODO_STATUSES.includes(entry.status)) {
      throw new Error(`${at} has invalid \`status\` (expected: ${TODO_STATUSES.join(", ")})`)
    }
    const todo = { content, status: entry.status }
    if (entry.priority !== undefined) {
      if (!TODO_PRIORITIES.includes(entry.priority)) {
        throw new Error(`${at} has invalid \`priority\` (expected: ${TODO_PRIORITIES.join(", ")})`)
      }
      todo.priority = entry.priority
    }
    if (entry.id !== undefined) {
      todo.id = requireString(entry.id, `${at} \`id\``)
      if (todo.id.length > MAX_ID) {
        throw new Error(`${at} \`id\` must be at most ${MAX_ID} characters (got ${todo.id.length})`)
      }
    }
    if (entry.parentId !== undefined && entry.parentId !== null) {
      todo.parentId = requireString(entry.parentId, `${at} \`parentId\``)
      if (todo.parentId.length > MAX_ID) {
        throw new Error(`${at} \`parentId\` must be at most ${MAX_ID} characters (got ${todo.parentId.length})`)
      }
    }
    if (entry.phase !== undefined) {
      todo.phase = requireString(entry.phase, `${at} \`phase\``)
      if (todo.phase.length > MAX_PHASE) {
        throw new Error(`${at} \`phase\` must be at most ${MAX_PHASE} characters (got ${todo.phase.length})`)
      }
    }
    if (entry.dependsOn !== undefined) {
      if (!Array.isArray(entry.dependsOn) || entry.dependsOn.some((dep) => typeof dep !== "string" || dep.trim() === "")) {
        throw new Error(`${at} \`dependsOn\` must be an array of non-empty strings`)
      }
      if (entry.dependsOn.length > MAX_DEPENDS) {
        throw new Error(`${at} \`dependsOn\` accepts at most ${MAX_DEPENDS} ids (got ${entry.dependsOn.length})`)
      }
      todo.dependsOn = entry.dependsOn.map((dep) => dep.trim())
    }
    return todo
  })

  const result = { todos }
  if (input.phases !== undefined) {
    if (!Array.isArray(input.phases) || input.phases.some((p) => typeof p !== "string" || p.trim() === "")) {
      throw new Error("`phases` must be an array of non-empty strings")
    }
    if (input.phases.length > MAX_PHASES) {
      throw new Error(`\`phases\` accepts at most ${MAX_PHASES} phases (got ${input.phases.length})`)
    }
    result.phases = input.phases.map((p, index) => {
      const phase = p.trim()
      if (phase.length > MAX_PHASE) {
        throw new Error(`\`phases\` entry ${index + 1} must be at most ${MAX_PHASE} characters (got ${phase.length})`)
      }
      return phase
    })
  }
  return result
}

/**
 * Reads a stored record defensively: the value is durable JSON and may have been
 * written by an older version of this plugin.
 */
function parseRecord(value) {
  if (value === null || typeof value !== "object") return []
  if (!Array.isArray(value.todos)) return []
  const todos = []
  for (const entry of value.todos) {
    if (entry === null || typeof entry !== "object") continue
    if (typeof entry.content !== "string") continue
    if (!TODO_STATUSES.includes(entry.status)) continue
    const todo = { content: entry.content, status: entry.status }
    if (TODO_PRIORITIES.includes(entry.priority)) todo.priority = entry.priority
    if (typeof entry.id === "string" && entry.id !== "") todo.id = entry.id
    if (typeof entry.parentId === "string" && entry.parentId !== "") todo.parentId = entry.parentId
    if (typeof entry.phase === "string" && entry.phase !== "") todo.phase = entry.phase
    if (Array.isArray(entry.dependsOn)) {
      todo.dependsOn = entry.dependsOn.filter((dep) => typeof dep === "string" && dep !== "")
    }
    todos.push(todo)
  }
  return todos
}

function parsePhases(value) {
  return value && Array.isArray(value.phases)
    ? value.phases.filter((phase) => typeof phase === "string" && phase !== "")
    : []
}

/** Session cache: a request must not read the durable record every round. */
const SESSION_CACHE_TTL_MS = 30_000
const SESSION_CACHE_MAX = 200
const sessionCache = new Map()

/**
 * sessionID -> the list last written (or last read fresh).
 *
 * `todowrite` replaces the whole list, and agents routinely re-send the same
 * one — once to correct wording the list already has, once because the model
 * restated its plan. Writing that again costs two durable writes and a full
 * `_index.json` scan, and it moves the session to the top of the board for a
 * change nobody made. The digest is the guard: equal means the mirror, the
 * storage record and the index already say exactly this.
 */
const sessionSignatures = new Map()
/** Bound the signature cache like the session cache; a long-lived process sees many sessions. */
const SESSION_SIGNATURE_MAX = 1024
function rememberSignature(sessionID, signature) {
  sessionSignatures.delete(sessionID)
  sessionSignatures.set(sessionID, signature)
  while (sessionSignatures.size > SESSION_SIGNATURE_MAX) {
    const oldest = sessionSignatures.keys().next().value
    sessionSignatures.delete(oldest)
  }
}

const signatureOf = (todos, phases) => JSON.stringify([todos, phases])

function cacheRecord(sessionID, record, readAt = Date.now()) {
  sessionCache.delete(sessionID)
  sessionCache.set(sessionID, { record, readAt })
  while (sessionCache.size > SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value
    sessionCache.delete(oldest)
  }
}

/**
 * Reads the durable record. `phases` is optional metadata; a v1 record without
 * it degrades to an empty order rather than failing.
 *
 * A cached record is served for 30 seconds. The TTL is deliberately not sliding:
 * a session that keeps reading must still notice another process's write. The
 * `fresh` path is used by `todowrite`, where the previous phases and updatedAt
 * are authoritative input to the write, not display state.
 */
async function readRecord(ctx, sessionID, { fresh = false } = {}) {
  const now = Date.now()
  if (!fresh) {
    const cached = sessionCache.get(sessionID)
    if (cached && now - cached.readAt < SESSION_CACHE_TTL_MS) {
      // Keep the map's LRU order without extending the TTL.
      sessionCache.delete(sessionID)
      sessionCache.set(sessionID, cached)
      return cached.record
    }
  }
  try {
    const value = await ctx.storage.get(storageKey(sessionID))
    const record = {
      todos: parseRecord(value),
      phases: parsePhases(value),
      updatedAt: value && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    }
    // A fresh read is how a write from another process (or an older plugin
    // generation) becomes visible. Do NOT seed `sessionSignatures` here: that
    // map means "this mirror was written by this generation". Seeding it from a
    // read would make the next identical `todowrite` skip a mirror that may be
    // missing, which is exactly the recovery path (`todowrite` re-checks the
    // mirror before trusting the signature).
    cacheRecord(sessionID, record, now)
    return record
  } catch (error) {
    sessionCache.delete(sessionID)
    throw error
  }
}

/**
 * Renders the list for the model. When the list has stable ids, they are shown
 * so the model can keep them across compaction; parent links and dependencies
 * are shown only when present. A flat list without ids keeps the old shape.
 */
function render(todos, phases = []) {
  if (todos.length === 0) return "(the todo list is empty)"
  const showIds = todos.some((todo) => typeof todo.id === "string" && todo.id !== "")
  const declared = Array.isArray(phases)
    ? phases.filter((phase) => typeof phase === "string" && phase !== "")
    : []
  const lines = todos.map((todo, index) => {
    const phase = todo.phase ? ` [${todo.phase}]` : ""
    const priority = todo.priority ? ` — ${todo.priority} priority` : ""
    const id = showIds && todo.id ? ` #${todo.id}` : ""
    const parent = todo.parentId ? ` <- ${todo.parentId}` : ""
    const deps = Array.isArray(todo.dependsOn) && todo.dependsOn.length
      ? ` deps:${todo.dependsOn.join(",")}`
      : ""
    return `${index + 1}. ${MARK[todo.status]} ${todo.content}${phase}${priority}${id}${parent}${deps}`
  })
  if (declared.length) lines.push(`Phases: ${declared.join(", ")}`)
  return lines.join("\n")
}

const hasOpen = (todos) => todos.some((t) => t.status === "pending" || t.status === "in_progress")

/**
 * A tiny coalescing queue. Calls made while one run is pending share a single
 * follow-up run, so a burst of todowrites touches `_index.json` once.
 */
export function createCoalescingQueue(task) {
  let tail = Promise.resolve()
  let dirty = false
  return () => {
    dirty = true
    const run = tail.catch(() => {}).then(async () => {
      if (!dirty) return
      dirty = false
      await task()
    })
    tail = run.catch(() => {})
    return run
  }
}

/** sessionID -> the tail of that session's write chain. */
const sessionWrites = new Map()

async function pendingWrite(sessionID) {
  const pending = sessionWrites.get(sessionID)
  if (!pending) return
  try {
    await pending
  } catch {
    /* the original tool call reports its own failure */
  }
}

/** Serializes writes for one session; different sessions still run in parallel. */
function runSerial(sessionID, task) {
  const previous = sessionWrites.get(sessionID) || Promise.resolve()
  const run = previous.catch(() => {}).then(task)
  sessionWrites.set(sessionID, run)
  return run.finally(() => {
    if (sessionWrites.get(sessionID) === run) sessionWrites.delete(sessionID)
  })
}

/** Writes atomically so the extension never reads a half-written file. */
async function mirror(sessionID, todos, phases, updatedAt = Date.now()) {
  const dir = mirrorDir()
  await mkdir(dir, { recursive: true })
  const body = { version: 2, sessionID, todos, updatedAt }
  if (Array.isArray(phases) && phases.length) body.phases = phases
  const payload = JSON.stringify(body, null, 2)
  const target = join(dir, `${sessionID}.json`)
  const tmp = join(dir, `.${sessionID}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, payload, "utf8")
    await rename(tmp, target)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }

  // Prime the summary cache with the exact record just written. The index scan
  // can then use this entry even when the filesystem's mtime is coarse or the
  // content changed without moving mtime.
  try {
    const info = await stat(target)
    // If a foreign rename landed between our rename and this stat, the size is
    // a cheap signal that the entry no longer describes our payload.
    if (info.size === Buffer.byteLength(payload)) {
      summaryCache.set(target, {
        mtimeMs: info.mtimeMs,
        size: info.size,
        entry: summaryEntry(sessionID, todos, phases, updatedAt),
      })
    }
  } catch {
    /* the index scan will read the file if this stat fails */
  }

  // Keep the board's session index current. Best-effort: the mirror is already
  // durable, so a failed index write must not fail the todo write.
  indexDir = dir
  try {
    await scheduleIndexWrite()
  } catch (error) {
    logIndexError(error)
  }
}

/**
 * Whether the mirror file exists and is non-empty. `sessionSignatures` only
 * records a successful mirror write in this process; it cannot know that the
 * file was deleted, the profile moved, or a previous write failed before a
 * restart. A cheap stat before trusting the signature is what makes the guard
 * self-healing without writing on every identical call.
 */
async function mirrorPresent(sessionID) {
  try {
    const info = await stat(join(mirrorDir(), `${sessionID}.json`))
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/**
 * The per-session summary the board reads from the index.
 *
 * The board used to `readFile` every session mirror just to draw its summary
 * bar, its session labels and each card header. That is O(sessions) reads a
 * poll, which stalls once a machine accumulates a few hundred sessions. The
 * counts below are everything the board needs for those, so it can render them
 * from `_index.json` alone and read a mirror only to draw the task tree itself.
 *
 * Pure, so the harness can check the arithmetic without a filesystem.
 */
export function summarize(todos, phases = []) {
  const list = Array.isArray(todos) ? todos : []
  const statusById = new Map()
  for (const todo of list) if (todo && typeof todo.id === "string" && todo.id !== "") statusById.set(todo.id, todo.status)
  let done = 0, doing = 0, pending = 0, cancelled = 0, blocked = 0
  const byPhase = {}
  for (const todo of list) {
    if (todo === null || typeof todo !== "object") continue
    const open = todo.status === "pending" || todo.status === "in_progress"
    if (todo.status === "completed") done += 1
    else if (todo.status === "in_progress") doing += 1
    else if (todo.status === "pending") pending += 1
    else if (todo.status === "cancelled") cancelled += 1
    // Only open work can be blocked: a completed task with a cancelled dependency
    // must not keep a finished session out of every archive list.
    if (open && Array.isArray(todo.dependsOn) && todo.dependsOn.some((dep) => statusById.has(dep) && statusById.get(dep) !== "completed")) blocked += 1
    const key = typeof todo.phase === "string" && todo.phase !== "" ? todo.phase : ""
    byPhase[key] = (byPhase[key] || 0) + 1
  }
  const declared = Array.isArray(phases) ? phases.filter((phase) => typeof phase === "string" && phase !== "") : []
  return { total: list.length, done, doing, pending, cancelled, blocked, byPhase, phases: declared }
}

/** The session label the board shows, derived from the list since a mirror has no title. */
export function titleFor(todos) {
  const list = Array.isArray(todos) ? todos : []
  const active = list.find((todo) => todo && todo.status === "in_progress")
  const root = list.find((todo) => todo && !todo.parentId)
  return (active || root || {}).content || ""
}

/**
 * Writes `_index.json`, the list of sessions the board reads.
 *
 * The board's `filesystem` grant covers the files (`todos/*.json`), not the
 * directory, so the board cannot `listDir`. The plugin runs with full access, so
 * it writes the index instead — which keeps the grant file-level.
 *
 * Each entry carries a summary (title, counts, phases) so the board can render
 * its summary bar, its session labels and every card header without opening a
 * single mirror. The summary is recomputed only when a file's mtime moves, so a
 * write stays cheap on a machine with many sessions.
 */
const summaryCache = new Map()
const MAX_SUMMARY_CACHE = 1024
/** Force a full re-read occasionally so a preserved mtime cannot hide a change forever. */
const FULL_REFRESH_MS = 60_000
let lastFullRefresh = 0
let lastIndexErrorAt = 0
let lastMirrorErrorAt = 0
let indexDir = ""

function summaryEntry(sessionID, todos, phases, updatedAt) {
  return { sessionID, updatedAt, title: titleFor(todos), ...summarize(todos, phases) }
}

const scheduleIndexWrite = createCoalescingQueue(async () => {
  if (indexDir) await writeIndex(indexDir)
})

function logIndexError(error) {
  const now = Date.now()
  if (now - lastIndexErrorAt < 60_000) return
  lastIndexErrorAt = now
  console.error("[openchamber-todo-bridge] index write failed:", error)
}

function logMirrorError(error) {
  const now = Date.now()
  if (now - lastMirrorErrorAt < 60_000) return
  lastMirrorErrorAt = now
  console.error("[openchamber-todo-bridge] mirror write failed:", error)
}

async function summarizeFile(dir, name, mtimeMs, size, force = false) {
  const path = join(dir, name)
  const cached = summaryCache.get(path)
  if (!force && cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    // Refresh the map position on a hit; the cap is LRU, not FIFO.
    summaryCache.delete(path)
    summaryCache.set(path, cached)
    return cached.entry
  }
  let entry = null
  try {
    const data = JSON.parse(await readFile(path, "utf8"))
    const todos = parseRecord(data)
    const phases = parsePhases(data)
    const sessionID = name.slice(0, -".json".length)
    const updatedAt = data && Number.isFinite(data.updatedAt) ? data.updatedAt : Math.round(mtimeMs)
    entry = summaryEntry(sessionID, todos, phases, updatedAt)
  } catch {
    /* an unreadable or partial file is skipped this round */
  }
  if (entry) {
    summaryCache.set(path, { mtimeMs, size, entry })
    if (summaryCache.size > MAX_SUMMARY_CACHE) {
      const oldest = summaryCache.keys().next().value
      summaryCache.delete(oldest)
    }
  } else {
    // Do not cache a negative result: the next write should retry the read.
    summaryCache.delete(path)
  }
  return entry
}

async function writeIndex(dir) {
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const force = Date.now() - lastFullRefresh > FULL_REFRESH_MS
  if (force) lastFullRefresh = Date.now()
  const sessions = []
  const seen = new Set()
  for (const name of names) {
    if (!name.endsWith(".json") || name === INDEX_NAME) continue
    try {
      const info = await stat(join(dir, name))
      const entry = await summarizeFile(dir, name, info.mtimeMs, info.size, force)
      if (entry) {
        sessions.push(entry)
        seen.add(name)
      }
    } catch {
      /* a file that vanished mid-scan is skipped */
    }
  }
  for (const path of summaryCache.keys()) {
    if (!seen.has(basename(path))) summaryCache.delete(path)
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  const payload = JSON.stringify({ version: 2, sessions, updatedAt: Date.now() }, null, 2)
  const tmp = join(dir, `.${INDEX_NAME}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(tmp, payload, "utf8")
    await rename(tmp, join(dir, INDEX_NAME))
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}

/**
 * The tool description carries the whole behavioral contract.
 *
 * OpenCode's system prompt never mentions todos — in v1 every bit of guidance
 * lived here, in a ~1.6KB description, and that is what made agents reach for
 * the tool on their own. An earlier revision of this plugin condensed it to a
 * few lines and agents stopped using the tool proactively, which is expected:
 * with the contract gone there is nothing telling them when to.
 *
 * This is derived from OpenCode v1's `tool/todowrite.txt` (MIT), kept close to
 * the original wording because it is the phrasing that demonstrably worked.
 */
export const TODOWRITE_DESCRIPTION = [
  "Create and maintain a structured task list for the current coding session. Tracks progress, organizes multi-step work, and surfaces status to the user.",
  "",
  "## When to use",
  "Use proactively when:",
  "- The task requires 3+ distinct steps or actions (not just 3 tool calls for a single conceptual step)",
  "- The work is non-trivial and benefits from planning",
  "- The user provides multiple tasks (numbered or comma-separated) or explicitly asks for a todo list",
  "- New instructions arrive - capture them as todos",
  "- You start a task - mark it `in_progress` (only one at a time) before working",
  "- You finish a task - mark it `completed` and add any follow-ups discovered during the work",
  "",
  "## When NOT to use",
  "Skip when:",
  "- The work is a single, straightforward task (or <3 trivial steps)",
  "- The request is purely informational or conversational",
  "- Tracking adds no organizational value",
  "",
  "## States",
  "- `pending` - not started",
  "- `in_progress` - actively working (exactly ONE at a time)",
  "- `completed` - finished successfully",
  "- `cancelled` - no longer needed",
  "",
  "## Rules",
  "- Update status in real time; don't batch completions",
  "- Mark `completed` only after the required work is actually done, including any required verification. Never based on intent.",
  "- Keep exactly one `in_progress` while work remains",
  "- If blocked or partial, keep it `in_progress` and add a follow-up todo describing the blocker",
  "- Preserve user-provided commands verbatim (flags, args, order)",
  "- Items should be specific and actionable; break large work into smaller steps",
  "- Each call replaces the whole list, so always pass every item",
  "",
  "## Structure (optional, for the visual task tree)",
  "- Give each item a short stable `id`, and keep it the same across updates.",
  "- Use `parentId` to nest a step under the task it belongs to (a subtask); leave it out for a top-level task.",
  "- Use `phase` to name the stage a task belongs to (e.g. \"调研\", \"实现\", \"验证\"). Phases are drawn as colour bands.",
  "- `dependsOn: [ids]` records a cross-task dependency (shown on the full task board).",
  "- A flat list still works, but a tree is what makes progress legible at a glance.",
  "",
  "When in doubt, use it.",
].join("\n")

/**
 * Stable wording: elapsed rounds are runtime bookkeeping, not model context.
 */
/**
 * The tool result is history. Keep it compact: the call arguments already hold
 * the full list, and `todoread` is the recovery channel. A finished list used to
 * write the whole render into history — for a long list that is thousands of
 * characters the model already saw in the call, so it is counts only now.
 */
function resultContent(todos) {
  if (!hasOpen(todos)) {
    if (todos.length === 0) return "Todo list updated (empty)."
    const done = todos.filter((todo) => todo.status === "completed").length
    const cancelled = todos.filter((todo) => todo.status === "cancelled").length
    return `Todo list updated (${todos.length} items: ${done} done, ${cancelled} cancelled). Full list: todoread.`
  }
  const open = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress").length
  const doing = todos.filter((todo) => todo.status === "in_progress").length
  const done = todos.filter((todo) => todo.status === "completed").length
  const cancelled = todos.filter((todo) => todo.status === "cancelled").length
  const progress = doing ? ` (${doing} in progress)` : ""
  return `Updated: ${open} open${progress}, ${done} done, ${cancelled} cancelled. Full list: todoread.`
}

/**
 * The reminder is transient tail context, so every round pays for it. It used to
 * repeat the whole list (every finished item too) while `todoread` already offers
 * the full render. This compact form keeps the open work, a counts line and the
 * done/cancelled items that open work structurally needs (parents and
 * dependencies), so the task tree survives compaction without paying for 47
 * finished rows every round.
 *
 * The hard bounds are deliberate: the open section never exceeds
 * REMINDER_BODY_MAX and the assembled reminder never exceeds REMINDER_TOTAL_MAX.
 * When room runs out, open items are hidden and counted; the header and the
 * footer nudge are never trimmed.
 */
const REMINDER_OPEN_MAX = 40
const REMINDER_BODY_MAX = 2000
const REMINDER_ITEM_MAX = 200
const REMINDER_STRUCTURAL_MAX = 12
const REMINDER_TOTAL_MAX = 2400
const REMINDER_TITLE_MAX = 120
/** Pathological phase lists must not push the reminder past its total bound. */
const REMINDER_PHASES_MAX = 400

const REMINDER_HEADER = [
  "[Session task state — reference only; continue the user's current task.]",
  "Current todo list for this session:",
]
const REMINDER_FOOTER = [
  "Keep this list current with todowrite:",
  "- mark a task `completed` as soon as it is done and verified",
  "- move the next task to `in_progress` before starting it (one at a time)",
  "- capture follow-ups discovered during the work",
  "- keep the tree meaningful: stable `id`s, `parentId`, `phase`, `dependsOn`",
]
const REMINDER_REF_HEADER = "Referenced done/cancelled:"
const REMINDER_IDS_PREFIX = "Referenced ids only: "

const hiddenLine = (count) => `… +${count} open not shown; call todoread.`

/**
 * The done/cancelled items that open work still needs: completed ancestors and
 * completed dependencies (plus their ancestors). Emitted in the original `todos`
 * order so the text is deterministic; Sets are used for membership only, never
 * for ordering. Returned in full — the renderer caps the detailed lines and
 * prints the rest as ids, so a reference is never silently dropped.
 */
export function structuralReferences(todos, open) {
  const list = Array.isArray(todos) ? todos : []
  const byId = new Map()
  for (const todo of list) {
    if (todo && typeof todo.id === "string" && todo.id !== "") byId.set(todo.id, todo)
  }
  const needed = new Set()
  // Cycle-safe: a malformed parent chain must not loop forever.
  const addAncestors = (todo) => {
    const visited = new Set()
    let parentId = todo && typeof todo.parentId === "string" ? todo.parentId : ""
    while (parentId !== "" && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      if (parent.status === "completed" || parent.status === "cancelled") needed.add(parent)
      parentId = typeof parent.parentId === "string" ? parent.parentId : ""
    }
  }
  for (const todo of Array.isArray(open) ? open : []) {
    if (!todo || typeof todo !== "object") continue
    addAncestors(todo)
    for (const depId of Array.isArray(todo.dependsOn) ? todo.dependsOn : []) {
      const dep = byId.get(depId)
      if (!dep) continue
      if (dep.status === "completed" || dep.status === "cancelled") {
        needed.add(dep)
        addAncestors(dep)
      }
    }
  }
  const references = []
  for (const todo of list) if (needed.has(todo)) references.push(todo)
  return references
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** One reminder line: the `render` shape, with a bounded `content`. */
function reminderLine(todo, index, showIds) {
  const content = truncate(todo.content, REMINDER_ITEM_MAX)
  const phase = todo.phase ? ` [${todo.phase}]` : ""
  const priority = todo.priority ? ` — ${todo.priority} priority` : ""
  const id = showIds && todo.id ? ` #${todo.id}` : ""
  const parent = todo.parentId ? ` <- ${todo.parentId}` : ""
  const deps = Array.isArray(todo.dependsOn) && todo.dependsOn.length
    ? ` deps:${todo.dependsOn.join(",")}`
    : ""
  return `${index + 1}. ${MARK[todo.status]} ${content}${phase}${priority}${id}${parent}${deps}`
}

/**
 * Open display order: in-progress first (at most five, original order among
 * them), then every remaining open item in original order. Each line keeps its
 * original list position, like `render` does.
 */
function orderedOpen(open) {
  const doing = open.filter((todo) => todo.status === "in_progress").slice(0, 5)
  const leading = new Set(doing)
  const remaining = open.filter((todo) => !leading.has(todo))
  return [...doing, ...remaining]
}

/** `#id` when the item has one, otherwise its original 1-based row. */
function referenceLabel(todo, indexByTodo) {
  return todo.id ? `#${todo.id}` : `row ${indexByTodo.get(todo) + 1}`
}

function referenceText(todo, indexByTodo) {
  const title = truncate(todo.content, REMINDER_TITLE_MAX)
  return `  + ${referenceLabel(todo, indexByTodo)} ${MARK[todo.status]} ${title}`
}

function assembleReminder(openText, extrasText) {
  const header = REMINDER_HEADER.join("\n")
  const footer = REMINDER_FOOTER.join("\n")
  const middle = extrasText ? `${openText}\n${extrasText}` : openText
  return `${header}\n${middle}\n\n${footer}`
}

/**
 * Fits the structural references into the room left after the fixed parts and a
 * minimal open section.
 *
 * The block is built greedily, because a review found the old fallback either
 * dropped readable detail that would have fit or cut an id in half (`#t1, #t`
 * reads like a real id and can become a broken `parentId`). So: the header plus
 * as many detail lines as fit (never more than REMINDER_STRUCTURAL_MAX), then
 * the remaining references as whole ids on one line. If the ids line does not
 * fit, only whole labels are kept and it ends with ` …`; a label is never cut.
 * If no detail line fits, ids are emitted alone when they fit, otherwise nothing.
 */
function referencesBlock(references, indexByTodo, budget) {
  if (!Array.isArray(references) || references.length === 0 || budget <= 0) return ""
  const lines = [REMINDER_REF_HEADER]
  let used = REMINDER_REF_HEADER.length
  if (used > budget) return ""
  const detailed = references.slice(0, REMINDER_STRUCTURAL_MAX)
  for (const todo of detailed) {
    const line = `\n${referenceText(todo, indexByTodo)}`
    if (used + line.length > budget) break
    lines.push(line.slice(1))
    used += line.length
  }
  const shown = lines.length - 1
  const ids = idsLine(references.slice(shown), indexByTodo, shown > 0 ? budget - used - 1 : budget)
  if (shown === 0) return ids
  return ids ? `${lines.join("\n")}\n${ids}` : lines.join("\n")
}

/**
 * One line of whole ids for the references that did not get a detail line. It
 * stops before a label that would overflow and says so with ` …`; an id is
 * never truncated, because a prefix of an id is a different, broken id.
 */
function idsLine(remaining, indexByTodo, room) {
  if (remaining.length === 0 || room <= REMINDER_IDS_PREFIX.length) return ""
  let line = REMINDER_IDS_PREFIX
  let included = 0
  for (let index = 0; index < remaining.length; index += 1) {
    const label = referenceLabel(remaining[index], indexByTodo)
    const more = index < remaining.length - 1
    const addition = `${included > 0 ? ", " : ""}${label}`
    if (line.length + addition.length + (more ? 2 : 0) > room) break
    line += addition
    included += 1
  }
  if (included === 0) return ""
  return included < remaining.length ? `${line} …` : line
}

/**
 * The model-visible compact reminder. `todoread` and finished tool results keep
 * the full `render`; only the transient per-round reminder is compacted.
 */
export function renderReminder(todos, phases = []) {
  const list = Array.isArray(todos) ? todos : []
  const declared = Array.isArray(phases)
    ? phases.filter((phase) => typeof phase === "string" && phase !== "")
    : []
  if (list.length === 0) return assembleReminder("(the todo list is empty)", "")

  const open = list.filter((todo) => todo.status === "pending" || todo.status === "in_progress")
  const done = list.filter((todo) => todo.status === "completed").length
  const cancelled = list.filter((todo) => todo.status === "cancelled").length
  const showIds = list.some((todo) => typeof todo.id === "string" && todo.id !== "")
  const indexByTodo = new Map(list.map((todo, index) => [todo, index]))

  const counts = done > 0 || cancelled > 0
    ? `Done: ${done}, cancelled: ${cancelled} (todoread for the full list)`
    : ""
  const phasesLine = declared.length
    ? truncate(`Phases: ${declared.join(", ")}`, REMINDER_PHASES_MAX)
    : ""

  // Room left for references after the fixed parts and the smallest possible
  // open section (the truncation line, or the empty-list line).
  const openMinText = open.length > 0
    ? hiddenLine(open.length)
    : "(no open tasks — call todoread for the full list)"
  const fixedExtras = [counts, phasesLine].filter(Boolean).join("\n")
  const refsBudget = REMINDER_TOTAL_MAX - assembleReminder(openMinText, fixedExtras).length
  const references = structuralReferences(list, open)
  const refs = referencesBlock(references, indexByTodo, refsBudget)

  if (open.length === 0) {
    const extras = [counts, refs, phasesLine].filter(Boolean).join("\n")
    return assembleReminder("(no open tasks — call todoread for the full list)", extras)
  }

  const extrasText = [counts, refs, phasesLine].filter(Boolean).join("\n")
  const openBudget = REMINDER_TOTAL_MAX - assembleReminder("", extrasText).length
  const cap = Math.min(REMINDER_BODY_MAX, openBudget)

  const ordered = orderedOpen(open)
  const lines = []
  let length = 0
  for (let index = 0; index < ordered.length && lines.length < REMINDER_OPEN_MAX; index += 1) {
    const line = reminderLine(ordered[index], indexByTodo.get(ordered[index]), showIds)
    const hiddenAfter = ordered.length - (lines.length + 1)
    const reserved = hiddenAfter > 0 ? 1 + hiddenLine(hiddenAfter).length : 0
    const grown = length + (lines.length > 0 ? 1 : 0) + line.length + reserved
    if (grown > cap) break
    lines.push(line)
    length += (lines.length > 1 ? 1 : 0) + line.length
  }

  const renderOpen = () => {
    const hidden = ordered.length - lines.length
    return hidden > 0 ? `${lines.join("\n")}\n${hiddenLine(hidden)}` : lines.join("\n")
  }
  let text = assembleReminder(renderOpen(), extrasText)
  // Belt and braces: the section caps should keep this from firing, but the
  // total bound is a contract, so trim open lines until it holds.
  while (text.length > REMINDER_TOTAL_MAX && lines.length > 0) {
    lines.pop()
    text = assembleReminder(renderOpen(), extrasText)
  }
  return text
}

export function buildReminder(todos, phases = []) {
  return renderReminder(todos, phases)
}

const REMINDER_MARKER = "[Session task state"

/** A tool part that has started but not finished; a missing `state` is old history. */
function hasPendingToolCall(message) {
  const content = message && Array.isArray(message.content) ? message.content : []
  return content.some((part) =>
    part && part.type === "tool" && part.state &&
    (part.state.status === "pending" || part.state.status === "running"))
}

/**
 * Injects the transient reminder without ever producing two consecutive user
 * turns. The block is tail-only and is never persisted.
 *
 * - Last message is `user`: rebuild that message with a new content array that
 *   keeps the original parts and appends the reminder as a text part.
 * - Last message is `tool`, another role, or an assistant with no pending tool
 *   call: append a new user message.
 * - Last message is an assistant with a pending/running tool call: return false.
 *   The next request carries the tool result; injecting a user turn now would put
 *   it in the middle of the call/result pair.
 *
 * Idempotent: a text part already starting with REMINDER_MARKER is replaced, so
 * calling twice never adds a second reminder. A malformed message returns false
 * rather than corrupting history. The original array and message objects are
 * never mutated; `event.messages` is replaced with a new array when it changes.
 */
export function appendReminder(event, text) {
  if (!event || typeof event !== "object" || !Array.isArray(event.messages)) return false
  const messages = event.messages
  const last = messages.length > 0 ? messages[messages.length - 1] : null
  const role = last && typeof last === "object" ? last.role : undefined

  if (role === "assistant" && hasPendingToolCall(last)) return false

  if (role === "user") {
    const content = last.content
    let parts
    if (typeof content === "string") {
      // A string that already starts with the marker is a previous reminder.
      parts = content.startsWith(REMINDER_MARKER) ? [] : [{ type: "text", text: content }]
    } else if (Array.isArray(content)) {
      parts = content.filter((part) =>
        !(part && typeof part === "object" && part.type === "text" &&
          typeof part.text === "string" && part.text.startsWith(REMINDER_MARKER)))
    } else {
      return false
    }
    event.messages = [
      ...messages.slice(0, -1),
      { ...last, content: [...parts, { type: "text", text }] },
    ]
    return true
  }

  event.messages = [...messages, { role: "user", content: [{ type: "text", text }] }]
  return true
}

export const TODOS_INPUT = {
  type: "object",
  properties: {
    phases: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional: the run's stages in order (e.g. [\"调研\", \"实现\", \"验证\"]). Sets the colour order of the task tree.",
    },
    todos: {
      type: "array",
      description: "The complete todo list. This replaces any previous list.",
      items: {
        type: "object",
        properties: {
          content: { type: "string", description: "Brief description of the task." },
          status: { type: "string", enum: TODO_STATUSES, description: "Current state of the task." },
          priority: { type: "string", enum: TODO_PRIORITIES, description: "Optional priority." },
          id: { type: "string", description: "Optional stable id for this task; used to nest subtasks." },
          parentId: { type: "string", description: "Optional id of the parent task, to nest this as a subtask." },
          phase: { type: "string", description: "Optional stage name; phases are drawn as colour bands." },
          dependsOn: { type: "array", items: { type: "string" }, description: "Optional ids this task depends on." },
        },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
}

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false }

export const TODOREAD_DESCRIPTION =
  "Read the current session todo list. Use it to recover the list after context compaction or to check progress before starting the next task."

/**
 * The single source for what the plugin registers. The digest in
 * `scripts/test-cache.mjs` covers name, description, input and options in this
 * order, so the runtime and the frozen surface cannot drift apart.
 */
export const TOOL_SURFACE = [
  { name: "todowrite", description: TODOWRITE_DESCRIPTION, input: TODOS_INPUT, options: { codemode: false } },
  { name: "todoread", description: TODOREAD_DESCRIPTION, input: EMPTY_INPUT, options: { codemode: false } },
]

export default {
  id: "openchamber-todo-bridge",

  async setup(ctx) {
    // A reload is a new process generation: never reuse a prior generation's
    // cached records across setup calls (this also isolates tests).
    sessionCache.clear()
    sessionWrites.clear()
    sessionSignatures.clear()
    summaryCache.clear()
    indexDir = ""
    lastFullRefresh = 0
    lastIndexErrorAt = 0
    lastMirrorErrorAt = 0
    // Refresh/upgrade `_index.json` once at load, so the board gets its per-session
    // summaries even before the first todowrite of a session — and an index left
    // over from an older plugin (no summaries) is rewritten on the next start.
    try {
      await writeIndex(mirrorDir())
    } catch (error) {
      logIndexError(error)
    }

    /** One implementation per tool name in TOOL_SURFACE. */
    const execute = {
      async todowrite(input, context) {
        const normalized = normalize(input)
        // Two calls in one assistant turn must not interleave storage, mirror
        // and index writes for the same session.
        const hasPhases = Object.hasOwn(normalized, "phases")
        return runSerial(context.sessionID, async () => {
          const { todos } = normalized
          // `phases` is optional input. Omitting it must not erase the stored
          // order, so that path needs a fresh read. When the caller supplies
          // phases, no read is needed; a storage read fault must not fail a
          // write that already carries all the metadata it needs.
          let previous = hasPhases
            ? sessionCache.get(context.sessionID)?.record || null
            : await readRecord(ctx, context.sessionID, { fresh: true })
          const phases = (hasPhases ? normalized.phases : previous.phases) || []
          const signature = signatureOf(todos, phases)
          // Two ways to know the stored list already equals this one: this
          // generation mirrored it, or the fresh read just returned it. The
          // second is what makes a restart behave like the old in-memory guard
          // without seeding the signature from a read (which hid a missing
          // mirror). Both paths check the file before trusting the claim.
          const storedSignature = previous ? signatureOf(previous.todos, previous.phases) : ""
          if (sessionSignatures.get(context.sessionID) === signature || storedSignature === signature) {
            // The signature says this generation mirrored this exact list. Trust
            // it only while the mirror is still on disk: a wiped profile, a
            // deleted file, or a failed write before a restart must not leave
            // the board blind forever.
            if (await mirrorPresent(context.sessionID)) {
              return { content: resultContent(todos) }
            }
            // Repair only the mirror. A fresh read is the source of truth: the
            // storage record may have moved on since our last cached copy.
            let stored = previous
            try {
              stored = await readRecord(ctx, context.sessionID, { fresh: true })
            } catch {
              /* fall through to the normal write, which reports storage faults */
            }
            if (stored && signatureOf(stored.todos, stored.phases) === signature) {
              try {
                // Keep the original updatedAt: a repair is not activity. Bumping
                // it would reorder the board and could resurface an archived
                // session for a change nobody made.
                await mirror(context.sessionID, stored.todos, stored.phases, stored.updatedAt)
                rememberSignature(context.sessionID, signature)
              } catch (error) {
                logMirrorError(error)
              }
              return { content: resultContent(todos) }
            }
            // Storage moved past our signature; write the incoming list below.
            previous = stored || previous
          }
          const updatedAt = Math.max(Date.now(), (previous?.updatedAt || 0) + 1)
          const record = { todos, phases, updatedAt }
          await ctx.storage.set(storageKey(context.sessionID), record)
          cacheRecord(context.sessionID, record)
          // Mirror after the durable write: a mirror failure must not lose the list.
          let mirrored = true
          try {
            await mirror(context.sessionID, todos, phases, updatedAt)
          } catch (error) {
            mirrored = false
            logMirrorError(error)
          }
          // A failed mirror is retried by the next write, even an identical one.
          if (mirrored) rememberSignature(context.sessionID, signature)
          return { content: resultContent(todos) }
        })
      },

      async todoread(_input, context) {
        await pendingWrite(context.sessionID)
        // This is the explicit recovery path. Read it fresh: a cached list
        // from another process must never become the basis for a rewrite.
        const record = await readRecord(ctx, context.sessionID, { fresh: true })
        return { content: `Current todo list:\n${render(record.todos, record.phases)}` }
      },
    }

    const tools = await ctx.tool.transform((editor) => {
      for (const tool of TOOL_SURFACE) editor.add({ ...tool, execute: execute[tool.name] })
    })

    // The hook edits only the outgoing request. Keep dynamic task state after
    // the conversation, not in system: changing a system prefix can invalidate
    // caching for the entire history. Never persist a reminder as a user turn.
    const context = await ctx.session.hook("context", async (event) => {
      try {
        if (!event || typeof event.sessionID !== "string" || event.sessionID === "") return
        if (!Array.isArray(event.messages)) return
        // If a todowrite is in flight, read after it settles so the reminder and
        // the cache reflect the list the model just wrote.
        await pendingWrite(event.sessionID)
        const record = await readRecord(ctx, event.sessionID)
        if (!hasOpen(record.todos)) return
        // A transient reminder must never become a persisted user turn. If the
        // history ends in a user message, attach the block to that message instead
        // of adding a second consecutive user turn (some providers reject it).
        // appendReminder replaces the array and rebuilds that message; it never
        // mutates the caller's array or message objects. Verified against
        // OpenCode 2.0.16: the caller reads event.messages after the hook.
        appendReminder(event, buildReminder(record.todos, record.phases))
      } catch (error) {
        // A storage or host fault must not fail the model request. The list is
        // still durable; the next round can inject it again.
        console.error("[openchamber-todo-bridge] context reminder skipped:", error)
      }
    })

    return async () => {
      await context.dispose()
      await tools.dispose()
    }
  },
}
