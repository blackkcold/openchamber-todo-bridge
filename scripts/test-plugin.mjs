// Checks the OpenCode plugin's pure behavior.
//
// Run under Node, not the browser: the plugin imports `node:fs`, `node:os` and
// `node:path`, so it cannot load in a page. `design/plan-matrix.html` covers the
// browser-safe half (`src/plugin-install.js`).
//
// The contract assertions matter most. OpenCode's system prompt never mentions
// todos; in v1 the entire behavioral contract lived in the tool description, and
// that is what made agents reach for the tool unprompted. An earlier revision of
// this plugin condensed the description to a few lines and agents stopped using
// the tool proactively. These assertions exist to stop that regression.
import { buildReminder, TODOWRITE_DESCRIPTION, normalize } from "../opencode-plugin/index.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  const mark = pass ? "PASS" : "FAIL"
  console.log(`  ${mark}  ${name}`)
}

const SAMPLE = [
  { content: "重构支付回调处理", status: "in_progress", priority: "high" },
  { content: "补回归测试", status: "pending" },
  { content: "部署并验证", status: "pending", priority: "low" },
]

console.log("\nbuildReminder — per-round reminder")
const first = buildReminder(SAMPLE, 1)
const many = buildReminder(SAMPLE, 6)
check("carries the whole list", first.includes("重构支付回调处理") && first.includes("部署并验证"))
check("carries progress marks", first.includes("[•]") && first.includes("[ ]"))
check("carries priorities", first.includes("high priority"))
check("first round uses the plain wording", first.includes("Keep this list current") && !first.includes("has not changed"))
check("escalates after repeats", many.includes("has not changed in 6 rounds"))
check("escalation still carries the list", many.includes("重构支付回调处理"))
check("asks for completion as soon as work is done", first.includes("as soon as it is done"))
check("asks for exactly one in_progress", first.includes("one at a time"))
check("empty list renders readably", buildReminder([], 1).includes("(the todo list is empty)"))

console.log("\ntool description — behavioral contract")
const CONTRACT = [
  "3+ distinct steps",
  "Use proactively",
  "New instructions arrive",
  "mark it `in_progress`",
  "don't batch completions",
  "Never based on intent",
  "exactly one `in_progress`",
  "When in doubt, use it.",
  "When NOT to use",
  "Each call replaces the whole list",
]
for (const needle of CONTRACT) check(`contains "${needle}"`, TODOWRITE_DESCRIPTION.includes(needle))
check("description stays substantial (>1200 chars)", TODOWRITE_DESCRIPTION.length > 1200)
check("description documents the structure fields", TODOWRITE_DESCRIPTION.includes("parentId") && TODOWRITE_DESCRIPTION.includes("phase"))

console.log("\nbuildReminder — structure nudge")
check("first round nudges structure", first.includes("parentId") || first.includes("phase"))

console.log("\nnormalize — structure fields")
const structured = normalize({
  phases: ["调研", "实现"],
  todos: [
    { content: "a", status: "pending", id: "t1", phase: "调研" },
    { content: "b", status: "pending", id: "t2", parentId: "t1", dependsOn: ["t1"] },
  ],
})
check("keeps top-level phases", Array.isArray(structured.phases) && structured.phases[0] === "调研")
check("keeps id/phase", structured.todos[0].id === "t1" && structured.todos[0].phase === "调研")
check("keeps parentId/dependsOn", structured.todos[1].parentId === "t1" && Array.isArray(structured.todos[1].dependsOn))
check("omits absent optional fields", !("parentId" in structured.todos[0]) && !("dependsOn" in structured.todos[0]))

const rejects = [
  ["id", { todos: [{ content: "a", status: "pending", id: 5 }] }],
  ["id (empty)", { todos: [{ content: "a", status: "pending", id: "  " }] }],
  ["parentId", { todos: [{ content: "a", status: "pending", parentId: 5 }] }],
  ["phase", { todos: [{ content: "a", status: "pending", phase: 5 }] }],
  ["dependsOn (not array)", { todos: [{ content: "a", status: "pending", dependsOn: "t1" }] }],
  ["dependsOn (bad element)", { todos: [{ content: "a", status: "pending", dependsOn: [5] }] }],
  ["phases (not array)", { todos: [{ content: "a", status: "pending" }], phases: "x" }],
  ["phases (bad element)", { todos: [{ content: "a", status: "pending" }], phases: [5] }],
]
for (const [why, payload] of rejects) {
  let threw = false
  try { normalize(payload) } catch { threw = true }
  check(`rejects bad ${why}`, threw)
}

console.log(`\ndescription length: ${TODOWRITE_DESCRIPTION.length} chars`)
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
