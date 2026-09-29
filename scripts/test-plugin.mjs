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
import { buildReminder, TODOWRITE_DESCRIPTION } from "../opencode-plugin/index.js"

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

console.log(`\ndescription length: ${TODOWRITE_DESCRIPTION.length} chars`)
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
