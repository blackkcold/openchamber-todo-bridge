// Checks the learned-taxonomy channel (`src/taxonomy-ai.js`).
//
// This is the only part of the extension that may spend model tokens. The checks
// below pin the three properties that keep it honest and cheap: it only looks at
// words the rules could not place, it never sends the same batch twice, and it
// never writes anything the model invented.
import {
  BACKOFF_MS,
  COOLDOWN_MS,
  MAX_BATCH,
  MAX_LABEL,
  MAX_PER_DAY,
  TAXONOMY_KEY,
  buildPrompt,
  emptyStore,
  extractJson,
  failStore,
  gate,
  hashNames,
  mergeStore,
  parseAnswer,
  parseStore,
  rollbackStore,
  unknownNames,
} from "../src/taxonomy-ai.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
}
const HOUR = 3600 * 1000
const now = Date.UTC(2026, 0, 15, 12, 0, 0)
const names = [
  { n: "微博登录", c: 3 },
  { n: "Dock 图标", c: 1 },
]

console.log("\nemptyStore / parseStore — the stored document")
check("the key is namespaced", TAXONOMY_KEY === "phase:taxonomy")
check("an empty store is versioned", emptyStore().version === 1)
check("an empty store has no aliases", Object.keys(emptyStore().aliases).length === 0)
check("a missing value becomes an empty store", parseStore(undefined).version === 1)
check("a string becomes an empty store", Object.keys(parseStore("nope").aliases).length === 0)
check("an array becomes an empty store", Object.keys(parseStore([]).aliases).length === 0)
check("an alias is kept", parseStore({ aliases: { "微博登录": "社交登录" } }).aliases["微博登录"] === "社交登录")
check("an alias is keyed by its folded name", parseStore({ aliases: { "Ｐ０ 止血": "P0" } }).aliases["P0 止血"] === "P0")
check("an empty alias is dropped", parseStore({ aliases: { x: "" } }).aliases.x === undefined)
check("a non-string alias is dropped", parseStore({ aliases: { x: 5 } }).aliases.x === undefined)
check("an over-long alias is clamped", parseStore({ aliases: { x: "y".repeat(80) } }).aliases.x.length === MAX_LABEL)
check("a known family override is kept", parseStore({ familyMap: { x: "质量" } }).familyMap.x === "质量")
check("an unknown family override is dropped", parseStore({ familyMap: { x: "乱写" } }).familyMap.x === undefined)
check("a non-array pinned list is ignored", parseStore({ pinned: "x" }).pinned.length === 0)
check("pinned names are folded and deduped", parseStore({ pinned: ["Ｐ０", "P0"] }).pinned.length === 1)
check("a negative fails count is ignored", parseStore({ fails: -2 }).fails === 0)
check("the previous snapshot is restored", parseStore({ previous: { aliases: { a: "b" }, familyMap: {} } }).previous.aliases.a === "b")

console.log("\nunknownNames — only what the rules could not place")
{
  const byPhase = { "微博登录": 3, "Dock 图标": 1, "验证": 9, "发版": 4, "": 2, "微博登录 ": 1 }
  const list = unknownNames(byPhase, emptyStore())
  const keys = list.map((item) => item.n)
  check("a rule-matched name is not asked about", !keys.includes("验证") && !keys.includes("发版"))
  check("an ungrouped name is not asked about", !keys.includes(""))
  check("folded duplicates merge", list.find((item) => item.n === "微博登录").c === 4)
  check("the list is sorted by count", keys[0] === "微博登录")
  check("an aliased name is not asked about", unknownNames(byPhase, { aliases: { "微博登录": "社交登录" } }).every((item) => item.n !== "微博登录"))
  check("the batch is capped", unknownNames(Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`未知${i}`, 1])), emptyStore()).length === MAX_BATCH)
  check("an empty map yields nothing", unknownNames({}, emptyStore()).length === 0)
}

console.log("\nhashNames — the repeat guard")
check("the same batch hashes the same", hashNames(names) === hashNames([...names]))
check("a different name hashes differently", hashNames(names) !== hashNames([{ n: "别的", c: 3 }]))
check("order matters (a reordered batch is a new ask)", hashNames([names[0], names[1]]) !== hashNames([names[1], names[0]]))
check("an empty batch still hashes", typeof hashNames([]) === "string")

console.log("\nbuildPrompt — closed facts, exact shape")
{
  const { system, prompt } = buildPrompt(names, parseStore({ aliases: { x: "旧名" } }))
  check("the system names the allowed families", system.includes("Allowed families"))
  check("the system forbids prose", system.includes("JSON only"))
  check("the prompt lists the batch with counts", prompt.includes("1. 微博登录 (3)"))
  check("the prompt carries existing aliases", prompt.includes("旧名"))
  check("the prompt states the exact output shape", prompt.includes('"map"'))
  check("the prompt has no blank lines", !prompt.includes("\n\n"))
}

console.log("\nextractJson / parseAnswer — trust nothing")
{
  check("a bare object parses", extractJson('{"map":[]}') !== null)
  check("a fenced object parses", extractJson('```json\n{"map":[]}\n```') !== null)
  check("prose around the object is ignored", extractJson('sure: {"map":[]} done') !== null)
  check("garbage returns null", extractJson("no json here") === null)
  check("a truncated object returns null", extractJson('{"map":[') === null)
  check("a non-string returns null", extractJson(null) === null)

  const answer = parseAnswer(
    JSON.stringify({
      map: [
        { n: "微博登录", family: "乱写", label: "社交登录" },
        { n: "Dock 图标", family: "界面", label: "Dock" },
        { n: "编造的名字", family: "质量", label: "x" },
        { n: "微博登录", family: "发版", label: "重复" },
      ],
    }),
    names,
  )
  check("only input keys are accepted", answer.map.every((item) => item.n === "微博登录" || item.n === "Dock 图标"))
  check("an invented name is dropped", !answer.map.some((item) => item.n === "编造的名字"))
  check("a duplicate key keeps the first", answer.map.find((item) => item.n === "微博登录").label === "社交登录")
  check("a family outside the set becomes 其他", answer.map.find((item) => item.n === "微博登录").family === "其他")
  check("a non-JSON answer yields an empty map", parseAnswer("nope", names).map.length === 0)
  check("a missing map yields an empty map", parseAnswer('{"x":1}', names).map.length === 0)
  check(
    "an empty label falls back to the key",
    parseAnswer(JSON.stringify({ map: [{ n: "Dock 图标", family: "界面", label: "" }] }), names).map[0].label === "Dock 图标",
  )
  check("an over-long label is clamped", parseAnswer(JSON.stringify({ map: [{ n: "微博登录", family: "其他", label: "长".repeat(60) }] }), names).map[0].label.length === MAX_LABEL)
}

console.log("\ngate — four gates, one request")
{
  const fresh = emptyStore()
  check("a new batch passes", gate(fresh, "abc", now).ok === true)
  check("the same batch does not", gate({ ...fresh, lastHash: "abc" }, "abc", now).reason === "unchanged")
  check("a cooldown blocks", gate({ ...fresh, lastRunAt: now - HOUR }, "x", now).reason === "cooldown")
  check("a finished cooldown passes", gate({ ...fresh, lastRunAt: now - COOLDOWN_MS }, "x", now).ok === true)
  check("a backoff blocks", gate({ ...fresh, nextTryAt: now + HOUR }, "x", now).reason === "backoff")
  check("a spent daily budget blocks", gate({ ...fresh, dayKey: "2026-01-15", runsToday: MAX_PER_DAY }, "x", now).reason === "daily-cap")
  check("yesterday's budget does not", gate({ ...fresh, dayKey: "2026-01-14", runsToday: MAX_PER_DAY }, "x", now).ok === true)
  check("a bad clock blocks", gate(fresh, "x", NaN).ok === false)
}

console.log("\nmergeStore — frozen, reversible")
{
  const before = emptyStore()
  const answer = {
    map: [
      { n: "微博登录", family: "质量", label: "社交登录" },
      { n: "Dock 图标", family: "界面", label: "Dock" },
    ],
  }
  const after = mergeStore(before, answer, "h1", now)
  check("the alias lands", after.aliases["微博登录"] === "社交登录")
  check("a family that differs from the rules is stored", after.familyMap["微博登录"] === "质量")
  check("a family equal to the rules is not stored", after.familyMap["Dock 图标"] === undefined)
  check("the hash is recorded", after.lastHash === "h1")
  check("the run is recorded", after.lastRunAt === now && after.runsToday === 1)
  check("failures reset", after.fails === 0 && after.nextTryAt === 0)
  check("the previous snapshot is kept", after.previous.aliases["微博登录"] === undefined)
  check("the input store is not mutated", Object.keys(before.aliases).length === 0)

  const failed = failStore(after, now + 1000)
  check("a failure counts", failed.fails === 1)
  check("a failure sets a backoff", failed.nextTryAt === now + 1000 + BACKOFF_MS[0])
  const noModel = failStore(before, now, "no-model")
  check("a missing model backs off the longest", noModel.nextTryAt === now + BACKOFF_MS[BACKOFF_MS.length - 1])

  const rolled = rollbackStore(after, now + 5000)
  check("rollback restores the aliases", Object.keys(rolled.aliases).length === 0)
  check("rollback restores the families", Object.keys(rolled.familyMap).length === 0)
  check("rollback clears the hash so the batch can retry", rolled.lastHash === "")
  check("rollback clears the snapshot", rolled.previous === null)
  check("rollback without a snapshot is a no-op", rollbackStore(before, now).aliases["微博登录"] === undefined)
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall taxonomy-ai checks passed")
