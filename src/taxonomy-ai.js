/**
 * The one-shot classifier that grows the phase taxonomy.
 *
 * This is the only place a model is involved, and it is deliberately outside every
 * session: `host.generate` runs the user's Small Model with no session, no history
 * and no tools (OpenChamber SDK, capability `model`). Nothing here ever reaches an
 * agent, a tool description, or a chat transcript.
 *
 * The shape of the work is what keeps it cheap:
 *
 *   - It classifies *words*, not sessions. Phase names are shared across sessions,
 *     so one request covers the whole workspace, and a word is judged once, ever.
 *   - The result is frozen into `host.storage`. A word already mapped is never sent
 *     again; only genuinely new names enter the next batch.
 *   - Four gates stand between a poll and a request: an unchanged hash, a cooldown,
 *     a daily cap, and a failure backoff. A failed model call costs one log line,
 *     never a retry loop.
 *   - The answer is a suggestion, not a write: keys must match the input exactly,
 *     families must be in the closed set, and anything else is dropped.
 *
 * Pure: no DOM, no SDK, no host. `scripts/test-taxonomy-ai.mjs` runs it under Node.
 */
import { FAMILY_ORDER, OTHER_FAMILY, familyOf, normalizePhase } from "./taxonomy.js"

/** The `host.storage` key the learned taxonomy lives under. */
export const TAXONOMY_KEY = "phase:taxonomy"
export const STORE_VERSION = 1
/** Names per request. Beyond this the answer gets sloppy and the output cap bites. */
export const MAX_BATCH = 60
/** Longest canonical label accepted from the model. */
export const MAX_LABEL = 24
export const COOLDOWN_MS = 6 * 3600 * 1000
export const MAX_PER_DAY = 3
export const BACKOFF_MS = [5 * 60 * 1000, 3600 * 1000, 6 * 3600 * 1000, 24 * 3600 * 1000]

export function emptyStore() {
  return {
    version: STORE_VERSION,
    aliases: {},
    familyMap: {},
    pinned: [],
    lastRunAt: 0,
    lastHash: "",
    fails: 0,
    nextTryAt: 0,
    dayKey: "",
    runsToday: 0,
    previous: null,
  }
}

/** Defensive parse: a stored value may be older, partial, or not ours at all. */
export function parseStore(raw) {
  const out = emptyStore()
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out
  if (raw.aliases && typeof raw.aliases === "object" && !Array.isArray(raw.aliases)) {
    for (const [key, label] of Object.entries(raw.aliases)) {
      const k = normalizePhase(key)
      if (!k || typeof label !== "string") continue
      const text = label.trim().slice(0, MAX_LABEL)
      if (text) out.aliases[k] = text
    }
  }
  if (raw.familyMap && typeof raw.familyMap === "object" && !Array.isArray(raw.familyMap)) {
    for (const [key, family] of Object.entries(raw.familyMap)) {
      const k = normalizePhase(key)
      if (k && typeof family === "string" && FAMILY_ORDER.includes(family)) out.familyMap[k] = family
    }
  }
  if (Array.isArray(raw.pinned)) {
    for (const name of raw.pinned) {
      const k = normalizePhase(name)
      if (k && !out.pinned.includes(k)) out.pinned.push(k)
    }
  }
  if (Number.isFinite(raw.lastRunAt)) out.lastRunAt = raw.lastRunAt
  if (typeof raw.lastHash === "string") out.lastHash = raw.lastHash
  if (Number.isFinite(raw.fails) && raw.fails >= 0) out.fails = Math.floor(raw.fails)
  if (Number.isFinite(raw.nextTryAt)) out.nextTryAt = raw.nextTryAt
  if (typeof raw.dayKey === "string") out.dayKey = raw.dayKey
  if (Number.isFinite(raw.runsToday) && raw.runsToday >= 0) out.runsToday = Math.floor(raw.runsToday)
  if (raw.previous && typeof raw.previous === "object") {
    const previous = parseStore({ aliases: raw.previous.aliases, familyMap: raw.previous.familyMap })
    out.previous = { aliases: previous.aliases, familyMap: previous.familyMap }
  }
  return out
}

/**
 * The names worth asking about: not already aliased, and not already caught by a
 * rule family. Sorted by count so a batch limit keeps the ones that matter.
 */
export function unknownNames(byPhase, store, limit = MAX_BATCH) {
  const aliases = (store && store.aliases) || {}
  const merged = new Map()
  for (const [raw, count] of Object.entries(byPhase || {})) {
    const key = normalizePhase(raw)
    if (!key) continue
    if (aliases[key]) continue
    if (familyOf(key) !== OTHER_FAMILY) continue
    merged.set(key, (merged.get(key) || 0) + (Number.isFinite(count) ? count : 0))
  }
  return [...merged.entries()]
    .map(([n, c]) => ({ n, c }))
    .sort((a, b) => b.c - a.c || a.n.localeCompare(b.n, "zh"))
    .slice(0, Math.max(0, limit))
}

/** A stable fingerprint of a batch, so the same words never cost a second call. */
export function hashNames(names) {
  const text = (Array.isArray(names) ? names : []).map((item) => item.n).join("\u0000")
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/** The two prompts. Short system, closed facts, an exact output shape. */
export function buildPrompt(names, store) {
  const aliases = store && store.aliases ? Object.values(store.aliases).slice(0, 40) : []
  const list = (Array.isArray(names) ? names : [])
    .map((item, index) => `${index + 1}. ${item.n} (${item.c})`)
    .join("\n")
  const system = [
    "You tidy phase labels on a developer's task board.",
    "Answer with JSON only. No prose, no code fence.",
    `Allowed families: ${FAMILY_ORDER.join(", ")}.`,
  ].join(" ")
  const prompt = [
    "Phase labels from a task board, with how many tasks use each:",
    list,
    "",
    aliases.length ? `Already in use: ${aliases.join(", ")}` : "",
    "For every label above, pick the best family from the allowed list.",
    `Also give a short canonical label (at most ${MAX_LABEL} characters) that merges near-duplicates — for example "P0 止血" and "止血" both become "P0 止血".`,
    "Use the input label verbatim in `n`. Never invent labels.",
    'Reply exactly: {"map":[{"n":"<input label>","family":"<family>","label":"<canonical>"}]}',
  ]
    .filter((line) => line !== "")
    .join("\n")
  return { system, prompt }
}

/** The first complete JSON object in a model answer, or null. */
export function extractJson(text) {
  if (typeof text !== "string") return null
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * The answer, validated against the exact batch we sent. Everything the model can
 * get wrong — an invented name, a family outside the set, a 200-character label,
 * a missing array — is dropped rather than trusted.
 */
export function parseAnswer(text, names) {
  const allowed = new Set((Array.isArray(names) ? names : []).map((item) => normalizePhase(item.n)))
  const parsed = extractJson(text)
  const map = []
  const seen = new Set()
  if (!parsed || !Array.isArray(parsed.map)) return { map }
  for (const item of parsed.map) {
    if (!item || typeof item !== "object") continue
    const key = normalizePhase(item.n)
    if (!key || !allowed.has(key) || seen.has(key)) continue
    const family = typeof item.family === "string" && FAMILY_ORDER.includes(item.family) ? item.family : OTHER_FAMILY
    const raw = typeof item.label === "string" ? item.label.trim().slice(0, MAX_LABEL) : ""
    seen.add(key)
    map.push({ n: key, family, label: raw || key })
  }
  return { map }
}

/** The UTC day a run belongs to — the daily cap's bucket. */
export function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * Whether a request may be made now. Every gate returns a reason instead of
 * throwing, so the caller can stay a one-liner and a test can name the block.
 */
export function gate(store, hash, now) {
  const state = store || emptyStore()
  if (!Number.isFinite(now)) return { ok: false, reason: "bad-clock" }
  if (state.nextTryAt > now) return { ok: false, reason: "backoff" }
  if (hash && state.lastHash === hash) return { ok: false, reason: "unchanged" }
  if (state.lastRunAt && now - state.lastRunAt < COOLDOWN_MS) return { ok: false, reason: "cooldown" }
  const runs = state.dayKey === dayKey(now) ? state.runsToday : 0
  if (runs >= MAX_PER_DAY) return { ok: false, reason: "daily-cap" }
  return { ok: true, reason: "" }
}

/** Fold a validated answer into the store, keeping one snapshot for rollback. */
export function mergeStore(store, answer, hash, now) {
  const base = parseStore(store)
  const next = {
    ...base,
    aliases: { ...base.aliases },
    familyMap: { ...base.familyMap },
    previous: { aliases: { ...base.aliases }, familyMap: { ...base.familyMap } },
    lastRunAt: now,
    lastHash: hash || "",
    fails: 0,
    nextTryAt: 0,
    dayKey: dayKey(now),
    runsToday: (base.dayKey === dayKey(now) ? base.runsToday : 0) + 1,
  }
  for (const item of (answer && answer.map) || []) {
    const key = normalizePhase(item.n)
    if (!key) continue
    if (item.label) next.aliases[key] = item.label
    // Only keep an override that beats the rules; otherwise let the regex decide.
    if (item.family && item.family !== familyOf(key)) next.familyMap[key] = item.family
    else delete next.familyMap[key]
  }
  return next
}

/** Record a failed call: a counted attempt, and a backoff that grows. */
export function failStore(store, now, reason = "") {
  const base = parseStore(store)
  const fails = base.fails + 1
  const wait = reason === "no-model" ? BACKOFF_MS[BACKOFF_MS.length - 1] : BACKOFF_MS[Math.min(fails - 1, BACKOFF_MS.length - 1)]
  return {
    ...base,
    fails,
    nextTryAt: now + wait,
    dayKey: dayKey(now),
    runsToday: (base.dayKey === dayKey(now) ? base.runsToday : 0) + 1,
  }
}

/** Undo the last merge, one level deep. */
export function rollbackStore(store, now) {
  const base = parseStore(store)
  if (!base.previous) return base
  return {
    ...base,
    aliases: { ...base.previous.aliases },
    familyMap: { ...base.previous.familyMap },
    previous: null,
    lastHash: "",
    lastRunAt: 0,
    nextTryAt: now,
  }
}
