/**
 * Phase taxonomy for the task board.
 *
 * Agents name phases freely — `todowrite` takes any string — so a workspace that
 * has run for a few weeks holds a hundred or more near-duplicate names, each
 * declared by one session and never reused. The board cannot fix that at the
 * source without constraining the agent (and constraining it would be wrong: a
 * session about "Dock 图标" has no stage in common with one about "P0 止血").
 *
 * So the fix lives here, at display time, and changes nothing that is stored:
 *
 *   1. `normalizePhase` folds what is only cosmetic — full-width characters,
 *      repeated spaces, stray punctuation. Lossless; "P0 止血" and "P0　止血"
 *      become one entry.
 *   2. `familyOf` buckets a name into one of a handful of families by regex. No
 *      model, no token, ~85% coverage on real data.
 *   3. An optional alias map (grown once per new word by the Small Model, see
 *      `src/taxonomy-ai.js`) renames the long tail. It is data, not prompt: it
 *      never enters a session and never reaches the agent.
 *
 * Everything here is pure and DOM-free, so `scripts/test-taxonomy.mjs` runs it
 * under Node.
 */

/** The catch-all family. Always last, always grey. */
export const OTHER_FAMILY = "其他"
/** The coloured families, in colour order — index is the palette slot. */
export const FAMILIES = ["优先级", "批次", "质量", "发版", "界面", "实现"]
/** Every family, catch-all included. */
export const FAMILY_ORDER = [...FAMILIES, OTHER_FAMILY]
/** Chips drawn before "+ N 其他" in the collapsed cloud. */
export const TOP_N = 12

/**
 * Ordered, first match wins. Order is the whole design: "UI 修复" must read as
 * 界面 (not 实现), "验证与打包" as 质量 (not 发版), "P0 止血" as 优先级.
 */
const RULES = [
  { family: "优先级", re: /^p[0-4](?:[\s:：-]|$)/i },
  { family: "批次", re: /^(批次|第\s*\d+\s*批|batch\s*\d+)/i },
  { family: "质量", re: /(验证|核查|核验|复核|验收|检查|审计|排查|回归|质检|评审)/ },
  { family: "发版", re: /(发版|发布|部署|打包|上线|交付|灰度|回滚)/ },
  { family: "界面", re: /(ui|界面|动效|图标|画布|渲染|选择器|布局|样式|视觉|交互)/i },
  { family: "实现", re: /(实现|开发|编码|修复|重构|实施|接入|迁移|优化|性能)/ },
]

/**
 * Fold a phase name to its comparable form. Cosmetic only: no word is dropped,
 * no meaning changes, so a board filtered on the result still names what the
 * agent wrote.
 */
export function normalizePhase(name) {
  if (typeof name !== "string") return ""
  let out = name.normalize("NFKC")
  out = out.replace(/[\u00a0\u3000]/g, " ").replace(/\s+/g, " ").trim()
  out = out.replace(/^[\s\-–—_·•|/\\]+/, "")
  out = out.replace(/[\s\-–—_·•|/\\:：、,，.。;；!！?？]+$/, "")
  return out
}

/** The family a phase name belongs to. Pure regex, no state. */
export function familyOf(name) {
  const text = normalizePhase(name)
  if (!text) return OTHER_FAMILY
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.family
  }
  return OTHER_FAMILY
}

/** Palette slot for a family: 0-4 for the coloured ones, -1 for the catch-all. */
export function familyIndex(family) {
  const index = FAMILIES.indexOf(family)
  return index < 0 ? -1 : index
}

/** The display label for a phase: the alias when there is one, else its folded form. */
export function labelOf(name, aliases) {
  const key = normalizePhase(name)
  if (!key) return ""
  const alias = aliases && typeof aliases === "object" ? aliases[key] : undefined
  return typeof alias === "string" && alias !== "" ? alias : key
}

/**
 * Turn the workspace's `{ phase: count }` map into rows the cloud can draw.
 *
 * - Names that fold to the same key are summed, so "P0 止血" and "P0  止血" stop
 *   competing for two slots.
 * - The blank phase is not a row: it is the "未分组" count, returned apart so the
 *   caller can pin it last.
 * - `showEmpty: false` (the default) drops count-0 rows. On a real workspace that
 *   alone removes most of the cloud.
 *
 * `sort`: "count" (default, descending, ties by label), "name" (locale order), or
 * "declare" (the order the index listed them, which is first-appearance order).
 * `pinned` names float to the top in every mode, in pin order.
 */
export function buildRows(byPhase, opts = {}) {
  const aliases = opts.aliases && typeof opts.aliases === "object" ? opts.aliases : {}
  const familyMap = opts.familyMap && typeof opts.familyMap === "object" ? opts.familyMap : {}
  const pinned = Array.isArray(opts.pinned) ? opts.pinned : []
  const pinIndex = new Map()
  for (const pin of pinned) {
    const key = normalizePhase(pin)
    if (key && !pinIndex.has(key)) pinIndex.set(key, pinIndex.size)
  }
  const merged = new Map()
  let ungrouped = 0
  for (const [raw, count] of Object.entries(byPhase || {})) {
    const n = Number.isFinite(count) ? count : 0
    const key = normalizePhase(raw)
    if (!key) {
      ungrouped += n
      continue
    }
    if (merged.has(key)) merged.set(key, merged.get(key) + n)
    else merged.set(key, n)
  }
  const showEmpty = opts.showEmpty === true
  let rows = []
  for (const [key, count] of merged) {
    if (!showEmpty && count <= 0) continue
    const label = labelOf(key, aliases)
    // A family the Small Model assigned wins over the regex, but only when it
    // names a real family — a stale or junk override falls back to the rules.
    const override = familyMap[key]
    rows.push({
      key,
      label,
      family: typeof override === "string" && FAMILY_ORDER.includes(override) ? override : familyOf(key),
      count,
      pin: pinIndex.has(key) ? pinIndex.get(key) : -1,
    })
  }
  const mode = opts.sort === "name" || opts.sort === "declare" ? opts.sort : "count"
  if (mode === "count") rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh"))
  else if (mode === "name") rows.sort((a, b) => a.label.localeCompare(b.label, "zh"))
  if (mode !== "declare") {
    rows = rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        // Pinned rows first (in pin order), then everything in the chosen order.
        const ap = a.row.pin < 0 ? 1 : 0
        const bp = b.row.pin < 0 ? 1 : 0
        return (ap - bp) || (a.row.pin - b.row.pin) || (a.index - b.index)
      })
      .map((entry) => entry.row)
  }
  for (const row of rows) row.colorIndex = familyIndex(row.family)
  return { rows, ungrouped }
}

/**
 * Fold rows into family groups, largest first. The catch-all is always last and
 * never sorts ahead of a named family, however many rows it holds.
 */
export function groupFamilies(rows) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!groups.has(row.family)) groups.set(row.family, { family: row.family, count: 0, rows: [] })
    const group = groups.get(row.family)
    group.count += row.count
    group.rows.push(row)
  }
  return [...groups.values()].sort((a, b) => {
    if (a.family === OTHER_FAMILY) return 1
    if (b.family === OTHER_FAMILY) return -1
    return b.count - a.count || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family)
  })
}

/**
 * Split rows into the ones the collapsed cloud draws and the rest. Pinned rows
 * are always drawn and do not consume the `topN` budget; the remaining slots go
 * to the list's current order.
 */
export function splitTop(rows, topN = TOP_N) {
  const list = Array.isArray(rows) ? rows : []
  const pinnedRows = list.filter((row) => row.pin >= 0)
  const rest = list.filter((row) => row.pin < 0)
  const shown = [...pinnedRows, ...rest.slice(0, Math.max(0, topN))]
  return { shown, hidden: Math.max(0, rest.length - Math.max(0, topN)) }
}
