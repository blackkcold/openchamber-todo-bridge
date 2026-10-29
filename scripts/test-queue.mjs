// Checks the board's work-queue helpers (`src/queue.js`).
//
// The default board view is a queue, not a recency archive: sessions with open
// work first, blocked before in-progress before pending, and a filter that
// renders matches plus their ancestors instead of dimming everything else.
// These cases pin that behaviour under Node, with no DOM.
import { filterList, hasOpenWork, inScope, isBlocked, matchIndices, relativeTime, scopeMetas } from "../src/queue.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
}

const meta = (sessionID, updatedAt, extra = {}) => ({ sessionID, updatedAt, ...extra })
const summary = (sessionID, updatedAt, extra = {}) => meta(sessionID, updatedAt, { total: 3, done: 0, doing: 0, pending: 3, cancelled: 0, blocked: 0, ...extra })
const ids = (list) => list.map((m) => m.sessionID).join(",")
const todo = (content, extra = {}) => ({ content, status: "pending", ...extra })

console.log("\nhasOpenWork — from the summary, never a guess")
check("pending work is open", hasOpenWork(summary("a", 1)) === true)
check("in-progress work is open", hasOpenWork(summary("a", 1, { doing: 1, pending: 0 })) === true)
check("a fully finished summary is not open", hasOpenWork(summary("a", 1, { done: 3, pending: 0 })) === false)
check("cancelled counts as finished, not open", hasOpenWork(summary("a", 1, { cancelled: 3, pending: 0 })) === false)
check("an empty summary is not open", hasOpenWork(summary("a", 1, { total: 0, pending: 0 })) === false)
check("an index without a summary stays visible", hasOpenWork(meta("a", 1)) === true)
check("a missing meta is not open", hasOpenWork(null) === false)

console.log("\ninScope — which sessions the scope keeps")
check("open keeps only sessions with open work", inScope(summary("a", 1), "open") === true && inScope(summary("a", 1, { done: 3, pending: 0 }), "open") === false)
check("done keeps only fully finished sessions", inScope(summary("a", 1, { done: 3, pending: 0 }), "done") === true)
check("done never guesses on an index without a summary", inScope(meta("a", 1), "done") === false)
check("all keeps both", inScope(summary("a", 1), "all") === true && inScope(summary("a", 1, { done: 3, pending: 0 }), "all") === true)

console.log("\nscopeMetas — blocked, then in progress, then the rest")
{
  const metas = [
    meta("finished", 900, { total: 2, done: 2, pending: 0 }),
    summary("pending-new", 500),
    summary("blocked-old", 100, { blocked: 2 }),
    summary("doing-new", 800, { doing: 1, pending: 2 }),
    summary("blocked-new", 700, { blocked: 1 }),
  ]
  check("open drops finished and orders by urgency", ids(scopeMetas(metas, "open")) === "blocked-new,blocked-old,doing-new,pending-new")
  check("all keeps the index order", ids(scopeMetas(metas, "all")) === "finished,pending-new,blocked-old,doing-new,blocked-new")
  check("done keeps only finished, in index order", ids(scopeMetas(metas, "done")) === "finished")
  check("a finished session with open work is not done", inScope(summary("a", 1, { done: 1, pending: 1 }), "done") === false)
}

console.log("\nmatchIndices — matches plus their ancestors")
{
  const todos = [
    todo("root", { id: "r" }),
    todo("middle", { id: "m", parentId: "r" }),
    todo("leaf target", { id: "l", parentId: "m" }),
    todo("unrelated", { id: "u" }),
  ]
  const { keep, count } = matchIndices(todos, (t) => t.content === "leaf target")
  check("the leaf and both ancestors are kept", [0, 1, 2].every((i) => keep.has(i)))
  check("the unrelated row is dropped", keep.has(3) === false)
  check("only the leaf counts as a match", count === 1)
}
{
  const todos = [todo("a", { id: "a", parentId: "b" }), todo("b", { id: "b", parentId: "a" }), todo("c", { id: "c" })]
  const { keep, count } = matchIndices(todos, (t) => t.content === "a")
  check("a parent cycle does not hang", count === 1 && keep.size === 2)
}
{
  const todos = [todo("orphan", { parentId: "missing" }), todo("plain")]
  const { keep, count } = matchIndices(todos, (t) => t.content === "orphan")
  check("a missing parent keeps the match alone", count === 1 && keep.size === 1)
}

console.log("\nfilterList — the rows to render")
{
  const todos = [todo("parent", { id: "p" }), todo("child", { id: "c", parentId: "p" }), todo("other", { id: "o" })]
  const { todos: kept, count } = filterList(todos, (t) => t.content === "child")
  check("order follows the original list", kept.map((t) => t.content).join(",") === "parent,child")
  check("the count is matches, not rows", count === 1)
  check("no match renders nothing", filterList(todos, () => false).todos.length === 0)
}

console.log("\nisBlocked — against the whole session")
{
  const statusById = new Map([["a", "completed"], ["b", "in_progress"], ["c", "pending"]])
  check("an open task on an unfinished dependency is blocked", isBlocked({ status: "pending", dependsOn: ["b"] }, statusById) === true)
  check("a completed dependency does not block", isBlocked({ status: "pending", dependsOn: ["a"] }, statusById) === false)
  check("one unfinished dependency is enough", isBlocked({ status: "in_progress", dependsOn: ["a", "c"] }, statusById) === true)
  check("an unknown dependency is ignored", isBlocked({ status: "pending", dependsOn: ["nope"] }, statusById) === false)
  check("a completed task is never blocked", isBlocked({ status: "completed", dependsOn: ["b"] }, statusById) === false)
  check("no dependency list is not blocked", isBlocked({ status: "pending" }, statusById) === false)
}

console.log("\nrelativeTime — card age")
{
  const now = Date.UTC(2026, 0, 1)
  check("under a minute is just now", relativeTime(now - 30000, now) === "刚刚")
  check("minutes", relativeTime(now - 5 * 60000, now) === "5 分钟前")
  check("hours", relativeTime(now - 3 * 3600000, now) === "3 小时前")
  check("days", relativeTime(now - 2 * 86400000, now) === "2 天前")
  check("months", relativeTime(now - 65 * 86400000, now) === "2 个月前")
  check("years", relativeTime(now - 400 * 86400000, now) === "1 年前")
  check("a future stamp reads as just now", relativeTime(now + 5000, now) === "刚刚")
  check("a missing stamp is empty", relativeTime(undefined, now) === "")
  check("a zero stamp is empty", relativeTime(0, now) === "")
}

if (failed > 0) {
  console.error(`\n${failed} queue check(s) failed`)
  process.exit(1)
}
console.log("\nall queue checks passed")
