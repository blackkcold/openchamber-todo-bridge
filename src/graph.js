/**
 * Task-tree layout for the Todos section and the task board.
 *
 * Pure: no DOM, no SDK, no host. `src/main.js` and `src/board.js` own the
 * elements; this module owns the shape, and `scripts/test-graph.mjs` exercises
 * it under Node.
 *
 * A flat list is the degenerate tree: every todo a root, nothing to draw. The
 * AI adds `id` / `parentId` / `phase` (see the `todowrite` contract in
 * `opencode-plugin/index.js`) to make a real tree. Everything here tolerates a
 * half-formed one — a parent that does not exist, a self-parent, a cycle, a
 * duplicate id — by resolving it to a root rather than hanging or dropping a
 * task.
 *
 * `buildTree` returns rows in DFS pre-order. Each row carries what the renderer
 * needs to draw the gutter without looking back at the tree:
 *   - `depth`        nesting level, 0 at a root, capped at `MAX_DEPTH`
 *   - `isLast`       whether this node is its parent's last child
 *   - `ancestorLast` one flag per ancestor level: whether that ancestor is a
 *                    last child. A `false` at level k means a vertical trunk
 *                    still runs down the gutter at depth k beside this row.
 */

import { isFinished } from "./doc.js"

/** Nesting step, in CSS px, per level. Kept small for the narrow status rail. */
export const INDENT = 9
/**
 * Deepest level drawn with its own indent. Past this, rows sit at the cap so a
 * pathological tree cannot indent its text off the right edge.
 */
export const MAX_DEPTH = 6

/**
 * Phase -> colour: the host's syntax tokens, with the semantic palette as the
 * fallback for older hosts (the same trick the SDK's git-graph example uses).
 */
export const PHASE_TOKENS = [
  "var(--oc-syntax-keyword, var(--oc-primary))",
  "var(--oc-syntax-string, var(--oc-info))",
  "var(--oc-syntax-number, var(--oc-success))",
  "var(--oc-syntax-function, var(--oc-warning))",
  "var(--oc-syntax-type, var(--oc-error))",
]

/** The colour for a phase index, wrapping the palette. Never throws on NaN. */
export const phaseColor = (index) => {
  const n = Number.isFinite(index) ? Math.trunc(index) : 0
  const len = PHASE_TOKENS.length
  return PHASE_TOKENS[((n % len) + len) % len]
}

/** Index of `phase` in `list`, or 0 when absent (the neutral first colour). */
export const phaseColorIndex = (phase, list) => {
  const i = Array.isArray(list) ? list.indexOf(phase) : -1
  return i < 0 ? 0 : i
}

/** Declared phases first, then any a todo uses, in first-appearance order. */
export function phaseList(declared, todos) {
  const out = []
  const seen = new Set()
  const add = (p) => {
    if (typeof p === "string" && p !== "" && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  if (Array.isArray(declared)) for (const p of declared) add(p)
  for (const todo of todos) add(todo && todo.phase)
  return out
}

/**
 * Whether the list carries any structure worth drawing as a tree rather than a
 * flat checklist. A `parentId` (even null-free) or a phase both count.
 */
export function hasStructure(todos) {
  return todos.some((t) => {
    if (!t) return false
    if (t.parentId !== undefined && t.parentId !== null) return true
    return typeof t.phase === "string" && t.phase !== ""
  })
}

/**
 * Build the tree rows.
 *
 * `declared` is the optional top-level `phases` array from the mirror; it only
 * fixes the colour order.
 */
export function buildTree(todos, declared = []) {
  const list = Array.isArray(todos) ? todos : []
  const phases = phaseList(declared, list)

  // Stable keys. A todo's own `id` when it is present and not already taken;
  // otherwise a synthetic key, so two items never collide in the DOM.
  const taken = new Set()
  const nodes = list.map((todo, index) => {
    const id = typeof todo.id === "string" ? todo.id : ""
    let key = `#${index}`
    if (id !== "") {
      key = taken.has(id) ? `${id}#${index}` : id
      taken.add(id)
    }
    return {
      key,
      index,
      content: todo.content,
      status: todo.status,
      priority: todo.priority || "",
      phase: typeof todo.phase === "string" ? todo.phase : "",
      colorIndex: phaseColorIndex(todo.phase, phases),
      dependsOn: Array.isArray(todo.dependsOn) ? todo.dependsOn : [],
      synthetic: todo.synthetic === true,
      parent: null,
      children: [],
    }
  })

  // id -> the first node carrying it (a later duplicate is not a parent target).
  const byId = new Map()
  for (const node of nodes) {
    const id = list[node.index].id
    if (typeof id === "string" && id !== "" && !byId.has(id)) byId.set(id, node)
  }

  // Link parents, ignoring a missing / self reference.
  for (const node of nodes) {
    const pid = list[node.index].parentId
    if (typeof pid !== "string" || pid === "") continue
    const parent = byId.get(pid)
    if (parent && parent !== node) node.parent = parent
  }

  // A phase-only list (no `parentId` anywhere) still becomes a tree: one
  // synthetic node per used phase, and every task hangs under its phase, so the
  // rows indent and draw connectors instead of reading as a flat list. Explicit
  // nesting always wins — synthesis happens only when nothing is nested.
  const nested = list.some((todo) => typeof todo.parentId === "string" && todo.parentId !== "")
  if (!nested && phases.length > 0) {
    const used = new Set(list.map((todo) => (typeof todo.phase === "string" && todo.phase !== "" ? todo.phase : "")))
    const groups = new Map()
    for (const phase of phases) {
      if (!used.has(phase)) continue
      const group = {
        key: `phase:${phase}`,
        index: -1,
        content: phase,
        status: "",
        priority: "",
        phase,
        colorIndex: phaseColorIndex(phase, phases),
        dependsOn: [],
        synthetic: true,
        parent: null,
        children: [],
      }
      groups.set(phase, group)
      nodes.push(group)
    }
    for (const node of nodes) {
      if (node.synthetic || node.parent) continue
      const phase = list[node.index].phase
      if (typeof phase === "string" && phase !== "" && groups.has(phase)) node.parent = groups.get(phase)
    }
  }

  // Break cycles. Follow each parent chain once, colouring nodes as we go; a
  // node already on the current path closes a cycle, and every node from that
  // node onward is detached to a root. A node that merely leads into a cycle
  // keeps its parent (which is now a root), so no task is ever dropped.
  const state = new Map() // node -> 1 on the current path, 2 settled
  for (const start of nodes) {
    if (state.get(start) === 2) continue
    const path = []
    let cur = start
    while (cur && state.get(cur) !== 2 && state.get(cur) !== 1) {
      state.set(cur, 1)
      path.push(cur)
      cur = cur.parent
    }
    if (cur && state.get(cur) === 1) {
      const from = path.indexOf(cur)
      for (let i = from; i < path.length; i += 1) path[i].parent = null
    }
    for (const node of path) state.set(node, 2)
  }

  const roots = []
  for (const node of nodes) {
    if (node.parent) node.parent.children.push(node)
    else roots.push(node)
  }

  const rows = []
  const visit = (node, depth, isLast, ancestorLast) => {
    rows.push({
      key: node.key,
      index: node.index,
      content: node.content,
      status: node.status,
      priority: node.priority,
      phase: node.phase,
      colorIndex: node.colorIndex,
      depth: Math.min(depth, MAX_DEPTH),
      isLast,
      ancestorLast,
      synthetic: node.synthetic === true,
      blocked: (node.status === "pending" || node.status === "in_progress") && node.dependsOn.some((dep) => {
        const target = byId.get(dep)
        return Boolean(target) && target.status !== "completed"
      }),
    })
    const kids = node.children
    for (let i = 0; i < kids.length; i += 1) {
      visit(kids[i], depth + 1, i === kids.length - 1, ancestorLast.concat([isLast]))
    }
  }
  for (const root of roots) visit(root, 0, root === roots[roots.length - 1], [])

  return { rows, hasStructure: hasStructure(list), phases }
}

/**
 * Keep only the tasks worth showing by default: the unfinished ones, plus every
 * ancestor that leads to one.
 *
 * A node is dropped only when it *and all its descendants* are finished, so a
 * surviving task never loses its parent — the pruned list stays a well-formed
 * tree. Expanding the "finished" fold renders the original list instead.
 */
export function pruneFinished(todos) {
  const list = Array.isArray(todos) ? todos : []
  const indexById = new Map()
  for (let i = 0; i < list.length; i += 1) {
    const id = list[i].id
    if (typeof id === "string" && id !== "" && !indexById.has(id)) indexById.set(id, i)
  }

  const keep = new Set()
  for (let i = 0; i < list.length; i += 1) if (!isFinished(list[i])) keep.add(i)

  // Walk each kept task up its parent chain, adding ancestors until one is kept.
  const addAncestors = (index) => {
    let parentId = list[index].parentId
    while (typeof parentId === "string" && parentId !== "" && indexById.has(parentId)) {
      const parent = indexById.get(parentId)
      if (keep.has(parent)) break
      keep.add(parent)
      parentId = list[parent].parentId
    }
  }
  for (const index of [...keep]) addAncestors(index)

  return list.filter((_, index) => keep.has(index))
}

/** How many tasks are finished (completed or cancelled). */
export function finishedCount(todos) {
  return (Array.isArray(todos) ? todos : []).filter(isFinished).length
}
