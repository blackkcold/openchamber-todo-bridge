// The compact per-round reminder.
//
// The reminder is transient tail context: every round pays for it. These checks
// pin the compact contract — open work first, done/cancelled only where open
// work structurally needs them, hard character bounds, and deterministic bytes.
// `render()` (todoread / finished results) is not covered here; test-state and
// test-cache pin that surface.

import { createHash } from "node:crypto"
import {
  appendReminder,
  buildReminder,
  renderReminder,
  structuralReferences,
} from "../opencode-plugin/index.js"

let failed = 0
const check = (name, pass, detail = "") => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}
const digest = (value) => createHash("sha256").update(value).digest("hex")

const task = (index, status = "pending", extra = {}) => ({
  content: `Task ${index}: a descriptive task title used to measure the reminder size`,
  status,
  ...extra,
})

const DONE_TITLES = "已完成任务的标题"
const DONE_47_OPEN_3 = [
  ...Array.from({ length: 47 }, (_, index) => ({
    content: `${DONE_TITLES} ${index + 1}`,
    status: "completed",
    id: `d${index + 1}`,
    phase: index % 4 === 0 ? "调研" : "实现",
  })),
  task(48, "in_progress", { id: "t48", phase: "验证" }),
  task(49, "pending", { id: "t49", phase: "验证" }),
  task(50, "pending", { id: "t50", phase: "验证" }),
]

const STRUCTURED = [
  { content: "Parent task", status: "completed", id: "t1", phase: "调研" },
  { content: "Child task", status: "in_progress", id: "t2", parentId: "t1", phase: "实现", dependsOn: ["t1"] },
  { content: "Sibling task", status: "pending", id: "t3", phase: "实现" },
]
const PHASES = ["调研", "实现"]

const LONG_200 = Array.from({ length: 200 }, (_, index) =>
  task(index + 1, index === 0 ? "in_progress" : "pending", {
    id: `l${index + 1}`,
    phase: index % 5 === 0 ? "调研" : "实现",
  }),
)

const openLines = (text) => text.split("\n").filter((line) => /^\d+\. \[[ •]\] /.test(line))
const hiddenCount = (text) => {
  const match = text.match(/^… \+(\d+) open not shown; call todoread\.$/m)
  return match ? Number(match[1]) : 0
}

console.log("\ncompact reminder — 47 done + 3 open")
const compact47 = renderReminder(DONE_47_OPEN_3, [])
check("stays at or under 900 chars", compact47.length <= 900, `${compact47.length} chars`)
check("carries the done count", /Done: 47/.test(compact47))
check("does not repeat finished titles", !compact47.includes(DONE_TITLES))
check("keeps all three open items", openLines(compact47).length === 3)
check("has no truncation line when everything fits", hiddenCount(compact47) === 0)
check("keeps the two-line header", compact47.startsWith(
  "[Session task state — reference only; continue the user's current task.]\nCurrent todo list for this session:\n",
))
check("keeps the footer nudge", compact47.includes("Keep this list current with todowrite:") &&
  compact47.includes("stable `id`s, `parentId`, `phase`, `dependsOn`"))

console.log("\ncompact reminder — structural references")
const structured = renderReminder(STRUCTURED, PHASES)
check("names the completed parent id", structured.includes("#t1"))
check("prints the completed parent title", structured.includes("Parent task"))
check("prints the parent link on open work", structured.includes("<- t1"))
check("prints the dependency on open work", structured.includes("deps:t1"))
check("prints the declared phase order", structured.includes("Phases: 调研, 实现"))
check("prints a labelled reference block", structured.includes("Referenced done/cancelled:") &&
  structured.includes("  + #t1 [x] Parent task"))
check("does not list the completed parent as open work", openLines(structured).length === 2)
{
  const refs = structuralReferences(STRUCTURED, STRUCTURED.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled"))
  check("structuralReferences returns the parent once", refs.length === 1 && refs[0].id === "t1")
  const cancelledDep = [
    { content: "Open", status: "pending", id: "a", dependsOn: ["b"] },
    { content: "Dropped", status: "cancelled", id: "b" },
  ]
  check(
    "structuralReferences includes a cancelled dependency",
    structuralReferences(cancelledDep, [cancelledDep[0]])[0]?.id === "b",
  )
  const cycle = [
    { content: "Root done", status: "completed", id: "r", parentId: "r2" },
    { content: "Second done", status: "completed", id: "r2", parentId: "r" },
    { content: "Open child", status: "pending", id: "o", parentId: "r" },
  ]
  let terminated = true
  let cycleText = ""
  try {
    cycleText = renderReminder(cycle, [])
  } catch {
    terminated = false
  }
  check("a parent cycle terminates", terminated)
  check("a parent cycle still names both ancestors", cycleText.includes("#r") && cycleText.includes("#r2"))
}

console.log("\ncompact reminder — 200 open items")
const compact200 = renderReminder(LONG_200, [])
const shown200 = openLines(compact200).length
const hidden200 = hiddenCount(compact200)
check("shows at most 40 items", shown200 <= 40, `${shown200} shown`)
check("truncation count is open.length - shown", hidden200 === 200 - shown200, `${hidden200} hidden`)
check("every open item is shown or counted", shown200 + hidden200 === 200)
check("stays at or under 2400 chars", compact200.length <= 2400, `${compact200.length} chars`)
check(
  "the truncation line is the exact wording",
  compact200.includes(`… +${hidden200} open not shown; call todoread.`),
)

console.log("\ncompact reminder — item truncation and bounds")
{
  const text = renderReminder([
    { content: "长".repeat(300), status: "pending", id: "big" },
    { content: "short", status: "pending", id: "small" },
  ], [])
  const big = openLines(text).find((line) => line.includes("#big")) || ""
  const content = big.replace(/^\d+\. \[ \] /, "").replace(/ #big$/, "")
  check("a long item is truncated", content.endsWith("…") && content.length <= 200, `${content.length} chars`)
  check("the short item is untouched", text.includes("[ ] short"))
}
{
  const manyDone = Array.from({ length: 15 }, (_, index) => ({
    content: `Finished parent ${index + 1}`,
    status: "completed",
    id: `p${index + 1}`,
  }))
  const children = manyDone.map((parent, index) => ({
    content: `Open child ${index + 1}`,
    status: "pending",
    id: `c${index + 1}`,
    parentId: parent.id,
  }))
  const text = renderReminder([...manyDone, ...children], [])
  const detailed = (text.match(/^ {2}\+ #p\d+ \[x\] /gm) || []).length
  check("caps detailed references at 12", detailed === 12, `${detailed} detailed`)
  check("prints the remaining references as ids", text.includes("Referenced ids only:") &&
    text.includes("#p13") && text.includes("#p15"))
  check("the pathological reference list still fits 2400", text.length <= 2400, `${text.length} chars`)
  const idLine = (text.match(/^Referenced ids only: .*$/m) || [])[0] || ""
  check(
    "all 15 fit, so the ids line is complete and unellipsised",
    idLine.includes("#p13") && idLine.includes("#p14") && idLine.includes("#p15") && !idLine.endsWith("…"),
    idLine,
  )
}

console.log("\ncompact reminder — reference budget never cuts an id")
{
  // 13 references with ~80-char ids and 120-char titles, plus a long phase list,
  // so the full reference block cannot fit and the ids line has to be shortened.
  const longId = (index) => {
    const base = `p${index}-`
    return base + "x".repeat(80 - base.length)
  }
  const parents = Array.from({ length: 13 }, (_, index) => ({
    content: `已完成任务的长标题 ${index + 1} `.padEnd(120, "描"),
    status: "completed",
    id: longId(index + 1),
  }))
  const children = parents.map((parent, index) => ({
    content: `Open child ${index + 1}`,
    status: "pending",
    id: `c${index + 1}`,
    parentId: parent.id,
  }))
  const longPhases = Array.from({ length: 24 }, (_, index) => `阶段${String(index).padStart(2, "0")}`)
  const text = renderReminder([...parents, ...children], longPhases)
  const known = new Set([
    ...parents.map((parent) => parent.id),
    ...children.map((child) => child.id),
  ])
  const tokens = text.match(/#[A-Za-z0-9_-]+/g) || []
  const detailed = (text.match(/^ {2}\+ #p\d+-[a-z0-9]+ \[x\] /gm) || []).length
  check("stays at or under 2400 chars", text.length <= 2400, `${text.length} chars`)
  check("keeps at least one detailed reference", detailed >= 1, `${detailed} detailed`)
  check(
    "every #token is a complete id from the fixture",
    tokens.length > 0 && tokens.every((token) => known.has(token.slice(1))),
    `${tokens.length} tokens`,
  )
}

{
  // Same shape with more references and short titles: the 12 detail lines fit,
  // but only part of the remaining id list does. The line must stop on a whole
  // id, not print a fragment such as `#p14-xxxx` that reads as a real id.
  const longId = (index) => {
    const base = `p${index}-`
    return base + "x".repeat(80 - base.length)
  }
  const parents = Array.from({ length: 20 }, (_, index) => ({
    content: `已完成任务 ${index + 1}`,
    status: "completed",
    id: longId(index + 1),
  }))
  const children = parents.map((parent, index) => ({
    content: `Open child ${index + 1}`,
    status: "pending",
    id: `c${index + 1}`,
    parentId: parent.id,
  }))
  const longPhases = Array.from({ length: 24 }, (_, index) => `阶段${String(index).padStart(2, "0")}`)
  const text = renderReminder([...parents, ...children], longPhases)
  const known = new Set([
    ...parents.map((parent) => parent.id),
    ...children.map((child) => child.id),
  ])
  const tokens = text.match(/#[A-Za-z0-9_-]+/g) || []
  const idLine = (text.match(/^Referenced ids only: .*$/m) || [])[0] || ""
  check("the partial id list stays under 2400", text.length <= 2400, `${text.length} chars`)
  check(
    "the ids line stops on a whole label and marks the cut",
    idLine.endsWith(" …") && tokens.every((token) => known.has(token.slice(1))),
    idLine.slice(-24),
  )
}

{
  // A single referenced parent whose id cannot fit even the ids-only line: the
  // block must emit nothing rather than a fragment like "#p".
  const hugeId = `p${"y".repeat(3000)}`
  const text = renderReminder([
    { content: "Huge parent", status: "completed", id: hugeId },
    { content: "Open child", status: "pending", id: "c1", parentId: hugeId },
  ], [])
  check("an impossible id still returns a bounded reminder", text.length <= 2400, `${text.length} chars`)
  check("no partial # token is emitted", !/#[A-Za-z0-9_-]/.test(text))
}


console.log("\nappendReminder — provider-safe injection")
{
  const reminder = "[Session task state — test reminder]"
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const markers = (message) => (Array.isArray(message.content) ? message.content : [])
    .filter((part) => part && part.type === "text" && typeof part.text === "string" && part.text.startsWith("[Session task state"))

  {
    const userTail = { role: "user", content: [{ type: "text", text: "Do the task" }] }
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "Ready." }] },
      userTail,
    ]
    const event = { messages }
    const arraySnapshot = structuredClone(messages)
    const userSnapshot = structuredClone(userTail)
    check("user tail: reports injection", appendReminder(event, reminder) === true)
    check("user tail: message count is unchanged", event.messages.length === 2)
    check("user tail: last message is still a user", event.messages.at(-1).role === "user")
    check(
      "user tail: two text parts, original first and reminder second",
      event.messages.at(-1).content.length === 2 &&
        event.messages.at(-1).content[0].text === "Do the task" &&
        event.messages.at(-1).content[1].text === reminder,
    )
    check("user tail: no consecutive user roles", event.messages.at(-2).role !== "user")
    check("user tail: the original message object is unmutated", same(userTail, userSnapshot))
    check("user tail: the original array is unmutated", same(messages, arraySnapshot))
    check("user tail: the message array is replaced", event.messages !== messages)
  }

  {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Do the task" }] },
      { role: "tool", content: [{ type: "text", text: "tool output" }] },
    ]
    const event = { messages }
    const snapshot = structuredClone(messages)
    check("tool tail: reports injection", appendReminder(event, reminder) === true)
    check("tool tail: appends one message", event.messages.length === messages.length + 1 && same(messages, snapshot))
    check("tool tail: the new tail is a user reminder", event.messages.at(-1).role === "user" &&
      event.messages.at(-1).content[0].text === reminder)
  }

  for (const status of ["pending", "running"]) {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Do the task" }] },
      { role: "assistant", content: [{ type: "tool", name: "todowrite", state: { status } }] },
    ]
    const event = { messages }
    const snapshot = structuredClone(messages)
    check(`assistant ${status} tool call: no injection`, appendReminder(event, reminder) === false)
    check(`assistant ${status} tool call: history untouched`, event.messages === messages && same(messages, snapshot))
  }

  for (const [label, extra] of [
    ["completed", { type: "tool", name: "todowrite", state: { status: "completed" } }],
    ["error", { type: "tool", name: "todowrite", state: { status: "error" } }],
    ["missing state", { type: "tool", name: "todowrite" }],
    ["plain text", { type: "text", text: "Done." }],
  ]) {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Do the task" }] },
      { role: "assistant", content: [extra] },
    ]
    const event = { messages }
    check(`assistant ${label}: appends a user tail`, appendReminder(event, reminder) === true &&
      event.messages.length === 3 && event.messages.at(-1).role === "user")
  }

  {
    const event = { messages: [{ role: "user", content: [{ type: "text", text: "Do the task" }] }] }
    appendReminder(event, reminder)
    const afterFirst = structuredClone(event.messages)
    appendReminder(event, reminder)
    check("two calls: byte-identical after the first", same(event.messages, afterFirst))
    check("two calls: exactly one reminder part", markers(event.messages.at(-1)).length === 1)
  }

  {
    const event = { messages: [{ role: "user", content: "Do the task" }] }
    check("string content: reports injection", appendReminder(event, reminder) === true)
    check(
      "string content becomes two text parts",
      Array.isArray(event.messages.at(-1).content) &&
        event.messages.at(-1).content.length === 2 &&
        event.messages.at(-1).content[0].text === "Do the task" &&
        event.messages.at(-1).content[1].text === reminder,
    )
  }

  {
    const event = { messages: [{ role: "user", content: "[Session task state — old]" }] }
    check("string reminder is replaced", appendReminder(event, reminder) === true &&
      event.messages.at(-1).content.length === 1 && event.messages.at(-1).content[0].text === reminder)
  }

  {
    const event = {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Do the task" },
          { type: "text", text: "[Session task state — old]" },
          { type: "image", url: "data:image/png;base64,AA" },
        ],
      }],
    }
    check("array reminder is replaced, not appended", appendReminder(event, reminder) === true)
    const content = event.messages.at(-1).content
    check(
      "array replacement keeps the original text and non-text part, one reminder",
      content.length === 3 && content[0].text === "Do the task" &&
        content[1].type === "image" && markers(event.messages.at(-1)).length === 1,
    )
  }

  for (const [label, event] of [
    ["null event", null],
    ["missing messages", {}],
    ["non-array messages", { messages: "not an array" }],
    ["malformed user content", { messages: [{ role: "user", content: 42 }] }],
  ]) {
    let threw = false
    let result = null
    try {
      result = appendReminder(event, reminder)
    } catch {
      threw = true
    }
    check(`malformed input (${label}): false, no throw`, !threw && result === false)
  }
}

console.log("\ncompact reminder — determinism and wiring")
check("two calls are byte-identical", renderReminder(STRUCTURED, PHASES) === renderReminder(STRUCTURED, PHASES))
check("buildReminder delegates to renderReminder", buildReminder(STRUCTURED, PHASES) === renderReminder(STRUCTURED, PHASES))
check("same digest on a second call", digest(renderReminder(LONG_200, [])) === digest(renderReminder(LONG_200, [])))
check("buildReminder([]) is still readable", buildReminder([]).includes("(the todo list is empty)"))

if (failed > 0) {
  console.error(`\n${failed} reminder check(s) failed`)
  process.exit(1)
}
console.log("\nall reminder checks passed")
