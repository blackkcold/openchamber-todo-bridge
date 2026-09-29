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
 *      as system context on every model request while tasks are open, so the
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
 *   { sessionID, todos: [{ content, status, priority? }], updatedAt }
 */

import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"]
const TODO_PRIORITIES = ["high", "medium", "low"]
const STORAGE_PREFIX = "todos/"
const MARK = { pending: "[ ]", in_progress: "[•]", completed: "[x]", cancelled: "[-]" }

/** Where the mirror writes. Override for testing with TODO_BRIDGE_DIR. */
function mirrorDir() {
  const override = process.env.TODO_BRIDGE_DIR
  if (typeof override === "string" && override.trim() !== "") return override.trim()
  return join(homedir(), ".config", "openchamber", "todos")
}

const storageKey = (sessionID) => `${STORAGE_PREFIX}${sessionID}`

/**
 * Validates a `todowrite` payload. Throws with a readable message so the model
 * can correct itself instead of silently losing the list.
 */
function normalize(input) {
  if (input === null || typeof input !== "object" || !("todos" in input)) {
    throw new Error("todowrite requires a `todos` array")
  }
  const raw = input.todos
  if (!Array.isArray(raw)) throw new Error("`todos` must be an array")

  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`todo #${index + 1} must be an object`)
    }
    const content = typeof entry.content === "string" ? entry.content.trim() : ""
    if (!content) throw new Error(`todo #${index + 1} requires a non-empty \`content\` string`)
    if (!TODO_STATUSES.includes(entry.status)) {
      throw new Error(`todo #${index + 1} has invalid \`status\` (expected: ${TODO_STATUSES.join(", ")})`)
    }
    const todo = { content, status: entry.status }
    if (entry.priority !== undefined) {
      if (!TODO_PRIORITIES.includes(entry.priority)) {
        throw new Error(`todo #${index + 1} has invalid \`priority\` (expected: ${TODO_PRIORITIES.join(", ")})`)
      }
      todo.priority = entry.priority
    }
    return todo
  })
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
    todos.push(todo)
  }
  return todos
}

function render(todos) {
  if (todos.length === 0) return "(the todo list is empty)"
  return todos
    .map((todo, index) => {
      const priority = todo.priority ? ` — ${todo.priority} priority` : ""
      return `${index + 1}. ${MARK[todo.status]} ${todo.content}${priority}`
    })
    .join("\n")
}

const hasOpen = (todos) => todos.some((t) => t.status === "pending" || t.status === "in_progress")

/** Writes atomically so the extension never reads a half-written file. */
async function mirror(sessionID, todos) {
  const dir = mirrorDir()
  await mkdir(dir, { recursive: true })
  const payload = JSON.stringify({ sessionID, todos, updatedAt: Date.now() }, null, 2)
  const target = join(dir, `${sessionID}.json`)
  const tmp = join(dir, `.${sessionID}.${process.pid}.tmp`)
  await writeFile(tmp, payload, "utf8")
  await rename(tmp, target)
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
  "When in doubt, use it.",
].join("\n")

/** How many unchanged injections before the reminder says so outright. */
const STALE_AFTER = 3

/**
 * Builds the per-round reminder.
 *
 * Pure so the harness can check the wording and the escalation without a model
 * or a filesystem. `repeats` counts consecutive injections of the same list:
 * once the agent has seen the same list several rounds running, saying so is
 * more useful than repeating the same suggestion.
 */
export function buildReminder(todos, repeats = 1) {
  const lines = [
    "Current todo list for this session:",
    render(todos),
    "",
  ]

  if (repeats >= STALE_AFTER) {
    lines.push(
      `This list has not changed in ${repeats} rounds. If any of it is finished, update it now with todowrite:`,
      "- mark finished and verified work `completed`",
      "- move the task you are working on to `in_progress` (one at a time)",
    )
  } else {
    lines.push(
      "Keep this list current with todowrite:",
      "- mark a task `completed` as soon as it is done and verified",
      "- move the next task to `in_progress` before starting it (one at a time)",
      "- capture follow-ups discovered during the work",
    )
  }

  return lines.join("\n")
}

const TODOS_INPUT = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      description: "The complete todo list. This replaces any previous list.",
      items: {
        type: "object",
        properties: {
          content: { type: "string", description: "Brief description of the task." },
          status: { type: "string", enum: TODO_STATUSES, description: "Current state of the task." },
          priority: { type: "string", enum: TODO_PRIORITIES, description: "Optional priority." },
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

export default {
  id: "openchamber-todo-bridge",

  async setup(ctx) {
    const tools = await ctx.tool.transform((editor) => {
      editor.add({
        name: "todowrite",
        description: TODOWRITE_DESCRIPTION,
        input: TODOS_INPUT,
        options: { codemode: false },
        async execute(input, context) {
          const todos = normalize(input)
          await ctx.storage.set(storageKey(context.sessionID), { todos, updatedAt: Date.now() })
          // Mirror after the durable write: a mirror failure must not lose the list.
          try {
            await mirror(context.sessionID, todos)
          } catch {
            /* the list is already stored; the panel is best-effort */
          }
          return {
            content: `Todo list updated (${todos.length} ${todos.length === 1 ? "item" : "items"}):\n${render(todos)}`,
          }
        },
      })

      editor.add({
        name: "todoread",
        description:
          "Read the current session todo list. Use it to recover the list after context compaction or to check progress before starting the next task.",
        input: EMPTY_INPUT,
        options: { codemode: false },
        async execute(_input, context) {
          const todos = parseRecord(await ctx.storage.get(storageKey(context.sessionID)))
          return { content: `Current todo list:\n${render(todos)}` }
        },
      })
    })

    // Re-inject the current list each round. Two reasons: compaction can drop
    // the older tool results, and without a reminder a long task tends to run to
    // the end with the list still showing everything as pending.
    //
    // The list is compared by content, so an unchanged list is detected without
    // asking the model anything. After a few unchanged rounds the reminder says
    // so outright rather than repeating the same suggestion.
    const seen = new Map()
    const context = await ctx.session.hook("context", async (event) => {
      const todos = parseRecord(await ctx.storage.get(storageKey(event.sessionID)))
      if (!hasOpen(todos)) {
        seen.delete(event.sessionID)
        return
      }

      const key = JSON.stringify(todos)
      const previous = seen.get(event.sessionID)
      const repeats = previous && previous.key === key ? previous.repeats + 1 : 1
      seen.set(event.sessionID, { key, repeats })

      event.system.push({ type: "text", text: buildReminder(todos, repeats) })
    })

    return async () => {
      await context.dispose()
      await tools.dispose()
    }
  },
}
