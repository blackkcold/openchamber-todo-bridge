// Adversarial cache/context guard.
//
// The reminder is transient tail context: it is appended to the outgoing request
// after the persisted conversation. That is only safe while three things stay
// true, and this harness is what keeps them true:
//
//   1. system and tools are never mutated, and everything before the last user
//      message stays byte-stable;
//   2. an unchanged todo list produces byte-identical reminder text, with no
//      clock, random, round counter or object-key-order dependency;
//   3. the transient reminder is neither written to storage nor persisted as a
//      user turn, and it cannot grow the request beyond a bounded budget.
//
// Provider cache hits are not observable here. `scripts/cache-audit.mjs` reads
// the real OpenCode SQLite usage data for that; this file guards the deterministic
// half that a provider cache depends on.

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin, { buildReminder, TOOL_SURFACE, TODOS_INPUT, TODOWRITE_DESCRIPTION } from "../opencode-plugin/index.js"

let failed = 0
const check = (name, pass, detail = "") => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
/** A hash of model-visible text, so an accidental wording change is a test failure. */
const textDigest = (value) => createHash("sha256").update(value).digest("hex")

const task = (index, status = "pending", extra = {}) => ({
  content: `Task ${index}: a descriptive task title used to measure cache context`,
  status,
  ...extra,
})

const THREE_OPEN = [
  task(1, "in_progress", { id: "t1", phase: "调研", priority: "high" }),
  task(2, "pending", { id: "t2", phase: "实现" }),
  task(3, "pending", { id: "t3", phase: "实现" }),
]

const DONE_47_OPEN_3 = [
  ...Array.from({ length: 47 }, (_, index) => task(index + 1, "completed", {
    id: `t${index + 1}`,
    phase: index % 4 === 0 ? "调研" : "实现",
    ...(index % 3 === 0 ? { priority: "high" } : {}),
  })),
  task(48, "in_progress", { id: "t48", phase: "验证", priority: "high" }),
  task(49, "pending", { id: "t49", phase: "验证" }),
  task(50, "pending", { id: "t50", phase: "验证" }),
]

const STRUCTURED_10 = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1
  const status = number === 1 ? "in_progress" : number <= 3 ? "pending" : "completed"
  return task(number, status, {
    id: `s${number}`,
    phase: number <= 5 ? "调研" : "实现",
    ...(number > 1 && number <= 5 ? { parentId: `s${number - 1}` } : {}),
    ...(number > 2 && number <= 5 ? { dependsOn: [`s${number - 2}`] } : {}),
    ...(number === 1 ? { priority: "high" } : {}),
  })
})

const LONG_200 = Array.from({ length: 200 }, (_, index) => task(index + 1, index === 0 ? "in_progress" : "pending", {
  id: `l${index + 1}`,
  phase: index % 5 === 0 ? "调研" : "实现",
}))

/** A finished list: the tool result is counts only, and `todoread` recovers the titles. */
const FINISHED_TWO = [
  task(1, "completed", { id: "t1", phase: "调研" }),
  task(2, "cancelled", { id: "t2", phase: "实现" }),
]

/**
 * Model-visible text is frozen. These hashes are computed from the current
 * production wording; a failure means the prompt surface changed and the cache
 * cost must be a deliberate, measured decision — not an accident.
 *
 * `TOOL_PREFIX_HASH` (below) covers the tools prefix. These cover the two
 * transient/history surfaces the plugin writes per request.
 */
const REMINDER_HASH_NO_PHASES = "3cc7829133b8051fe626fab388b5c7678729a9df5a854d931171009b06817826"
const REMINDER_HASH_WITH_PHASES = "7fa9585cd64fff543c28942c1ee0dbf91d129c10c72e789d65a8db4d07ee14b8"
const RESULT_OPEN_HASH = "2c57290332ab05bf176c20b40359e1b71bd49207223e1a980f89bc5eb14500b6"
const RESULT_FINISHED_HASH = "01a6ac3d12a1f99eb943fc559169b9a2221152cd4b2541a57cd5454483c0acd9"
const TOOL_SURFACE_HASH = "c7fd78e6dc4094ee8ca2ad141e9c0ba878ea97537bab3a9883924ce151b47ce0"

/**
 * A minimal V2 plugin context: real plugin setup, real tools, real mirror/index
 * writes in a temp directory, and a mutable storage record the test can change.
 */
async function harness(todos) {
  const dir = await mkdtemp(join(tmpdir(), "todo-cache-"))
  process.env.TODO_BRIDGE_DIR = dir
  let hook = null
  const tools = new Map()
  const storage = { gets: 0, sets: 0, record: { todos, phases: [] } }
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
  return { dir, hook, tools, storage, dispose }
}

function request(history, system, tools, sessionID = "ses_cache_fixture") {
  return {
    sessionID,
    system: structuredClone(system),
    tools: structuredClone(tools),
    messages: structuredClone(history),
  }
}

const SYSTEM = [{ type: "text", text: "Stable system policy that must never change per round." }]
const TOOLS = [
  { name: "read", description: "Read a file." },
  { name: "todowrite", description: TODOWRITE_DESCRIPTION },
]

// ---- prefix: the part a provider can cache ---------------------------------

console.log("\ncache prefix — system/tools and the prefix before the last user stay stable")
{
  const h = await harness(THREE_OPEN)
  try {
    const history = [{ role: "user", content: [{ type: "text", text: "Do the task" }] }]
    const reminders = []
    for (let round = 0; round < 4; round += 1) {
      const lastIsUser = history.at(-1)?.role === "user"
      const expectedPrefix = lastIsUser ? history.slice(0, -1) : history
      const snapshot = structuredClone(history)
      const event = request(history, SYSTEM, TOOLS)
      await h.hook(event)
      check(`round ${round + 1}: system prefix unchanged`, digest(event.system) === digest(SYSTEM))
      check(`round ${round + 1}: tools prefix unchanged`, digest(event.tools) === digest(TOOLS))
      check(
        `round ${round + 1}: everything before the last user is unchanged`,
        digest(event.messages.slice(0, expectedPrefix.length)) === digest(expectedPrefix),
      )
      check(
        `round ${round + 1}: only a non-user tail grows the message count`,
        event.messages.length === history.length + (lastIsUser ? 0 : 1),
        `${event.messages.length} vs ${history.length}`,
      )
      const tail = event.messages.at(-1)
      const reminderPart = tail && Array.isArray(tail.content)
        ? tail.content.find((part) => typeof part?.text === "string" && part.text.startsWith("[Session task state"))
        : null
      check(
        `round ${round + 1}: tail is a user reminder`,
        Boolean(tail) && tail.role === "user" && Boolean(reminderPart),
      )
      if (lastIsUser) {
        check(
          `round ${round + 1}: the last user's original text is preserved`,
          tail.content[0]?.text === "Do the task" && tail.content.length === 2,
        )
      }
      check(
        `round ${round + 1}: no consecutive user roles`,
        !(event.messages.length >= 2 && event.messages.at(-2).role === "user"),
      )
      check(`round ${round + 1}: the input history is not mutated`, digest(history) === digest(snapshot))
      reminders.push(reminderPart.text)
      history.push({ role: "assistant", content: [{ type: "text", text: "Working on it." }] })
      history.push({ role: "tool", content: [{ type: "text", text: "Tool result." }] })
    }
    check("unchanged list -> byte-identical reminders", new Set(reminders).size === 1)
    check("context hook never writes storage", h.storage.sets === 0)
    check("context reads storage once per session, not once per round", h.storage.gets === 1, `gets ${h.storage.gets}`)

    // A new write may bump updatedAt, but an unchanged list must keep the text.
    await h.tools.get("todowrite").execute({ todos: THREE_OPEN, phases: [] }, { sessionID: "ses_cache_fixture" })
    const bumped = request(history, SYSTEM, TOOLS)
    await h.hook(bumped)
    check("unchanged list with a new updatedAt keeps the same reminder", bumped.messages.at(-1).content[0].text === reminders[0])

    // A repeated hook on one event must not add a second reminder.
    const repeated = request(history, SYSTEM, TOOLS)
    await h.hook(repeated)
    const once = structuredClone(repeated.messages)
    await h.hook(repeated)
    check("a repeated hook adds no second reminder", digest(repeated.messages) === digest(once))
    const markerCount = repeated.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((part) => typeof part?.text === "string" && part.text.startsWith("[Session task state")).length
    check("one reminder part after two hooks", markerCount === 1, `${markerCount} parts`)

    // A list change may change the tail, but it must not move the prefix.
    await h.tools.get("todowrite").execute({ todos: [{ content: "Changed task", status: "pending" }], phases: [] }, { sessionID: "ses_cache_fixture" })
    const changed = request(history, SYSTEM, TOOLS)
    await h.hook(changed)
    check("changed list: system prefix unchanged", digest(changed.system) === digest(SYSTEM))
    check("changed list: tools prefix unchanged", digest(changed.tools) === digest(TOOLS))
    check("changed list: persisted message prefix unchanged", digest(changed.messages.slice(0, history.length)) === digest(history))
    check("changed list: only the tail carries the new task", changed.messages.length === history.length + 1 && changed.messages.at(-1).content[0].text.includes("Changed task"))
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

// ---- frozen prompt surfaces -------------------------------------------------

console.log("\ncache safety — model-visible text is frozen")
check(
  "reminder without declared phases is unchanged",
  textDigest(buildReminder(THREE_OPEN, [])) === REMINDER_HASH_NO_PHASES,
)
check(
  "reminder with declared phases is unchanged",
  textDigest(buildReminder(THREE_OPEN, ["调研", "实现"])) === REMINDER_HASH_WITH_PHASES,
)

// ---- session cache ----------------------------------------------------------

console.log("\nsession cache — todoread is fresh; context cache TTL expires")
{
  const h = await harness(THREE_OPEN)
  try {
    const history = [{ role: "user", content: [{ type: "text", text: "Do the task" }] }]
    const first = request(history, SYSTEM, TOOLS)
    await h.hook(first)
    const afterFirst = h.storage.gets
    await h.tools.get("todoread").execute({}, { sessionID: "ses_cache_fixture" })
    check("todoread reads fresh, not from the session cache", h.storage.gets === afterFirst + 1, `gets ${h.storage.gets}`)
    const afterRead = h.storage.gets

    const realNow = Date.now
    try {
      Date.now = () => realNow() + 10 * 60 * 1000
      const expired = request(history, SYSTEM, TOOLS)
      await h.hook(expired)
      check("an expired context cache re-reads storage", h.storage.gets === afterRead + 1, `gets ${h.storage.gets}`)
    } finally {
      Date.now = realNow
    }
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

// ---- no history pollution ---------------------------------------------------

console.log("\ncache safety — the hook does not mutate the input history")
{
  const h = await harness(THREE_OPEN)
  try {
    const history = [{ role: "user", content: [{ type: "text", text: "Do the task" }] }]
    const snapshot = structuredClone(history)
    const event = { sessionID: "ses_cache_fixture", system: SYSTEM, tools: TOOLS, messages: history }
    await h.hook(event)
    check("input message array is not mutated", history.length === 1, `length ${history.length}`)
    check("input message object is not mutated", digest(history) === digest(snapshot))
    check("hook assigns a new message array", event.messages !== history && event.messages.length === 1)
    check("the last user message object is rebuilt", event.messages[0] !== history[0])
    check(
      "the rebuilt message keeps the original text and adds the reminder",
      event.messages[0].content[0].text === "Do the task" && event.messages[0].content.length === 2,
    )
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

// ---- storage failure must not fail the model request ------------------------

console.log("\ncache safety — a storage fault skips the reminder, not the request")
{
  const dir = await mkdtemp(join(tmpdir(), "todo-cache-failure-"))
  process.env.TODO_BRIDGE_DIR = dir
  let hook = null
  const realError = console.error
  console.error = () => {}
  const dispose = await plugin.setup({
    storage: {
      get: async () => { throw new Error("storage down") },
      set: async () => {},
    },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    session: {
      hook: async (name, callback) => {
        assert.equal(name, "context")
        hook = callback
        return { dispose: async () => {} }
      },
    },
  })
  try {
    const history = [{ role: "user", content: [{ type: "text", text: "Do the task" }] }]
    const event = { sessionID: "ses_cache_failure", system: SYSTEM, tools: TOOLS, messages: structuredClone(history) }
    let threw = false
    try {
      await hook(event)
    } catch {
      threw = true
    }
    check("storage failure does not reject the context hook", !threw)
    check("storage failure leaves the request untouched", digest(event.messages) === digest(history))
  } finally {
    console.error = realError
    await dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- deterministic reminder -------------------------------------------------

console.log("\ncache determinism — no clock, random, round or key-order drift")
{
  const realNow = Date.now
  const realRandom = Math.random
  try {
    Date.now = () => 1
    Math.random = () => 0.1
    const first = buildReminder(DONE_47_OPEN_3, 1)
    Date.now = () => 999999999
    Math.random = () => 0.9
    const second = buildReminder(DONE_47_OPEN_3, 999)
    check("reminder ignores clock/random/round arguments", first === second)
  } finally {
    Date.now = realNow
    Math.random = realRandom
  }

  const a = [{ content: "x", status: "pending", id: "t1", phase: "p" }]
  const b = [{ phase: "p", id: "t1", status: "pending", content: "x" }]
  check("reminder is independent of object key order", buildReminder(a) === buildReminder(b))
}

// ---- bounded context --------------------------------------------------------

console.log("\ncontext budget — reminders are bounded")
{
  const budgets = [
    ["3 open", THREE_OPEN, 900],
    ["47 done + 3 open", DONE_47_OPEN_3, 900],
    ["10 structured", STRUCTURED_10, 900],
    // The compact reminder caps its open section at 2000 chars and the whole
    // block at 2400, so this is the contract ceiling, not just a regression guard.
    ["200 open", LONG_200, 2400],
  ]
  for (const [label, todos, max] of budgets) {
    const h = await harness(todos)
    try {
      const history = [{ role: "user", content: [{ type: "text", text: "Do the task" }] }]
      const event = request(history, SYSTEM, TOOLS)
      const before = JSON.stringify(event).length
      await h.hook(event)
      const after = JSON.stringify(event).length
      const reminderPart = event.messages.at(-1).content.find((part) =>
        typeof part?.text === "string" && part.text.startsWith("[Session task state"))
      const reminder = reminderPart ? reminderPart.text : ""
      check(`${label}: reminder <= ${max} chars`, reminder.length > 0 && reminder.length <= max, `got ${reminder.length}`)
      check(`${label}: a user tail keeps the message count`, event.messages.length === history.length)
      check(`${label}: the last user's text is preserved`, event.messages.at(-1).content[0].text === "Do the task")
      check(
        `${label}: request delta is the reminder plus <= 300 chars`,
        after - before <= reminder.length + 300,
        `delta ${after - before}, reminder ${reminder.length}`,
      )
      console.log(`  size  ${label}: reminder ${reminder.length} chars, request delta ${after - before} chars`)
      if (reminder.length > 2400) {
        console.log(`  warn  ${label}: the reminder is over its 2400-char contract`)
      }
    } finally {
      await h.dispose()
      await rm(h.dir, { recursive: true, force: true })
    }
  }
}

// ---- tool result / description budgets -------------------------------------

console.log("\ncontext budget — tool results and description")
// Changing this text changes the tools prefix and causes a one-time full prompt
// cache miss on upgrade. Keep it byte-identical to 0.9.3 unless that cost is
// deliberate; update the hash together with the release note when it is.
const TOOL_PREFIX_HASH = "ffff9dd8395ebb89d8cd257d01f89a521d68623054f162deea3ab3e857ca2d42"
check(
  "todowrite description/schema unchanged since 0.9.3",
  digest({ description: TODOWRITE_DESCRIPTION, input: TODOS_INPUT }) === TOOL_PREFIX_HASH,
)
check(
  "tool surface digest is frozen (name, description, input, options, order)",
  digest(TOOL_SURFACE) === TOOL_SURFACE_HASH,
  TOOL_SURFACE_HASH.slice(0, 12),
)
check(
  "tool order is todowrite, then todoread",
  TOOL_SURFACE.map((tool) => tool.name).join(",") === "todowrite,todoread",
)
check(
  "the surface carries the exported descriptions and inputs",
  TOOL_SURFACE[0].description === TODOWRITE_DESCRIPTION &&
    TOOL_SURFACE[0].input === TODOS_INPUT &&
    TOOL_SURFACE.every((tool) => tool.options.codemode === false),
)
check(
  "tool description stays in [1200, 3000] chars",
  TODOWRITE_DESCRIPTION.length >= 1200 && TODOWRITE_DESCRIPTION.length <= 3000,
  `got ${TODOWRITE_DESCRIPTION.length}`,
)
{
  const h = await harness(DONE_47_OPEN_3)
  try {
    const tool = h.tools.get("todowrite")
    check("todowrite is registered", Boolean(tool))
    check(
      "both tools are registered in surface order",
      [...h.tools.keys()].join(",") === "todowrite,todoread",
      [...h.tools.keys()].join(","),
    )
    const input = { todos: DONE_47_OPEN_3, phases: ["调研", "实现", "验证"] }
    const inputSize = JSON.stringify(input).length
    const result = await tool.execute(input, { sessionID: "ses_cache_tool" })
    check(
      "todowrite result is not larger than its input + 300 chars",
      result.content.length <= inputSize + 300,
      `result ${result.content.length}, input ${inputSize}`,
    )
    check("todowrite result stays under 30000 chars", result.content.length <= 30000)
    check("todowrite stores once", h.storage.sets === 1)
    const read = await h.tools.get("todoread").execute({}, { sessionID: "ses_cache_tool" })
    check("todoread stays under 30000 chars for 50 items", read.content.length <= 30000)
    console.log(`  size  todowrite result ${result.content.length} chars vs input ${inputSize}; todoread ${read.content.length}`)
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

console.log("\ncache safety — tool result text is frozen")
{
  const h = await harness([])
  try {
    const tool = h.tools.get("todowrite")
    const open = await tool.execute(
      { todos: THREE_OPEN, phases: ["调研", "实现"] },
      { sessionID: "ses_cache_hash_open" },
    )
    check("open-list result is unchanged", textDigest(open.content) === RESULT_OPEN_HASH)
    const finished = await tool.execute(
      { todos: FINISHED_TWO, phases: ["调研", "实现"] },
      { sessionID: "ses_cache_hash_fin" },
    )
    check("finished-list result is the compact counts form", textDigest(finished.content) === RESULT_FINISHED_HASH)
    check(
      "finished-list result does not render the titles",
      !finished.content.includes("Task 1") && !finished.content.includes("Task 2"),
    )
    check("finished-list result stays under 500 chars", finished.content.length <= 500, `${finished.content.length} chars`)
    console.log(`  size  finished-list result ${finished.content.length} chars`)
  } finally {
    await h.dispose()
    await rm(h.dir, { recursive: true, force: true })
  }
}

if (failed > 0) {
  console.error(`\n${failed} cache check(s) failed`)
  process.exit(1)
}
console.log("\nall cache checks passed")
