/**
 * Node test for src/graph.js — the tree layout arithmetic.
 *
 * Same shape as test-viewport.mjs: no dependencies, exit 1 on any failure.
 * `src/graph.js` is pure (no DOM, no SDK), so the tree is checkable here, and
 * `design/verify.html` covers how it looks.
 */
import { buildTree, phaseList, phaseColor, phaseColorIndex, MAX_DEPTH, pruneFinished, finishedCount } from "../src/graph.js"

let failed = 0
function check(name, pass) {
  if (!pass) { failed += 1; console.error("FAIL:", name) } else console.log("PASS:", name)
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { failed += 1; console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`) }
  else console.log("PASS:", name)
}

const T = (content, extra = {}) => ({ content, status: "pending", priority: "", ...extra })
const shape = (rows) => rows.map((r) => [r.content, r.depth, r.isLast, r.ancestorLast])
const names = (rows) => rows.map((r) => r.content)

// --- flat list: no structure, everything is a root, order preserved -----------
{
  const { rows, hasStructure } = buildTree([T("a"), T("b"), T("c")])
  eq("flat: hasStructure false", hasStructure, false)
  eq("flat: order", names(rows), ["a", "b", "c"])
  eq("flat: depths all 0", rows.map((r) => r.depth), [0, 0, 0])
  eq("flat: only last root isLast", rows.map((r) => r.isLast), [false, false, true])
}

// --- phase alone counts as structure -----------------------------------------
{
  const { hasStructure } = buildTree([T("a", { phase: "x" }), T("b")])
  eq("phase alone: hasStructure true", hasStructure, true)
}

// --- simple chain: t1 -> t2 -> t3 ---------------------------------------------
{
  const { rows } = buildTree([
    T("t1", { id: "a" }),
    T("t2", { id: "b", parentId: "a" }),
    T("t3", { id: "c", parentId: "b" }),
  ])
  eq("chain: DFS order", names(rows), ["t1", "t2", "t3"])
  eq("chain: depths", rows.map((r) => r.depth), [0, 1, 2])
  eq("chain: last flags", rows.map((r) => r.isLast), [true, true, true])
  eq("chain: ancestorLast", rows.map((r) => r.ancestorLast), [[], [true], [true, true]])
}

// --- siblings: order and isLast ----------------------------------------------
{
  const { rows } = buildTree([
    T("root", { id: "r" }),
    T("k1", { id: "k1", parentId: "r" }),
    T("k2", { id: "k2", parentId: "r" }),
    T("g1", { id: "g1", parentId: "k2" }),
  ])
  eq("siblings: order", names(rows), ["root", "k1", "k2", "g1"])
  // k1 is not last (k2 follows); k2 is last; g1 (only child of k2) is last.
  eq("siblings: isLast", rows.map((r) => r.isLast), [true, false, true, true])
  // g1: depth 2. ancestors: root(isLast true), k2(isLast true).
  eq("siblings: ancestorLast g1", rows[3].ancestorLast, [true, true])
  // k2: depth 1, ancestor root isLast true.
  eq("siblings: ancestorLast k2", rows[2].ancestorLast, [true])
}

// --- missing parent -> root ---------------------------------------------------
{
  const { rows } = buildTree([T("orphan", { id: "o", parentId: "nope" })])
  eq("missing parent: is root depth 0", rows[0].depth, 0)
  eq("missing parent: isLast true", rows[0].isLast, true)
}

// --- self parent -> root ------------------------------------------------------
{
  const { rows } = buildTree([T("self", { id: "s", parentId: "s" })])
  eq("self parent: root depth 0", rows[0].depth, 0)
}

// --- cycle a<->b: both become roots, no hang, all present --------------------
{
  const { rows } = buildTree([
    T("a", { id: "a", parentId: "b" }),
    T("b", { id: "b", parentId: "a" }),
  ])
  eq("cycle: both present", names(rows).sort(), ["a", "b"])
  eq("cycle: both depth 0", rows.map((r) => r.depth), [0, 0])
}

// --- longer cycle a->b->c->a --------------------------------------------------
{
  const { rows } = buildTree([
    T("a", { id: "a", parentId: "c" }),
    T("b", { id: "b", parentId: "a" }),
    T("c", { id: "c", parentId: "b" }),
  ])
  eq("3-cycle: all present exactly once", names(rows).length, 3)
  eq("3-cycle: all roots", rows.every((r) => r.depth === 0), true)
}

// --- depth cap ----------------------------------------------------------------
{
  const todos = [T("n0", { id: "n0" })]
  for (let i = 1; i <= 9; i += 1) todos.push(T(`n${i}`, { id: `n${i}`, parentId: `n${i - 1}` }))
  const { rows } = buildTree(todos)
  eq("depth cap: all nodes kept", rows.length, 10)
  eq("depth cap: max depth capped", Math.max(...rows.map((r) => r.depth)), MAX_DEPTH)
  eq("depth cap: value is 6", MAX_DEPTH, 6)
}

// --- duplicate ids: second is not a parent target, still present -------------
{
  const { rows } = buildTree([
    T("first", { id: "x" }),
    T("second", { id: "x" }),
    T("child", { id: "y", parentId: "x" }),
  ])
  eq("dup id: all present", rows.length, 3)
  // The child attaches to the first "x".
  eq("dup id: child depth 1", rows.find((r) => r.content === "child").depth, 1)
}

// --- no id: keys are stable and synthetic ------------------------------------
{
  const { rows } = buildTree([T("a"), T("b")])
  eq("no id: synthetic keys distinct", rows[0].key !== rows[1].key, true)
}

// --- phase list --------------------------------------------------------------
{
  eq("phaseList: declared first, then first-appearance",
    phaseList(["a", "b"], [T("t", { phase: "b" }), T("u", { phase: "c" }), T("v", { phase: "a" })]),
    ["a", "b", "c"])
  eq("phaseList: dedup", phaseList(["a", "a"], []), ["a"])
  eq("phaseList: empty", phaseList([], [T("t")]), [])
}

// --- phase color -------------------------------------------------------------
{
  eq("phaseColorIndex finds", phaseColorIndex("b", ["a", "b"]), 1)
  eq("phaseColorIndex miss -> 0", phaseColorIndex("z", ["a", "b"]), 0)
  eq("phaseColor wraps", phaseColor(0), phaseColor(5))
}

// --- colorIndex baked into rows ----------------------------------------------
{
  const { rows } = buildTree(
    [T("t", { id: "t", phase: "impl" }), T("u", { id: "u", parentId: "t", phase: "test" })],
    ["plan", "impl", "test"],
  )
  eq("rows: colorIndex from phase", rows.map((r) => r.colorIndex), [1, 2])
  eq("rows: phase passed through", rows.map((r) => r.phase), ["impl", "test"])
}

// --- blocked: a dependsOn on an unfinished task -------------------------------
{
  const { rows } = buildTree([
    T("done", { id: "a", status: "completed" }),
    T("doing", { id: "b", status: "in_progress" }),
    T("dep-ok", { id: "c", dependsOn: ["a"] }),
    T("dep-blocked", { id: "d", dependsOn: ["b"] }),
    T("dep-unknown", { id: "e", dependsOn: ["nope"] }),
    T("plain", { id: "f" }),
  ])
  const blocked = (name) => rows.find((r) => r.content === name).blocked
  eq("blocked: dep on completed -> false", blocked("dep-ok"), false)
  eq("blocked: dep on in_progress -> true", blocked("dep-blocked"), true)
  eq("blocked: unknown dep ignored", blocked("dep-unknown"), false)
  eq("blocked: no deps -> false", blocked("plain"), false)
}

// --- pruneFinished: hide finished work, keep the path to what is left -------
{
  const contents = (list) => list.map((t) => t.content)
  const leaf = [T("done", { id: "a", status: "completed" }), T("do", { id: "b", status: "in_progress" })]
  eq("prune: drops a finished leaf", contents(pruneFinished(leaf)), ["do"])

  const ancestor = [T("root", { id: "a", status: "completed" }), T("child", { id: "b", parentId: "a", status: "pending" })]
  eq("prune: keeps a finished ancestor of unfinished work", contents(pruneFinished(ancestor)), ["root", "child"])

  const chain = [
    T("a", { id: "a", status: "completed" }),
    T("b", { id: "b", parentId: "a", status: "completed" }),
    T("c", { id: "c", parentId: "b", status: "pending" }),
  ]
  eq("prune: keeps the whole chain down to the unfinished task", contents(pruneFinished(chain)), ["a", "b", "c"])

  const subtree = [T("a", { id: "a", status: "completed" }), T("b", { id: "b", parentId: "a", status: "cancelled" })]
  eq("prune: drops a fully finished subtree", pruneFinished(subtree).length, 0)

  const mixed = [T("x", { status: "pending" }), T("y", { status: "completed" }), T("z", { status: "cancelled" })]
  eq("finishedCount counts completed and cancelled", finishedCount(mixed), 2)
  eq("finishedCount of an open list is zero", finishedCount([T("only", { status: "pending" })]), 0)
}

// --- phase grouping: a flat but phased list becomes a tree -------------------
{
  const { rows } = buildTree(
    [T("a", { id: "a", phase: "设计" }), T("b", { id: "b", phase: "实现" }), T("c", { id: "c", phase: "设计" })],
    ["设计", "实现"],
  )
  eq("group: one synthetic node per phase", rows.filter((r) => r.synthetic).map((r) => r.content), ["设计", "实现"])
  eq("group: synthetic nodes are roots", rows.filter((r) => r.synthetic).every((r) => r.depth === 0), true)
  eq("group: tasks nest one level under their phase", rows.filter((r) => !r.synthetic).map((r) => r.depth), [1, 1, 1])
  eq("group: the first phase is not the last root", rows.find((r) => r.synthetic).isLast, false)
}
{
  const { rows } = buildTree([T("a", { id: "a", phase: "x" }), T("b", { id: "b", parentId: "a", phase: "x" })])
  eq("group: explicit nesting suppresses synthesis", rows.some((r) => r.synthetic), false)
}
{
  const { rows } = buildTree([T("a", { id: "a" }), T("b", { id: "b" })])
  eq("group: a phaseless list is left alone", rows.some((r) => r.synthetic), false)
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log("\nall graph checks passed")
