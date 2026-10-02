/**
 * Height and scroll geometry for the Todos section.
 *
 * Pure arithmetic: no DOM, no SDK, no host. `src/main.js` owns the elements and
 * the wiring; this module owns the numbers, and `scripts/test-viewport.mjs`
 * exercises it under Node.
 *
 * The section reports the height it wants with `host.setHeight`. That height is
 * *measured* from the rows the panel is about to show rather than estimated from
 * `rowCount x rowHeight`: a row is only approximately the same height as the
 * next (the finished-group row is a control rather than a line of text, and a
 * long task name wraps), so an estimate would clip the last row. The measurement
 * cannot feed back on itself because the frame height is decided from the rows
 * *before* they are laid out against it — and the list scrolls rather than being
 * cut to fit, so a height that is a few pixels short hides part of a row behind
 * a scrollbar instead of dropping it.
 *
 * `MIN_H`/`MAX_H` are the host's own bounds (`clampFrameHeight` on the guest
 * side, and the same 24/320 the status section is rendered with in OpenChamber).
 */
export const MIN_H = 24
export const MAX_H = 320

/** Whole pixels, inside the host's range. A non-finite value falls to the floor. */
export const clamp = (value, lo, hi) => {
  const n = Number.isFinite(value) ? Math.round(value) : lo
  return Math.min(hi, Math.max(lo, n))
}

/** A scroll position, whole pixels, inside `[0, max]`. */
export const clampScroll = (value, max) => {
  const top = Math.max(0, Number.isFinite(max) ? Math.floor(max) : 0)
  const n = Number.isFinite(value) ? Math.round(value) : 0
  return Math.min(top, Math.max(0, n))
}

/**
 * The index of the row start closest to `offset`.
 *
 * Used to snap a rested scroll to a row boundary. A tie resolves to the earlier
 * row, and an empty list falls back to 0 — the caller's `clampScroll` then pins
 * an empty or single-row panel to the top.
 */
export function nearestIndex(offset, starts) {
  if (!Array.isArray(starts) || starts.length === 0) return 0
  const value = Number.isFinite(offset) ? offset : 0
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < starts.length; i += 1) {
    const dist = Math.abs(starts[i] - value)
    // `<` rather than `<=`: a tie keeps the earlier row.
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}
