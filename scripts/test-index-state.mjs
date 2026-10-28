// Index/write-path checks for 0.9.4.
//
// Three failure modes are pinned here:
//   1. two `todowrite` calls for the SAME session must not interleave;
//   2. a burst of index writes must coalesce, while a later call must run again;
//   3. `_index.json` must refresh when a mirror's mtime is unchanged but its size
//      and contents changed (the old summary cache keyed on mtime alone).
//
// The concurrency test delays the first storage write so the unserialized code
// deterministically interleaves. The freshness test uses a fixed mtime and a
// different content length, which is the case an mtime-only cache cannot see.

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { createCoalescingQueue } from "../opencode-plugin/index.js"

let failed = 0
const check = (name, pass, detail = "") => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

async function harness(initial = { todos: [], phases: [], updatedAt: 0 }, setImpl = null) {
  const dir = await mkdtemp(join(tmpdir(), "todo-index-state-"))
  process.env.TODO_BRIDGE_DIR = dir
  const tools = new Map()
  const storage = { gets: 0, sets: 0, record: structuredClone(initial) }
  const dispose = await plugin.setup({
    storage: {
      get: async () => {
        storage.gets += 1
        return storage.record
      },
      set: async (_key, value) => {
        storage.sets += 1
        if (setImpl) await setImpl(_key, value)
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
        return { dispose: async () => {} }
      },
    },
  })
  return { dir, tools, storage, dispose }
}

console.log("\nindex queue — coalesces a burst, runs again after a later call")
{
  let runs = 0
  let release
  let startedResolve
  let started = new Promise((resolve) => { startedResolve = resolve })
  let gate = new Promise((resolve) => { release = resolve })
  const queue = createCoalescingQueue(async () => {
    runs += 1
    startedResolve()
    await gate
  })
  const first = queue()
  const second = queue()
  const third = queue()
  await started
  check("a burst runs once", runs === 1, `runs ${runs}`)
  release()
  await Promise.all([first, second, third])
  check("the burst settles after one run", runs === 1, `runs ${runs}`)

  started = new Promise((resolve) => { startedResolve = resolve })
  gate = new Promise((resolve) => { release = resolve })
  const fourth = queue()
  await started
  check("a later call runs again", runs === 2, `runs ${runs}`)
  release()
  await fourth
}

console.log("\nsame-session writes — serialized, final storage/mirror/index agree")
{
  const events = []
  const h = await harness({ todos: [], phases: [], updatedAt: 0 }, async (_key, value) => {
    const tag = value.todos[0].content
    events.push(`start:${tag}`)
    await delay(tag === "A" ? 20 : 1)
    events.push(`end:${tag}`)
  })
  try {
    const tool = h.tools.get("todowrite")
    await Promise.all([
      tool.execute({ todos: [{ content: "A", status: "in_progress" }], phases: [] }, { sessionID: "ses_serial" }),
      tool.execute({ todos: [{ content: "B", status: "pending" }], phases: [] }, { sessionID: "ses_serial" }),
    ])
    check("storage writes are serialized", events.join("|") === "start:A|end:A|start:B|end:B", events.join("|"))
    check("final storage is the second write", h.storage.record.todos[0].content === "B")
    const mirror = JSON.parse(await readFile(join(h.dir, "ses_serial.json"), "utf8"))
    check("final mirror is the second write", mirror.todos[0].content === "B")
    const index = JSON.parse(await readFile(join(h.dir, "_index.json"), "utf8"))
    const meta = index.sessions.find((session) => session.sessionID === "ses_serial")
    check("final index summary is the second write", Boolean(meta) && meta.title === "B")
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\ncross-session writes — both sessions survive one index write")
{
  const h = await harness()
  try {
    const tool = h.tools.get("todowrite")
    await Promise.all([
      tool.execute({ todos: [{ content: "Cross A", status: "pending" }], phases: [] }, { sessionID: "ses_cross_a" }),
      tool.execute({ todos: [{ content: "Cross B", status: "pending" }], phases: [] }, { sessionID: "ses_cross_b" }),
    ])
    const index = JSON.parse(await readFile(join(h.dir, "_index.json"), "utf8"))
    const ids = new Set(index.sessions.map((session) => session.sessionID))
    check("both sessions are in the index", ids.has("ses_cross_a") && ids.has("ses_cross_b"), `${[...ids].join(",")}`)
    check("the index is valid JSON with a sessions array", Array.isArray(index.sessions) && index.sessions.length === 2)
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\nidentical writes — nothing is rewritten")
{
  const h = await harness()
  try {
    const tool = h.tools.get("todowrite")
    await tool.execute({ todos: [{ content: "same", status: "pending" }], phases: [] }, { sessionID: "ses_same" })
    const mirrorBefore = await stat(join(h.dir, "ses_same.json"))
    const indexBefore = await stat(join(h.dir, "_index.json"))
    const setsBefore = h.storage.sets

    await delay(15)
    const again = await tool.execute({ todos: [{ content: "same", status: "pending" }], phases: [] }, { sessionID: "ses_same" })
    const mirrorAfter = await stat(join(h.dir, "ses_same.json"))
    const indexAfter = await stat(join(h.dir, "_index.json"))

    check("no durable write", h.storage.sets === setsBefore, `sets ${h.storage.sets}`)
    check("the mirror is not rewritten", mirrorAfter.ino === mirrorBefore.ino && mirrorAfter.mtimeMs === mirrorBefore.mtimeMs)
    check("the index is not rewritten", indexAfter.ino === indexBefore.ino && indexAfter.mtimeMs === indexBefore.mtimeMs)
    check("the tool still reports the list", typeof again.content === "string" && again.content.length > 0)

    await tool.execute({ todos: [{ content: "same", status: "completed" }], phases: [] }, { sessionID: "ses_same" })
    check("a changed list writes again", h.storage.sets === setsBefore + 1)
    const doc = JSON.parse(await readFile(join(h.dir, "ses_same.json"), "utf8"))
    check("the changed list reached the mirror", doc.todos[0].status === "completed")
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\nindex freshness — same mtime, changed size must refresh the summary")
{
  const h = await harness()
  try {
    const victim = join(h.dir, "ses_victim.json")
    const fixed = new Date(1700000000000)
    await writeFile(victim, JSON.stringify({
      version: 2,
      sessionID: "ses_victim",
      todos: [{ content: "old", status: "pending" }],
      updatedAt: 1,
    }))
    await utimes(victim, fixed, fixed)

    const tool = h.tools.get("todowrite")
    await tool.execute({ todos: [{ content: "other one", status: "pending" }], phases: [] }, { sessionID: "ses_other" })
    let index = JSON.parse(await readFile(join(h.dir, "_index.json"), "utf8"))
    let meta = index.sessions.find((session) => session.sessionID === "ses_victim")
    check("first scan sees the old summary", Boolean(meta) && meta.title === "old" && meta.pending === 1)

    await writeFile(victim, JSON.stringify({
      version: 2,
      sessionID: "ses_victim",
      todos: [{ content: "new and longer", status: "completed" }],
      updatedAt: 2,
    }))
    await utimes(victim, fixed, fixed)

    await tool.execute({ todos: [{ content: "other two", status: "pending" }], phases: [] }, { sessionID: "ses_other" })
    index = JSON.parse(await readFile(join(h.dir, "_index.json"), "utf8"))
    meta = index.sessions.find((session) => session.sessionID === "ses_victim")
    check("same mtime but a new size refreshes the summary", Boolean(meta) && meta.title === "new and longer" && meta.done === 1)
    check("the fresh summary is not the stale one", digest(meta) !== digest({ sessionID: "ses_victim", updatedAt: 1700000000000, title: "old", total: 1, done: 0, doing: 0, pending: 1, cancelled: 0, blocked: 0, byPhase: { "": 1 }, phases: [] }))
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\nmirror recovery — an identical write rebuilds a missing mirror")
{
  const h = await harness()
  try {
    const tool = h.tools.get("todowrite")
    const todos = [{ content: "kept", status: "pending", id: "k1" }]
    const first = await tool.execute({ todos, phases: ["调研"] }, { sessionID: "ses_repair" })
    const updatedAt = h.storage.record.updatedAt
    const setsBefore = h.storage.sets
    await rm(join(h.dir, "ses_repair.json"), { force: true })

    const second = await tool.execute({ todos }, { sessionID: "ses_repair" })
    const mirror = JSON.parse(await readFile(join(h.dir, "ses_repair.json"), "utf8"))
    check("the mirror is rebuilt", mirror.todos[0].content === "kept")
    check("the repair keeps the stored updatedAt", mirror.updatedAt === updatedAt)
    check("the repair does not write storage", h.storage.sets === setsBefore, `sets ${h.storage.sets}`)
    check("the repair returns the same tool result", second.content === first.content)
    const index = JSON.parse(await readFile(join(h.dir, "_index.json"), "utf8"))
    const meta = index.sessions.find((session) => session.sessionID === "ses_repair")
    check("the repaired session stays in the index", Boolean(meta) && meta.updatedAt === updatedAt)
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\nmirror recovery — a new generation rebuilds a missing mirror")
{
  const h = await harness()
  let dispose = null
  try {
    const todos = [{ content: "kept", status: "pending", id: "k1" }]
    await h.tools.get("todowrite").execute({ todos }, { sessionID: "ses_restart" })
    const updatedAt = h.storage.record.updatedAt
    await h.dispose()
    await rm(join(h.dir, "ses_restart.json"), { force: true })

    // A new plugin generation: its signature map starts empty. The fresh read
    // must still prevent a duplicate write, and the missing mirror must be rebuilt
    // without bumping updatedAt.
    const tools = new Map()
    process.env.TODO_BRIDGE_DIR = h.dir
    dispose = await plugin.setup({
      storage: {
        get: async () => h.storage.record,
        set: async (_key, value) => {
          h.storage.sets += 1
          h.storage.record = value
        },
      },
      tool: {
        transform: async (fn) => {
          fn({ add: (tool) => tools.set(tool.name, tool) })
          return { dispose: async () => {} }
        },
      },
      session: { hook: async () => ({ dispose: async () => {} }) },
    })
    const setsBefore = h.storage.sets
    await tools.get("todowrite").execute({ todos }, { sessionID: "ses_restart" })
    const mirror = JSON.parse(await readFile(join(h.dir, "ses_restart.json"), "utf8"))
    check("a new generation rebuilds the mirror", mirror.todos[0].content === "kept")
    check("the restart repair keeps updatedAt", mirror.updatedAt === updatedAt && h.storage.record.updatedAt === updatedAt)
    check("the restart repair does not write storage", h.storage.sets === setsBefore, `sets ${h.storage.sets}`)
  } finally {
    if (dispose) await dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

if (failed > 0) {
  console.error(`\n${failed} index-state check(s) failed`)
  process.exit(1)
}
console.log("\nall index-state checks passed")
