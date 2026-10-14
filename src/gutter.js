/**
 * The tree gutter: the inline SVG one structured row draws to its left — the
 * elbow from the parent's column down to this node, the vertical trunks of any
 * ancestor that still has a following sibling, and the node's own status
 * symbol. Shared by the Work Status section, the rail panel, and the task
 * board, so the same picture appears in all three.
 *
 * The symbol's colour is the phase (so each stage reads at a glance) and its
 * shape is the status. Pure string building; no DOM, no SDK.
 */
import { INDENT, phaseColor } from "./graph.js"

/** Width of the node-symbol box in a tree row's gutter, and the symbol's y. */
export const GUT_NODE = 11
export const NODE_Y = 11

/**
 * The gutter's CSS, injected by each page so the three surfaces share one copy
 * instead of three drifting ones. A row is as tall as its text, so the gutter
 * stretches and the SVG is absolutely sized to it: the long verticals use
 * `100%`, which only resolves against a definite height.
 */
export const GUT_CSS = `
.gut { flex: 0 0 auto; align-self: stretch; position: relative; min-height: 18px; }
.gut-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.gut-svg line { stroke: var(--oc-muted, #6f6e69); stroke-width: 1.4; opacity: .5; }
.gut-halo { transform-box: fill-box; transform-origin: center; animation: todo-gut-halo 2200ms ease-in-out infinite; }
@keyframes todo-gut-halo {
  0%, 100% { transform: scale(1); opacity: .85; }
  50% { transform: scale(1.55); opacity: .28; }
}
@media (prefers-reduced-motion: reduce) { .gut-halo { animation: none; } }
`

/** Inject the shared gutter CSS once into a document. */
export function ensureGutStyle(doc) {
  if (doc.getElementById("gut-style")) return
  const style = doc.createElement("style")
  style.id = "gut-style"
  style.textContent = GUT_CSS
  doc.head.append(style)
}

/** The status symbol, centred at (x, y), coloured by phase. */
export function symbolSvg(status, x, y, color) {
  const r = 4
  if (status === "completed") {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>` +
      `<path class="gut-tick" d="M${x - 2.1} ${y + 0.1} L${x - 0.5} ${y + 1.7} L${x + 2.3} ${y - 1.7}"` +
      ` fill="none" stroke="var(--oc-bg, #fff)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (status === "cancelled") {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="2 2" opacity=".7"/>` +
      `<line x1="${x - 2.2}" y1="${y - 2.2}" x2="${x + 2.2}" y2="${y + 2.2}" stroke="${color}" stroke-width="1.4" opacity=".7"/>`
  }
  if (status === "in_progress") {
    return `<circle class="gut-halo" cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6"/>` +
      `<circle cx="${x}" cy="${y}" r="${r - 1.4}" fill="${color}"/>`
  }
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6"/>`
}

/**
 * The whole gutter SVG for one row. A row is as tall as its text, so the SVG is
 * absolutely sized to the gutter and the long verticals use `100%`; the CSS
 * that does that lives beside each page.
 */
export function gutterSvg(tree, status) {
  const d = tree.depth
  const cx = (lane) => lane * INDENT + GUT_NODE / 2
  const color = phaseColor(tree.colorIndex)
  const last = tree.isLast
  let body = ""
  for (let lane = 0; lane < d; lane += 1) {
    const x = cx(lane)
    if (lane === d - 1) {
      // The branch down to this node; it continues past unless this is the last child.
      body += `<line x1="${x}" y1="0" x2="${x}" y2="${last ? NODE_Y : "100%"}" stroke="${color}" opacity=".8"/>`
      body += `<line x1="${x}" y1="${NODE_Y}" x2="${cx(d)}" y2="${NODE_Y}" stroke="${color}" opacity=".8"/>`
    } else if (tree.ancestorLast[lane + 1] === false) {
      // An ancestor above still has a following sibling: its trunk passes through.
      body += `<line x1="${x}" y1="0" x2="${x}" y2="100%"/>`
    }
  }
  if (tree.synthetic) {
    // A phase group: a small square, not a status symbol.
    body += `<rect x="${cx(d) - 3.5}" y="${NODE_Y - 3.5}" width="7" height="7" rx="2" fill="${color}"/>`
  } else {
    body += symbolSvg(status, cx(d), NODE_Y, color)
    if (tree.blocked) {
      // A dashed ring around the node: a dependency that exists and is not done.
      body +=
        `<circle cx="${cx(d)}" cy="${NODE_Y}" r="6.6" fill="none" stroke="var(--oc-error, #af3029)"` +
        ` stroke-width="1.3" stroke-dasharray="2 2"><title>受阻：依赖未完成</title></circle>`
    }
  }
  return `<svg class="gut-svg" aria-hidden="true">${body}</svg>`
}
