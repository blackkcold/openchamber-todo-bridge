// Checks the board's session-archive helpers (`src/archive.js`).
//
// The board keeps which sessions the reader has set aside in `host.storage`,
// separate from the plugin's mirrors. These pure helpers decide what is
// archived, what a bulk run picks up, and how a stored value degrades when it is
// missing, partial, or written by an older version.
import {
  emptyArchive,
  parseArchive,
  isArchived,
  partition,
  isFullyFinished,
  finishedSessionIDs,
  withArchived,
  withoutArchived,
} from "../src/archive.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
}

const meta = (sessionID, updatedAt, extra = {}) => ({ sessionID, updatedAt, ...extra })
const ids = (list) => list.map((m) => m.sessionID).join(",")

console.log("\nparseArchive — the stored value")
check("an empty archive is versioned and empty", emptyArchive().version === 1 && Object.keys(emptyArchive().sessions).length === 0)
check("a missing value becomes the empty archive", Object.keys(parseArchive(undefined).sessions).length === 0)
check("a non-object becomes the empty archive", Object.keys(parseArchive("nope").sessions).length === 0)
check("an array becomes the empty archive", Object.keys(parseArchive([]).sessions).length === 0)
check("a sessions-less object becomes empty", Object.keys(parseArchive({ version: 1 }).sessions).length === 0)
check("a valid stamp is kept", parseArchive({ sessions: { a: 5 } }).sessions.a === 5)
check("a non-numeric stamp is dropped", parseArchive({ sessions: { a: "5" } }).sessions.a === undefined)
check("an empty id is dropped", Object.keys(parseArchive({ sessions: { "": 1 } }).sessions).length === 0)
check("the version is re-stamped", parseArchive({ version: 99, sessions: {} }).version === 1)

console.log("\nisArchived — resurface on new activity")
check("no entry is not archived", isArchived(emptyArchive(), meta("a", 100)) === false)
check("a stamp after the update is archived", isArchived({ version: 1, sessions: { a: 200 } }, meta("a", 100)) === true)
check("a stamp equal to the update is archived", isArchived({ version: 1, sessions: { a: 100 } }, meta("a", 100)) === true)
check("an update after the stamp resurfaces it", isArchived({ version: 1, sessions: { a: 100 } }, meta("a", 150)) === false)
check("another session's stamp does not leak", isArchived({ version: 1, sessions: { a: 999 } }, meta("b", 1)) === false)
check("a missing meta is not archived", isArchived({ version: 1, sessions: { a: 1 } }, null) === false)

console.log("\npartition — active vs set aside, order preserved")
{
  const entry = { version: 1, sessions: { b: 500 } }
  const metas = [meta("a", 10), meta("b", 10), meta("c", 10)]
  const split = partition(metas, entry)
  check("the stamped session moves out, order kept", ids(split.active) === "a,c" && ids(split.archived) === "b")
  const kept = partition(metas, entry, "b")
  check("the session in view is never moved out", ids(kept.active) === "a,b,c" && kept.archived.length === 0)
  check("an empty entry keeps everything active", partition(metas, emptyArchive()).archived.length === 0)
}

console.log("\nisFullyFinished — from the index summary alone")
check("all done is finished", isFullyFinished({ sessionID: "a", total: 3, done: 3, doing: 0, pending: 0 }) === true)
check("an in-progress task is not", isFullyFinished({ sessionID: "a", total: 3, done: 2, doing: 1, pending: 0 }) === false)
check("a pending task is not", isFullyFinished({ sessionID: "a", total: 3, done: 2, doing: 0, pending: 1 }) === false)
check("an empty session is not finished", isFullyFinished({ sessionID: "a", total: 0, done: 0, doing: 0, pending: 0 }) === false)
check("a summary-less entry is not finished", isFullyFinished({ sessionID: "a", updatedAt: 1 }) === false)

console.log("\nfinishedSessionIDs — the bulk run")
{
  const entry = { version: 1, sessions: { done: 999 } }
  const metas = [
    meta("open", 10, { total: 2, done: 1, doing: 1, pending: 0 }),
    meta("done", 10, { total: 2, done: 2, doing: 0, pending: 0 }),
    meta("fresh", 10, { total: 1, done: 0, doing: 0, pending: 1 }),
  ]
  check("an already-archived finished session is skipped", finishedSessionIDs(metas, entry).join(",") === "")
  check("a finished, unarchived session is picked up", finishedSessionIDs(metas, emptyArchive()).join(",") === "done")
  check("the session in view is skipped", finishedSessionIDs(metas, emptyArchive(), "done").join(",") === "")
}

console.log("\nwithArchived / withoutArchived — pure edits")
{
  const before = { version: 1, sessions: { a: 1 } }
  const after = withArchived(before, ["b"], 42)
  check("withArchived stamps the id and keeps the old", after.sessions.a === 1 && after.sessions.b === 42)
  check("withArchived does not mutate its input", before.sessions.b === undefined)
  const undone = withoutArchived(after, ["a", "b"])
  check("withoutArchived removes both", Object.keys(undone.sessions).length === 0)
  check("withoutArchived does not mutate its input", Object.keys(after.sessions).length === 2)
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall checks passed")
