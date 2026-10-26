// Checks the board's phase taxonomy (`src/taxonomy.js`).
//
// The taxonomy is display-only: it folds the agent's free-form phase names into
// comparable rows and a handful of families, without touching a mirror, the index,
// or the tool description the agent sees. These checks pin the folding rules, the
// family order (first match wins), and the collapse behaviour that keeps the cloud
// from drawing 150 chips.
import {
  FAMILIES,
  OTHER_FAMILY,
  TOP_N,
  buildRows,
  familyIndex,
  familyOf,
  groupFamilies,
  labelOf,
  normalizePhase,
  splitTop,
} from "../src/taxonomy.js"

let failed = 0
const check = (name, pass) => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
}

console.log("\nnormalizePhase — cosmetic folding only")
check("a plain name is unchanged", normalizePhase("发版") === "发版")
check("a full-width name folds", normalizePhase("Ｐ０　止血") === "P0 止血")
check("repeated spaces collapse", normalizePhase("P0   止血") === "P0 止血")
check("a leading dash is dropped", normalizePhase("- 调研") === "调研")
check("trailing punctuation is dropped", normalizePhase("验证：") === "验证")
check("a colon inside the name is kept", normalizePhase("P0: 止血") === "P0: 止血")
check("an empty string stays empty", normalizePhase("") === "")
check("a non-string becomes empty", normalizePhase(null) === "")
check("nothing but punctuation becomes empty", normalizePhase(" · ") === "")

console.log("\nfamilyOf — first rule wins")
check("P0 is 优先级", familyOf("P0 止血") === "优先级")
check("P4 is 优先级", familyOf("P4 门控") === "优先级")
check("a bare P1 is 优先级", familyOf("P1") === "优先级")
check("P10 is not 优先级 (it would be a different scale)", familyOf("P10") === OTHER_FAMILY)
check("a batch name is 批次", familyOf("批次1 数据安全") === "批次")
check("a 第N批 name is 批次", familyOf("第 2 批校验") === "批次")
check("核查 is 质量", familyOf("核查验证") === "质量")
check("验证与打包 is 质量, not 发版", familyOf("验证与打包") === "质量")
check("发版 is 发版", familyOf("发版") === "发版")
check("部署 is 发版", familyOf("部署") === "发版")
check("UI 修复 is 界面, not 实现", familyOf("UI 修复") === "界面")
check("渲染与选择器 is 界面", familyOf("渲染与选择器") === "界面")
check("实现 is 实现", familyOf("实现") === "实现")
check("性能 is 实现", familyOf("性能") === "实现")
check("a one-off name is 其他", familyOf("微博登录") === OTHER_FAMILY)
check("an empty name is 其他", familyOf("") === OTHER_FAMILY)
check("the coloured families all resolve to a slot", FAMILIES.every((f) => familyIndex(f) >= 0))
check("the catch-all has no colour", familyIndex(OTHER_FAMILY) === -1)
check("an unknown family has no colour", familyIndex("nope") === -1)

console.log("\nlabelOf — alias, then folded name")
check("no alias returns the folded name", labelOf("Ｐ０　止血", {}) === "P0 止血")
check("an alias replaces the label", labelOf("P0 止血", { "P0 止血": "P0 止血" }) === "P0 止血")
check("an alias is looked up after folding", labelOf("Ｐ０ 止血", { "P0 止血": "止血" }) === "止血")
check("an empty alias falls back", labelOf("发版", { "发版": "" }) === "发版")

console.log("\nbuildRows — merge, drop empty, sort")
{
  const byPhase = { "发版": 9, "验证": 8, "验证 ": 2, "部署": 6, "": 4, "微博登录": 1, "空阶段": 0 }
  const { rows, ungrouped } = buildRows(byPhase)
  const names = rows.map((row) => row.label)
  check("a blank phase is the ungrouped count, not a row", ungrouped === 4 && !names.includes(""))
  check("names that fold together are summed", rows.find((row) => row.key === "验证").count === 10)
  check("a zero-count phase is dropped by default", !names.includes("空阶段"))
  check("a zero-count phase returns when asked", buildRows(byPhase, { showEmpty: true }).rows.some((row) => row.label === "空阶段"))
  check("sort=count is descending", names[0] === "验证" && names[1] === "发版")
  check("each row carries its family", rows.find((row) => row.label === "部署").family === "发版")
  check("each row carries a palette slot", rows.find((row) => row.label === "部署").colorIndex === familyIndex("发版"))
  const declared = buildRows(byPhase, { sort: "declare" }).rows.map((row) => row.label)
  check("sort=declare keeps first-appearance order", declared[0] === "发版" && declared[1] === "验证")
  const byName = buildRows(byPhase, { sort: "name" }).rows.map((row) => row.label)
  check("sort=name is alphabetical", byName[0] === "部署")
  const pinned = buildRows(byPhase, { pinned: ["微博登录"] })
  check("a pinned row floats to the top", pinned.rows[0].label === "微博登录")
  check("a pinned row is marked", pinned.rows[0].pin === 0)
  check("an alias renames a row", buildRows({ "P0 止血": 2 }, { aliases: { "P0 止血": "止血" } }).rows[0].label === "止血")
  const empty = buildRows({})
  check("an empty map yields no rows", empty.rows.length === 0 && empty.ungrouped === 0)
  check("a non-object map is tolerated", buildRows(null).rows.length === 0)
  check("a non-numeric count is treated as zero and dropped", buildRows({ x: "3" }).rows.length === 0)
  const before = { ...byPhase }
  buildRows(byPhase)
  check("buildRows does not mutate its input", JSON.stringify(before) === JSON.stringify(byPhase))
}

console.log("\ngroupFamilies — the folded view")
{
  const { rows } = buildRows({ "发版": 9, "部署": 6, "验证": 8, "实现": 3, "微博登录": 5 })
  const groups = groupFamilies(rows)
  const byFamily = Object.fromEntries(groups.map((group) => [group.family, group.count]))
  check("counts are summed per family", byFamily["发版"] === 15)
  check("the catch-all is last even with a big count", groups[groups.length - 1].family === OTHER_FAMILY)
  check("families sort by count", groups[0].family === "发版")
  check("every row lands in exactly one group", groups.reduce((n, group) => n + group.rows.length, 0) === rows.length)
}

console.log("\nsplitTop — the collapsed cloud")
{
  const rows = Array.from({ length: 20 }, (_, i) => ({ key: `p${i}`, label: `p${i}`, count: 20 - i, pin: -1 }))
  const { shown, hidden } = splitTop(rows)
  check("only TOP_N rows are drawn", shown.length === TOP_N)
  check("the rest are counted, not built", hidden === 20 - TOP_N)
  const pinned = rows.map((row) => ({ ...row }))
  pinned[19].pin = 0
  const out = splitTop(pinned)
  check("a pinned row is drawn even when it is far down", out.shown.some((row) => row.key === "p19"))
  check("a pinned row does not raise the cap", out.shown.length === TOP_N + 1)
  check("an empty list draws nothing", splitTop([]).shown.length === 0)
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log("\nall taxonomy checks passed")
