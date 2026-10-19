#!/usr/bin/env node
/**
 * Read-only provider-cache audit for the OpenCode SQLite database.
 *
 * The deterministic cache guard (`scripts/test-cache.mjs`) proves that the
 * request prefix does not move and that the reminder is deterministic. It cannot
 * prove that a provider actually reused cached tokens. This script reads the
 * local OpenCode usage data and reports, per session and per turn:
 *
 *   input, cache read, cache write, output, cost, and the cache-read share.
 *
 * It also flags the two failure modes that matter for this plugin:
 *   - a reminder persisted as a user turn (history growth), and
 *   - a session whose stored todo list is large enough to make the tail reminder
 *     expensive (the current reminder size is printed for context).
 *
 * Nothing is written. The database is opened read-only.
 *
 * Usage:
 *   node --no-warnings scripts/cache-audit.mjs
 *   node --no-warnings scripts/cache-audit.mjs --limit 10
 *   node --no-warnings scripts/cache-audit.mjs --session ses_...
 *   OPENCODE_DB=/path/to/opencode.db node --no-warnings scripts/cache-audit.mjs
 *
 * `--limit` applies only to the recent-session list. `--session` prints every
 * assistant turn for that session.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { buildReminder } from "../opencode-plugin/index.js"

const argv = process.argv.slice(2)
const arg = (name, fallback = "") => {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}
const has = (name) => argv.includes(name)

const dbPath = arg("--db", process.env.OPENCODE_DB || join(homedir(), ".local/share/opencode/opencode.db"))
const limit = Math.max(1, Number(arg("--limit", "8")) || 8)
const turnLimit = Math.max(1, Number(arg("--turns", "30")) || 30)
const oneSession = arg("--session", "")

if (has("--help") || has("-h")) {
  console.log("Usage: node --no-warnings scripts/cache-audit.mjs [--limit N] [--session ses_...] [--turns N] [--db PATH]")
  process.exit(0)
}

let DatabaseSync
try {
  ({ DatabaseSync } = await import("node:sqlite"))
} catch {
  console.error("node:sqlite is unavailable. Run this with Node 22.5+ or newer.")
  process.exit(1)
}

const num = (value) => (Number.isFinite(value) ? Number(value) : 0)
const pct = (cacheRead, input) => {
  const denominator = input + cacheRead
  return denominator > 0 ? (cacheRead / denominator) * 100 : 0
}
const stamp = (value) => (Number.isFinite(value) ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "?")
const modelOf = (raw) => {
  try {
    const parsed = JSON.parse(raw)
    return `${parsed.providerID || "?"}/${parsed.id || "?"}`
  } catch {
    return typeof raw === "string" && raw !== "" ? raw : "?"
  }
}

function installedVersion() {
  const path = join(homedir(), ".config/opencode/plugins/openchamber-todo-bridge/index.js")
  try {
    const text = readFileSync(path, "utf8")
    const match = /\/\/ openchamber-todo-bridge@([^\n]+)\s*$/.exec(text)
    return match ? match[1].trim() : "unknown"
  } catch {
    return "not installed"
  }
}

let db
try {
  db = new DatabaseSync(dbPath, { readOnly: true })
} catch (error) {
  console.error(`Could not open ${dbPath} read-only: ${error.message}`)
  process.exit(1)
}

const recent = oneSession
  ? [{ sid: oneSession, todo_updated: 0 }]
  : db.prepare(`
      select substr(k.key, instr(k.key, ':todos/') + 7) as sid,
             max(k.time_updated) as todo_updated
      from kv k
      where k.key like 'plugin:%:todos/%'
      group by sid
      order by todo_updated desc
      limit ?
    `).all(limit)

console.log("OpenCode cache audit (read-only)")
console.log(`db: ${dbPath}`)
console.log(`installed plugin: ${installedVersion()}`)
if (recent.length === 0) {
  console.log("\nNo sessions with plugin todo storage were found.")
  db.close()
  process.exit(0)
}

let anyCacheData = false
let withOpen = 0
for (const entry of recent) {
  const sid = entry.sid
  const meta = db.prepare(`
    select id, title, model, cost, tokens_input, tokens_output,
           tokens_cache_read, tokens_cache_write, time_created, time_updated
    from session_v2 where id = ?
  `).get(sid)

  console.log(`\n${sid}`)
  if (!meta) {
    console.log("  session metadata: not found in session_v2")
    continue
  }
  console.log(`  title: ${meta.title || "(empty)"}`)
  console.log(`  model: ${modelOf(meta.model)}   updated: ${stamp(meta.time_updated)}`)
  console.log(
    `  session totals: input ${num(meta.tokens_input)}  cache_read ${num(meta.tokens_cache_read)}  ` +
    `cache_write ${num(meta.tokens_cache_write)}  output ${num(meta.tokens_output)}  cost $${num(meta.cost).toFixed(6)}`,
  )
  console.log(`  cache read share (read / (input + read)): ${pct(num(meta.tokens_cache_read), num(meta.tokens_input)).toFixed(1)}%`)

  const todoRow = db.prepare("select value from kv where key like 'plugin:%:todos/' || ? limit 1").get(sid)
  if (todoRow) {
    try {
      const record = JSON.parse(todoRow.value)
      const todos = Array.isArray(record.todos)
        ? record.todos.filter((todo) => todo && typeof todo.content === "string" && typeof todo.status === "string")
        : []
      const phases = Array.isArray(record.phases)
        ? record.phases.filter((phase) => typeof phase === "string" && phase !== "")
        : []
      const open = todos.filter((todo) => todo && (todo.status === "pending" || todo.status === "in_progress")).length
      if (open > 0) withOpen += 1
      const reminder = open > 0 ? `current reminder ~${buildReminder(todos, phases).length} chars` : "no reminder (no open tasks)"
      console.log(`  todo mirror: ${todos.length} items, ${open} open, ${reminder}`)
    } catch {
      console.log("  todo mirror: unreadable")
    }
  }

  const persisted = db.prepare(`
    select count(*) as n from session_message
    where session_id = ? and type = 'user'
      and data like '%Current todo list for this session%'
  `).get(sid).n
  console.log(`  persisted reminders: ${persisted}${persisted > 0 ? "  <-- history pollution" : ""}`)

  const rows = db.prepare(`
    select seq, time_created, data from session_message
    where session_id = ? and type = 'assistant'
    order by seq
  `).all(sid)

  const turns = []
  for (const row of rows) {
    let data
    try {
      data = JSON.parse(row.data)
    } catch {
      continue
    }
    const tokens = data && data.tokens
    if (!tokens) continue
    const input = num(tokens.input)
    const cacheRead = num(tokens.cache && tokens.cache.read)
    const cacheWrite = num(tokens.cache && tokens.cache.write)
    const output = num(tokens.output)
    if (input === 0 && cacheRead === 0 && output === 0) continue
    turns.push({ seq: row.seq, at: row.time_created, input, cacheRead, cacheWrite, output, cost: num(data.cost) })
  }

  if (turns.length === 0) {
    console.log("  assistant token data: none")
    continue
  }
  anyCacheData = anyCacheData || turns.some((turn) => turn.cacheRead > 0)
  const sum = turns.reduce((acc, turn) => ({
    input: acc.input + turn.input,
    cacheRead: acc.cacheRead + turn.cacheRead,
    cacheWrite: acc.cacheWrite + turn.cacheWrite,
    output: acc.output + turn.output,
    cost: acc.cost + turn.cost,
  }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0 })
  console.log(
    `  assistant turns: ${turns.length}  input ${sum.input}  cache_read ${sum.cacheRead}  ` +
    `cache_write ${sum.cacheWrite}  output ${sum.output}  cost $${sum.cost.toFixed(6)}`,
  )
  console.log(`  per-turn cache read share: ${pct(sum.cacheRead, sum.input).toFixed(1)}%`)

  if (oneSession) {
    console.log("\n  seq      at                  gap      input   cache_read  cache%   output")
    let previousAt = null
    let missesAfterIdle = 0
    for (const turn of turns.slice(-turnLimit)) {
      const gap = previousAt === null ? 0 : Math.max(0, turn.at - previousAt)
      const gapText = gap === 0 ? "-" : gap >= 60_000 ? `${Math.round(gap / 60_000)}m` : `${Math.round(gap / 1000)}s`
      console.log(
        `  ${String(turn.seq).padEnd(7)} ${stamp(turn.at).padEnd(20)} ${gapText.padStart(5)} ` +
        `${String(turn.input).padStart(8)} ${String(turn.cacheRead).padStart(10)} ` +
        `${pct(turn.cacheRead, turn.input).toFixed(1).padStart(7)}% ${String(turn.output).padStart(7)}`,
      )
      if (turn.cacheRead === 0 && gap >= 5 * 60_000) {
        missesAfterIdle += 1
        console.log(`      ^ cache miss after a ${gapText} idle gap; provider cache likely expired`)
      }
      previousAt = turn.at
    }
    if (missesAfterIdle > 0) {
      console.log(`\n  ${missesAfterIdle} full cache miss(es) followed an idle gap of 5 minutes or more.`)
    }
  }
}

console.log(`\nSessions with an injected reminder: ${withOpen}/${recent.length}`)
if (!anyCacheData) {
  console.log("No provider cache reads are recorded in these sessions.")
  console.log("Run a controlled 4-turn session on the target model before claiming a cache improvement.")
}
db.close()
