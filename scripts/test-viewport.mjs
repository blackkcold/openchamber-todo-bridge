// Checks the height/scroll geometry in `src/viewport.js`.
//
// Run under Node: the module is pure arithmetic with no DOM and no SDK, which
// is the point — the section's height has to be decided from the rendered rows
// (see the note in `src/viewport.js`), and only the arithmetic around that
// measurement can be pinned down here.
import {
  clamp,
  clampScroll,
  MAX_H,
  MIN_H,
  nearestIndex,
} from "../src/viewport.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
}
const eq = (name, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  check(`${name} -> ${a}`, a === b)
  if (a !== b) console.log(`        expected ${b}`)
}

console.log("\nbounds — the host's own limits")
check(`MIN_H is ${MIN_H}`, MIN_H === 24)
check(`MAX_H is ${MAX_H}`, MAX_H === 320)

console.log("\nclamp — whole pixels inside the range")
eq("rounds to nearest", clamp(56.4, MIN_H, MAX_H), 56)
eq("rounds a .5 up", clamp(56.5, MIN_H, MAX_H), 57)
eq("raises to the floor", clamp(23.6, MIN_H, MAX_H), 24)
eq("drops past the ceiling", clamp(400, MIN_H, MAX_H), 320)
eq("keeps a value in range", clamp(123, MIN_H, MAX_H), 123)
eq("a non-finite value falls to the floor", clamp(NaN, MIN_H, MAX_H), 24)
eq("a missing value falls to the floor", clamp(undefined, MIN_H, MAX_H), 24)

console.log("\nclampScroll — a position inside [0, max]")
eq("negative snaps to the top", clampScroll(-40, 500), 0)
eq("past the end snaps to the bottom", clampScroll(900, 500), 500)
eq("inside keeps its value", clampScroll(120, 500), 120)
eq("a fractional position rounds", clampScroll(119.6, 500), 120)
eq("no scrollable range pins to the top", clampScroll(80, 0), 0)
eq("a negative range pins to the top", clampScroll(80, -10), 0)

console.log("\nnearestIndex — the row start closest to a scroll offset")
eq("exact hit", nearestIndex(100, [0, 100, 200]), 1)
eq("between two picks the nearer", nearestIndex(149, [0, 100, 200]), 1)
eq("a tie picks the earlier row", nearestIndex(150, [0, 100, 200]), 1)
eq("below the first picks the first", nearestIndex(-20, [0, 100, 200]), 0)
eq("past the last picks the last", nearestIndex(900, [0, 100, 200]), 2)
eq("one start is always the answer", nearestIndex(50, [0]), 0)
eq("an empty list falls back to zero", nearestIndex(50, []), 0)

console.log("\nnearestIndex — row starts are assumed ascending")
eq("a two-row panel", nearestIndex(23, [0, 23]), 1)
eq("the first row when near the top", nearestIndex(4, [0, 23]), 0)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
