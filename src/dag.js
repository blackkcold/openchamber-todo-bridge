/**
 * Phase-swimlane graph layout for the task board.
 *
 * Pure: no DOM, no SDK. `src/board.js` owns the elements; this module owns the
 * shape, and `scripts/test-dag.mjs` exercises it under Node.
 *
 * Two axes:
 *   - columns are dependency depth. `rank(n)` is 0 with no predecessor, else
 *     `max(rank(pred)) + 1`, where a predecessor is the parent or a resolved
 *     `dependsOn` target.
 *   - rows are phase swimlanes. The lane order follows the declared `phases`,
 *     with a trailing "ungrouped" lane for tasks that name no phase.
 *
 * Tolerant like the tree: an unknown dependency, a self edge, or a cycle is
 * dropped rather than hanging. A node the topological pass never reaches (it is
 * on a cycle) keeps rank 0.
 *
 * `blocked` means the node depends on a task that exists and is not completed —
 * a visual hint only; it does not change the node's own status.
 */
import { phaseColorIndex, phaseList } from "./graph.js"

export const DAG_COL = 150
export const DAG_ROW = 42
export const DAG_PAD = 26

const UNGROUPED = "未分组"

export function dagLayout(todos, declared = []) {
  const list = Array.isArray(todos) ? todos : []
  const phases = phaseList(declared, list)
  const hasUngrouped = list.some((todo) => !(typeof todo.phase === "string" && todo.phase !== ""))
  const laneNames = hasUngrouped ? [...phases, UNGROUPED] : [...phases]
  if (laneNames.length === 0) laneNames.push(UNGROUPED)
  const laneIndexOf = new Map(laneNames.map((name, index) => [name, index]))

  // Stable keys, the same scheme the tree uses.
  const taken = new Set()
  const nodes = list.map((todo, index) => {
    const id = typeof todo.id === "string" ? todo.id : ""
    let key = `#${index}`
    if (id !== "") {
      key = taken.has(id) ? `${id}#${index}` : id
      taken.add(id)
    }
    const phase = typeof todo.phase === "string" && todo.phase !== "" ? todo.phase : UNGROUPED
    return {
      index,
      key,
      content: todo.content,
      status: todo.status,
      phase,
      colorIndex: phase === UNGROUPED ? -1 : phaseColorIndex(todo.phase, phases),
      lane: laneIndexOf.has(phase) ? laneIndexOf.get(phase) : laneNames.length - 1,
      rank: 0,
      slot: 0,
      x: 0,
      y: 0,
      blocked: false,
    }
  })

  // id -> first index carrying it; a later duplicate is not a target.
  const idToIndex = new Map()
  for (const node of nodes) {
    const id = list[node.index].id
    if (typeof id === "string" && id !== "" && !idToIndex.has(id)) idToIndex.set(id, node.index)
  }
  const statusByIndex = nodes.map((node) => node.status)

  const predSet = nodes.map(() => new Set())
  const succSet = nodes.map(() => new Set())
  const edges = []
  const link = (from, to, kind) => {
    if (from === undefined || to === undefined || from === to) return
    edges.push({ from, to, kind })
    predSet[to].add(from)
    succSet[from].add(to)
  }
  for (const node of nodes) {
    const todo = list[node.index]
    if (typeof todo.parentId === "string" && todo.parentId !== "") {
      const parent = idToIndex.get(todo.parentId)
      if (parent !== undefined) link(parent, node.index, "parent")
    }
    if (Array.isArray(todo.dependsOn)) {
      for (const dep of todo.dependsOn) {
        const target = idToIndex.get(dep)
        if (target !== undefined) link(target, node.index, "depends")
      }
      node.blocked = todo.dependsOn.some((dep) => {
        const target = idToIndex.get(dep)
        return target !== undefined && statusByIndex[target] !== "completed"
      })
    }
  }

  // Columns: longest path from a root, by Kahn's algorithm. Nodes left over
  // (they sit on a cycle) keep rank 0.
  const indeg = predSet.map((set) => set.size)
  const queue = []
  for (let i = 0; i < nodes.length; i += 1) if (indeg[i] === 0) queue.push(i)
  for (let head = 0; head < queue.length; head += 1) {
    const u = queue[head]
    for (const v of succSet[u]) {
      if (nodes[u].rank + 1 > nodes[v].rank) nodes[v].rank = nodes[u].rank + 1
      indeg[v] -= 1
      if (indeg[v] === 0) queue.push(v)
    }
  }

  // Within a lane, several nodes can share a column: stack them.
  const cellCount = new Map()
  for (const node of nodes) {
    const cell = `${node.lane}:${node.rank}`
    node.slot = cellCount.get(cell) || 0
    cellCount.set(cell, node.slot + 1)
  }
  const laneSlots = laneNames.map(() => 1)
  for (const node of nodes) {
    const used = cellCount.get(`${node.lane}:${node.rank}`)
    if (used > laneSlots[node.lane]) laneSlots[node.lane] = used
  }

  const laneTop = []
  let cursor = DAG_PAD
  for (let i = 0; i < laneNames.length; i += 1) {
    laneTop.push(cursor)
    cursor += laneSlots[i] * DAG_ROW + DAG_PAD
  }

  const lanes = laneNames.map((name, index) => ({
    name,
    index,
    y: laneTop[index],
    height: laneSlots[index] * DAG_ROW + DAG_PAD,
    colorIndex: name === UNGROUPED ? -1 : phaseColorIndex(name, phases),
  }))

  for (const node of nodes) {
    node.x = DAG_PAD + node.rank * DAG_COL + DAG_COL / 2
    node.y = laneTop[node.lane] + DAG_PAD / 2 + node.slot * DAG_ROW + DAG_ROW / 2
  }

  const columns = nodes.reduce((max, node) => Math.max(max, node.rank + 1), 1)
  const width = DAG_PAD + columns * DAG_COL
  const height = laneTop[laneNames.length - 1] + laneSlots[laneNames.length - 1] * DAG_ROW + DAG_PAD

  return { nodes, edges, lanes, width, height, colWidth: DAG_COL, rowHeight: DAG_ROW }
}
