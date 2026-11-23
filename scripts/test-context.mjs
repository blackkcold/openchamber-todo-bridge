// Regression: dynamic task state must never invalidate the system/history prefix,
// and the transient reminder must never introduce two consecutive user turns.
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { buildReminder } from "../opencode-plugin/index.js"

process.env.TODO_BRIDGE_DIR = await mkdtemp(join(tmpdir(), "todo-context-"))
let todos = [{ content: "Verify the release", status: "in_progress" }]
let hook
const dispose = await plugin.setup({
  storage: { get: async () => ({ todos }) },
  tool: { transform: async () => ({ dispose: async () => {} }) },
  session: { hook: async (name, callback) => {
    assert.equal(name, "context")
    hook = callback
    return { dispose: async () => {} }
  } },
})
const history = [
  { role: "assistant", content: [{ type: "text", text: "Previous turn." }] },
  { role: "user", content: [{ type: "text", text: "Finish the task" }] },
]
const historySnapshot = structuredClone(history)
const lastUserIndex = history.length - 1
const make = (sessionID = "ses_fixture") => ({ sessionID, system: [{ type: "text", text: "Stable policy" }], messages: structuredClone(history) })
const first = make()
await hook(first)
assert.deepEqual(first.system, [{ type: "text", text: "Stable policy" }], "todo must not mutate the system prefix")
assert.deepEqual(first.messages.slice(0, lastUserIndex), history.slice(0, lastUserIndex), "everything before the last user is unchanged")
assert.equal(first.messages.length, history.length, "a user tail keeps the message count")
assert.equal(first.messages.at(-1).role, "user")
assert.equal(first.messages.at(-1).content[0].text, "Finish the task", "the original user text is preserved")
assert.equal(first.messages.at(-1).content.length, 2, "the reminder is a second text part")
assert.equal(first.messages.at(-1).content[1].text, buildReminder(todos, []), "the injected text is the reminder")
assert.deepEqual(history, historySnapshot, "the input history is not mutated")
const second = make()
await hook(second)
assert.deepEqual(second, first, "unchanged state produces identical outgoing context")

const repeated = make()
await hook(repeated)
const once = structuredClone(repeated.messages)
await hook(repeated)
assert.deepEqual(repeated.messages, once, "a repeated hook adds no second reminder")
assert.equal(
  repeated.messages.at(-1).content.filter((part) => typeof part?.text === "string" && part.text.startsWith("[Session task state")).length,
  1,
  "exactly one reminder part",
)

todos = [{ content: "Publish after approval", status: "pending" }]
const changed = make("ses_fixture_changed")
await hook(changed)
assert.deepEqual(changed.system, first.system)
assert.deepEqual(changed.messages.slice(0, lastUserIndex), history.slice(0, lastUserIndex))
assert.equal(changed.messages.length, history.length)
assert.equal(changed.messages.at(-1).content[0].text, "Finish the task")
assert.match(changed.messages.at(-1).content[1].text, /Publish after approval/)
assert.equal(buildReminder(todos, 1), buildReminder(todos, 999), "round counters cannot change request text")
todos = [{ content: "Done", status: "completed" }]
const finished = make("ses_fixture_finished")
await hook(finished)
assert.deepEqual(finished.messages, history, "finished lists add no reminder")
const empty = make("ses_fixture_empty")
todos = []
await hook(empty)
assert.deepEqual(empty.messages, history)
await dispose()
console.log("PASS: stable prefix before the last user, user-tail attach, repeat idempotence, changed/finished/empty task state")
