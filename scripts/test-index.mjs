// Checks the board's index parser (`src/doc.js#parseIndex`).
//
// The board reads `_index.json` — the session list the plugin writes — as its
// only data source for the summary bar, the session labels and every card
// header. It must survive a v1 index (no summary) and a partial entry, so a
// half-written or older index degrades instead of blanking the page.
import { parseIndex } from "../src/doc.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
}

console.log("\nparseIndex — the session index")
check("malformed JSON is null", parseIndex("{not json") === null)
check("a missing sessions array yields []", Array.isArray(parseIndex("{}")) && parseIndex("{}").length === 0)

const v1 = parseIndex(JSON.stringify({ version: 1, sessions: [{ sessionID: "s1", updatedAt: 5 }] }))
check("a v1 entry keeps sessionID/updatedAt", v1.length === 1 && v1[0].sessionID === "s1" && v1[0].updatedAt === 5)
check("a v1 entry has no summary", v1[0].total === undefined)

const v2 = parseIndex(JSON.stringify({
  version: 2,
  sessions: [
    { sessionID: "s1", updatedAt: 9, title: "改构建", total: 3, done: 1, doing: 1, pending: 1, cancelled: 0, blocked: 1, byPhase: { "实现": 3 }, phases: ["实现"] },
    { sessionID: "  ", updatedAt: 1 },
    null,
    { sessionID: "s2", updatedAt: "x", total: 2 },
  ],
}))
check("keeps the titled entry", v2.length === 2 && v2[0].title === "改构建" && v2[0].total === 3)
check("keeps the counts", v2[0].doing === 1 && v2[0].blocked === 1 && v2[0].cancelled === 0)
check("keeps byPhase", v2[0].byPhase["实现"] === 3)
check("keeps phases", Array.isArray(v2[0].phases) && v2[0].phases[0] === "实现")
check("drops an empty sessionID and a null entry", v2.every((entry) => entry.sessionID.trim() !== "") && v2.length === 2)
check("a non-numeric updatedAt becomes 0", v2[1].updatedAt === 0)
check("absent counts default to 0", v2[1].done === 0 && v2[1].blocked === 0 && v2[1].total === 2)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
