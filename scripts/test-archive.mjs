// Checks the board's session-archive helpers (`src/archive.js`).
//
// The board keeps which sessions the reader has set aside in `host.storage`,
// separate from the plugin's mirrors. These pure helpers decide what is
// archived, what a bulk run picks up, and how a stored value degrades when it is
// missing, partial, or written by an older version.
import {
  MAX_DAYS,
  archiveCandidates,
  clampDays,
  emptyArchive,
  emptyPrefs,
  parseArchive,
  parsePrefs,
  isArchived,
  partition,
  isFullyFinished,
  autoArchiveIDs,
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

console.log("\narchiveCandidates.manual — the bulk run")
{
  const entry = { version: 1, sessions: { done: 999 } }
  const metas = [
    meta("open", 10, { total: 2, done: 1, doing: 1, pending: 0 }),
    meta("done", 10, { total: 2, done: 2, doing: 0, pending: 0 }),
    meta("fresh", 10, { total: 1, done: 0, doing: 0, pending: 1 }),
  ]
  const manual = (entry, keep = []) =>
    archiveCandidates(metas, entry, { keep, now: 10, days: 0 }).manual.map((item) => item.sessionID).join(",")
  check("an already-archived finished session is skipped", manual(entry) === "")
  check("a finished, unarchived session is picked up", manual(emptyArchive()) === "done")
  check("the session in view is skipped", manual(emptyArchive(), ["done"]) === "")
}

console.log("\nparsePrefs — the auto-archive preference")
check("the default is auto on", emptyPrefs().auto === true)
check("the default age gate is a week", emptyPrefs().days === 7)
check("the prefs version moved to 2", emptyPrefs().version === 2)
check("a missing value defaults to auto on", parsePrefs(undefined).auto === true)
check("garbage defaults to auto on", parsePrefs("nope").auto === true)
check("an array defaults to auto on", parsePrefs([]).auto === true)
check("an explicit false is kept", parsePrefs({ version: 1, auto: false }).auto === false)
check("an explicit true is kept", parsePrefs({ auto: true }).auto === true)
check("a non-boolean auto defaults to on", parsePrefs({ auto: "no" }).auto === true)
check("a v1 document migrates to no age gate", parsePrefs({ version: 1, auto: true }).days === 0)
check("a v2 days value is kept", parsePrefs({ version: 2, auto: true, days: 3 }).days === 3)
check("a negative days value clamps to 0", parsePrefs({ version: 2, days: -4 }).days === 0)
check("a huge days value clamps to the cap", parsePrefs({ version: 2, days: 9999 }).days === MAX_DAYS)
check("a fractional days value floors", parsePrefs({ version: 2, days: 2.9 }).days === 2)
check("a non-numeric days falls back to a week", parsePrefs({ version: 2, days: "3" }).days === 7)
check("clampDays keeps the fallback for garbage", clampDays(undefined, 0) === 0)

console.log("\nautoArchiveIDs — the silent sweep")
{
  const finished = (id, updatedAt = 10) => meta(id, updatedAt, { total: 2, done: 2, doing: 0, pending: 0 })
  const open = (id, updatedAt = 10) => meta(id, updatedAt, { total: 2, done: 1, doing: 1, pending: 0 })
  const metas = [open("a"), finished("b"), finished("c"), finished("d")]
  const sweep = (entry, opts) => autoArchiveIDs(metas, entry, { now: 100, readOk: true, ...opts }).join(",")
  check("only finished, unarchived sessions are picked, in order", sweep(emptyArchive()) === "b,c,d")
  check("an already-archived session is skipped", sweep({ version: 1, sessions: { c: 999 } }) === "b,d")
  check("a kept session is skipped", sweep(emptyArchive(), { keep: ["b", "current"] }) === "c,d")
  check("readOk false skips the whole sweep", autoArchiveIDs(metas, emptyArchive(), { now: 100, readOk: false }).length === 0)
  check("a held session is skipped until it moves", sweep(emptyArchive(), { hold: { b: 50 } }) === "c,d")
  check("a hold older than the update no longer holds", sweep(emptyArchive(), { hold: { b: 5 } }) === "b,c,d")
  check("a session updated after now is skipped (clock)", autoArchiveIDs([finished("e", 200)], emptyArchive(), { now: 100, readOk: true }).length === 0)
  check("a summary-less session is skipped", autoArchiveIDs([meta("f", 10)], emptyArchive(), { now: 100, readOk: true }).length === 0)
  const before = emptyArchive()
  autoArchiveIDs(metas, before, { now: 100, readOk: true })
  check("the sweep does not mutate its inputs", Object.keys(before.sessions).length === 0)
}

console.log("\narchiveCandidates — the three lists the board shows")
{
  const DAY = 86400000
  const now = 10 * DAY
  const finished = (id, daysAgo, extra = {}) =>
    meta(id, now - daysAgo * DAY, { total: 2, done: 2, doing: 0, pending: 0, ...extra })
  const open = (id, daysAgo, extra = {}) =>
    meta(id, now - daysAgo * DAY, { total: 2, done: 1, doing: 1, pending: 0, ...extra })
  const metas = [finished("old-fin", 9), finished("new-fin", 2), open("old-open", 30), open("new-open", 1)]
  const run = (opts = {}) => archiveCandidates(metas, emptyArchive(), { now, days: 7, ...opts })
  const names = (list) => list.map((item) => item.sessionID).join(",")

  check("a finished session past the threshold is a candidate", names(run().finished) === "old-fin")
  check("a finished session inside the threshold is not", !names(run().finished).includes("new-fin"))
  check("an open session past the threshold is only stale", names(run().stale) === "old-open")
  check("an open session inside the threshold is not listed", !names(run().stale).includes("new-open"))
  check("the two lists never overlap", run().finished.every((item) => !names(run().stale).includes(item.sessionID)))
  check("the age is reported in whole days", run().finished[0].ageDays === 9)
  check("the threshold is inclusive at exactly N days", names(archiveCandidates([finished("edge", 7)], emptyArchive(), { now, days: 7 }).finished) === "edge")
  check("one day under the threshold is out", archiveCandidates([finished("edge", 7)], emptyArchive(), { now, days: 8 }).finished.length === 0)
  check("days 0 keeps every finished session (v1 behaviour)", archiveCandidates([finished("fresh", 0)], emptyArchive(), { now, days: 0 }).finished.length === 1)
  check("a blocked session is never suggested", archiveCandidates([finished("blk", 30, { blocked: 2 })], emptyArchive(), { now, days: 7 }).finished.length === 0)
  check("a blocked open session is never suggested", archiveCandidates([open("blk2", 30, { blocked: 1 })], emptyArchive(), { now, days: 7 }).stale.length === 0)
  check("a held session is skipped", run({ hold: { "old-fin": now - DAY } }).finished.length === 0)
  check("a kept session is skipped", run({ keep: ["old-fin", "old-open"] }).finished.length === 0 && run({ keep: ["old-fin", "old-open"] }).stale.length === 0)
  check("an already-archived session is skipped", archiveCandidates(metas, { version: 1, sessions: { "old-fin": now } }, { now, days: 7 }).finished.length === 0)
  check("a future stamp is skipped", archiveCandidates([finished("future", -1)], emptyArchive(), { now, days: 7 }).finished.length === 0)
  check("a candidate list is never built without a threshold default", archiveCandidates([finished("x", 3)], emptyArchive(), { now }).finished.length === 1)
  check("manual includes every finished session, inside or outside the threshold", names(run().manual) === "old-fin,new-fin")
  check("manual excludes sessions with open work", !names(run().manual).includes("old-open") && !names(run().manual).includes("new-open"))
  check("manual includes a blocked finished session", names(archiveCandidates([finished("blk", 30, { blocked: 2 })], emptyArchive(), { now, days: 7 }).manual) === "blk")
  check("manual is unaffected by the age threshold", names(run({ days: 365 }).manual) === "old-fin,new-fin")
  check("manual skips a held session", !names(run({ hold: { "old-fin": now - DAY } }).manual).includes("old-fin"))
  check("manual skips kept sessions", names(run({ keep: ["old-fin", "new-fin"] }).manual) === "")
  check("manual skips an already-archived session", names(archiveCandidates(metas, { version: 1, sessions: { "old-fin": now } }, { now, days: 7 }).manual) === "new-fin")
  check("manual skips a future stamp", archiveCandidates([finished("future", -1)], emptyArchive(), { now, days: 7 }).manual.length === 0)
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
