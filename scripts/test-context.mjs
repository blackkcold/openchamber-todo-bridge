// Regression: dynamic task state must never invalidate the system/history prefix.
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
const history = [{ role: "user", content: [{ type: "text", text: "Finish the task" }] }]
const make = () => ({ sessionID: "ses_fixture", system: [{ type: "text", text: "Stable policy" }], messages: structuredClone(history) })
const first = make()
await hook(first)
assert.deepEqual(first.system, [{ type: "text", text: "Stable policy" }], "todo must not mutate the system prefix")
assert.deepEqual(first.messages.slice(0, history.length), history, "original conversation is unchanged")
assert.match(first.messages.at(-1).content[0].text, /Verify the release/)
assert.equal(first.messages.at(-1).role, "user")
const second = make()
await hook(second)
assert.deepEqual(second, first, "unchanged state produces identical outgoing context")
todos = [{ content: "Publish after approval", status: "pending" }]
const changed = make()
await hook(changed)
assert.deepEqual(changed.system, first.system)
assert.deepEqual(changed.messages.slice(0, history.length), history)
assert.match(changed.messages.at(-1).content[0].text, /Publish after approval/)
assert.equal(buildReminder(todos, 1), buildReminder(todos, 999), "round counters cannot change request text")
todos = [{ content: "Done", status: "completed" }]
const finished = make()
await hook(finished)
assert.deepEqual(finished.messages, history, "finished lists add no reminder")
const empty = make()
todos = []
await hook(empty)
assert.deepEqual(empty.messages, history)
await dispose()
console.log("PASS: stable system/history prefix, repeat stability, changed/finished/empty task state")
