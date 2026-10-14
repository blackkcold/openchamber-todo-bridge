/**
 * Node test for src/dag.js — the phase-swimlane graph layout.
 *
 * Pure, so the whole layout is checkable here: dependency depth per column,
 * phase per lane, unknown-dependency and cycle tolerance. `design/verify-pages.html`
 * covers how it looks.
 */
import { dagLayout } from "../src/dag.js"

let failed = 0
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { failed += 1; console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`) }
  else console.log("PASS:", name)
}

const T = (content, extra = {}) => ({ content, status: "pending", priority: "", ...extra })
const rankOf = (nodes, content) => nodes.find((n) => n.content === content).rank
const laneOf = (nodes, content) => nodes.find((n) => n.content === content).lane

// --- parent chain -> ranks 0,1,2 ----------------------------------------------
{
  const { nodes, edges } = dagLayout([
    T("a", { id: "a" }),
    T("b", { id: "b", parentId: "a" }),
    T("c", { id: "c", parentId: "b" }),
  ])
  eq("chain ranks", [rankOf(nodes, "a"), rankOf(nodes, "b"), rankOf(nodes, "c")], [0, 1, 2])
  eq("chain parent edges", edges.filter((e) => e.kind === "parent").length, 2)
}

// --- dependsOn raises the column ----------------------------------------------
{
  const { nodes, edges } = dagLayout([T("a", { id: "a" }), T("b", { id: "b", dependsOn: ["a"] })])
  eq("depends raises rank", rankOf(nodes, "b"), 1)
  eq("depends edge kind", edges.filter((e) => e.kind === "depends").length, 1)
}

// --- lanes follow the declared phases; empty phase -> ungrouped ---------------
{
  const { nodes, lanes } = dagLayout(
    [T("x", { id: "x", phase: "实现" }), T("y", { id: "y", phase: "调研" }), T("z", { id: "z" })],
    ["调研", "实现", "发布"],
  )
  const nameToLane = (name) => lanes.findIndex((l) => l.name === name)
  eq("调研 before 实现", laneOf(nodes, "y") < laneOf(nodes, "x"), true)
  eq("调研 is lane 0", laneOf(nodes, "y"), nameToLane("调研"))
  eq("ungrouped lane exists", lanes.some((l) => l.name === "未分组"), true)
  eq("empty phase -> ungrouped", laneOf(nodes, "z"), nameToLane("未分组"))
}

// --- unknown dependency is ignored --------------------------------------------
{
  const { nodes, edges } = dagLayout([T("a", { id: "a", dependsOn: ["nope"] })])
  eq("unknown dep: no edge", edges.length, 0)
  eq("unknown dep: rank 0", nodes[0].rank, 0)
}

// --- self dependency is ignored -----------------------------------------------
{
  const { nodes, edges } = dagLayout([T("a", { id: "a", dependsOn: ["a"] })])
  eq("self dep: no edge", edges.length, 0)
  eq("self dep: rank 0", nodes[0].rank, 0)
}

// --- a parent cycle does not hang ---------------------------------------------
{
  const { nodes } = dagLayout([T("a", { id: "a", parentId: "b" }), T("b", { id: "b", parentId: "a" })])
  eq("cycle: both present", nodes.length, 2)
  eq("cycle: both rank 0", nodes.map((n) => n.rank), [0, 0])
}

// --- a dependsOn cycle does not hang ------------------------------------------
{
  const { nodes } = dagLayout([
    T("a", { id: "a", dependsOn: ["b"] }),
    T("b", { id: "b", dependsOn: ["a"] }),
  ])
  eq("dep cycle: no hang", nodes.length, 2)
}

// --- blocked is carried through -----------------------------------------------
{
  const { nodes } = dagLayout([
    T("done", { id: "a", status: "completed" }),
    T("doing", { id: "b", status: "in_progress" }),
    T("dep-ok", { id: "c", dependsOn: ["a"] }),
    T("dep-blocked", { id: "d", dependsOn: ["b"] }),
  ])
  eq("blocked: dep done -> false", nodes.find((n) => n.content === "dep-ok").blocked, false)
  eq("blocked: dep doing -> true", nodes.find((n) => n.content === "dep-blocked").blocked, true)
}

// --- two nodes in the same lane+column stack (different y) ---------------------
{
  const { nodes } = dagLayout([T("a", { id: "a", phase: "实现" }), T("b", { id: "b", phase: "实现" })])
  eq("same cell: same x", nodes[0].x, nodes[1].x)
  eq("same cell: different y", nodes[0].y !== nodes[1].y, true)
}

// --- geometry is positive -----------------------------------------------------
{
  const { width, height, lanes } = dagLayout([T("a", { id: "a" }), T("b", { id: "b", phase: "实现" })])
  eq("width positive", width > 0, true)
  eq("height positive", height > 0, true)
  eq("lanes non-empty", lanes.length > 0, true)
}

// --- deterministic keys, like the tree ----------------------------------------
{
  const { nodes } = dagLayout([T("a"), T("b")])
  eq("keys distinct", nodes[0].key !== nodes[1].key, true)
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log("\nall dag checks passed")
