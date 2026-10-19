// Integration checks for the todo record that the model can recover after
// compaction, and for the metadata `todowrite` must not silently drop.
//
// The reminder / todoread text is the model's only recovery channel after a
// compaction. It must carry the stable ids, parent links, dependencies and the
// declared phase order; otherwise the next whole-list rewrite flattens the tree
// and loses the board's DAG edges. `phases` is optional input, but omitting it
// must preserve the stored order; only an explicit `[]` clears it.

import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { buildReminder } from "../opencode-plugin/index.js"

let failed = 0
const check = (name, pass, detail = "") => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

const STRUCTURED = [
  { content: "Parent task", status: "completed", id: "t1", phase: "调研" },
  { content: "Child task", status: "in_progress", id: "t2", parentId: "t1", phase: "实现", dependsOn: ["t1"] },
  { content: "Sibling task", status: "pending", id: "t3", phase: "实现" },
]
const PHASES = ["调研", "实现"]

const FLAT_WITH_IDS = [
  { content: "First", status: "pending", id: "a1" },
  { content: "Second", status: "pending", id: "a2" },
]
const FLAT_NO_IDS = [
  { content: "First", status: "pending" },
  { content: "Second", status: "pending" },
]

async function harness(initial) {
  const dir = await mkdtemp(join(tmpdir(), "todo-state-"))
  process.env.TODO_BRIDGE_DIR = dir
  const tools = new Map()
  const storage = { gets: 0, sets: 0, record: structuredClone(initial) }
  let hook = null
  const dispose = await plugin.setup({
    storage: {
      get: async () => {
        storage.gets += 1
        return storage.record
      },
      set: async (_key, value) => {
        storage.sets += 1
        storage.record = value
      },
    },
    tool: {
      transform: async (fn) => {
        fn({ add: (tool) => tools.set(tool.name, tool) })
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: async (name, callback) => {
        assert.equal(name, "context")
        hook = callback
        return { dispose: async () => {} }
      },
    },
  })
  return { dir, tools, storage, hook, dispose }
}

console.log("\nstructure — ids, parents, dependencies, phases")
{
  const reminder = buildReminder(STRUCTURED, PHASES)
  check("reminder carries stable ids", reminder.includes("#t1") && reminder.includes("#t2"))
  check("reminder carries the parent link", reminder.includes("<- t1"))
  check("reminder carries dependencies", reminder.includes("deps:t1"))
  check("reminder carries the declared phase order", reminder.includes("Phases: 调研, 实现"))
  check("flat lists with ids still carry them", buildReminder(FLAT_WITH_IDS).includes("#a1"))
  check("flat lists without ids stay unchanged", !buildReminder(FLAT_NO_IDS).includes("#"))

  const h = await harness({ todos: STRUCTURED, phases: PHASES, updatedAt: 1 })
  try {
    const read = await h.tools.get("todoread").execute({}, { sessionID: "ses_state" })
    check("todoread carries stable ids", read.content.includes("#t1") && read.content.includes("#t2"))
    check("todoread carries the parent link", read.content.includes("<- t1"))
    check("todoread carries dependencies", read.content.includes("deps:t1"))
    check("todoread carries the declared phase order", read.content.includes("Phases: 调研, 实现"))
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\nphases — omit preserves, [] clears, explicit value replaces")
{
  const h = await harness({
    todos: [{ content: "Task", status: "pending", id: "t1" }],
    phases: ["调研", "实现"],
    updatedAt: 1,
  })
  try {
    const write = h.tools.get("todowrite")
    const readMirror = async () => JSON.parse(await readFile(join(h.dir, "ses_state.json"), "utf8"))
    const readIndex = async () => {
      const data = JSON.parse(await readFile(join(h.dir, "_index.json"), "utf8"))
      return data.sessions.find((session) => session.sessionID === "ses_state")
    }

    await write.execute({ todos: [{ content: "Task", status: "completed", id: "t1" }] }, { sessionID: "ses_state" })
    const omittedMirror = await readMirror()
    const omittedIndex = await readIndex()
    check("omit phases: storage keeps the previous order", Array.isArray(h.storage.record.phases) && h.storage.record.phases.join(",") === "调研,实现")
    check("omit phases: mirror keeps the previous order", Array.isArray(omittedMirror.phases) && omittedMirror.phases.join(",") === "调研,实现")
    check("omit phases: index keeps the previous order", Array.isArray(omittedIndex.phases) && omittedIndex.phases.join(",") === "调研,实现")

    await write.execute({ todos: [{ content: "Task", status: "completed", id: "t1" }], phases: [] }, { sessionID: "ses_state" })
    const clearedMirror = await readMirror()
    const clearedIndex = await readIndex()
    check("explicit [] clears storage", Array.isArray(h.storage.record.phases) && h.storage.record.phases.length === 0)
    check("explicit [] clears the mirror", !Array.isArray(clearedMirror.phases) || clearedMirror.phases.length === 0)
    check("explicit [] clears the index", !Array.isArray(clearedIndex.phases) || clearedIndex.phases.length === 0)

    await write.execute({ todos: [{ content: "Task", status: "pending", id: "t1" }], phases: ["验证"] }, { sessionID: "ses_state" })
    check("explicit phases replace storage", h.storage.record.phases.join(",") === "验证")
    check("explicit phases replace the mirror", (await readMirror()).phases.join(",") === "验证")
    check("explicit phases replace the index", (await readIndex()).phases.join(",") === "验证")
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\nstorage read fault — explicit phases writes, omitted phases fails loudly")
{
  const dir = await mkdtemp(join(tmpdir(), "todo-state-read-fault-"))
  process.env.TODO_BRIDGE_DIR = dir
  const tools = new Map()
  let setCount = 0
  const dispose = await plugin.setup({
    storage: {
      get: async () => { throw new Error("read down") },
      set: async () => { setCount += 1 },
    },
    tool: {
      transform: async (fn) => {
        fn({ add: (tool) => tools.set(tool.name, tool) })
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: async () => ({ dispose: async () => {} }),
    },
  })
  try {
    const explicit = await tools.get("todowrite").execute({
      todos: [{ content: "A", status: "pending" }],
      phases: [],
    }, { sessionID: "ses_read_fault" })
    check("explicit phases write does not require a read", setCount === 1)
    check("explicit phases write still returns a result", explicit.content.includes("Full list: todoread"))

    let rejected = false
    try {
      await tools.get("todowrite").execute({
        todos: [{ content: "B", status: "pending" }],
      }, { sessionID: "ses_read_fault_two" })
    } catch {
      rejected = true
    }
    check("omitted phases fails loudly when the previous order cannot be read", rejected)
    check("the failed write did not reach storage", setCount === 1)
  } finally {
    await dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

console.log("\nresult — compact for open lists, full for finished lists")
{
  const h = await harness({ todos: [], phases: [], updatedAt: 0 })
  try {
    const tool = h.tools.get("todowrite")
    const open = await tool.execute({
      todos: [
        { content: "Open task", status: "pending" },
        { content: "Done task", status: "completed" },
      ],
      phases: [],
    }, { sessionID: "ses_result" })
    check("open list result points to todoread", open.content.includes("Full list: todoread"))
    check("open list result does not duplicate completed content", !open.content.includes("Done task"))
    check("open list result carries counts", open.content.includes("1 open") && open.content.includes("1 done"), open.content)

    const finished = await tool.execute({
      todos: [
        { content: "Finished task", status: "completed" },
        { content: "Cancelled task", status: "cancelled" },
      ],
      phases: [],
    }, { sessionID: "ses_result" })
    check("finished list keeps the full render", finished.content.includes("Finished task") && finished.content.includes("Cancelled task"))
    check("finished list uses the completed marks", finished.content.includes("[x]") && finished.content.includes("[-]"))
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

if (failed > 0) {
  console.error(`\n${failed} state check(s) failed`)
  process.exit(1)
}
console.log("\nall state checks passed")
