/**
 * Installing the OpenCode plugin.
 *
 * The extension cannot ask OpenCode to load a plugin — no capability reaches
 * that, and the running OpenCode server has no such API. What it can do is put
 * the plugin where OpenCode already looks:
 *
 *   ~/.config/opencode/plugins/<dir>/index.js
 *
 * OpenCode discovers plugins there without a `plugins` entry in `opencode.json`,
 * watches the directory, and picks a new one up without a restart. Verified on
 * OpenCode 2.0.18: a plugin created while the server was running reported
 * `state: { status: "active" }` with no config change.
 *
 * So installing the extension is the whole install. Nothing here edits
 * `opencode.json`: that belongs to another program, and the autodiscovery
 * directory makes the edit unnecessary.
 *
 * The source is inlined at build time from `opencode-plugin/`, so there is one
 * canonical copy and no runtime fetch of our own package over HTTP.
 *
 * This module is bundled into the section, so it ships both the text to write
 * and the pure decision helpers, which `design/verify.html` exercises without
 * touching a real profile.
 */

/** Directory name OpenCode discovers. Also the plugin id and the version marker. */
export const PLUGIN_ID = "openchamber-todo-bridge"
export const PLUGIN_DIR_PATH = `~/.config/opencode/plugins/${PLUGIN_ID}`
const PLUGIN_ENTRY_PATH = `${PLUGIN_DIR_PATH}/index.js`
const PLUGIN_MANIFEST_PATH = `${PLUGIN_DIR_PATH}/package.json`

/** Injected by scripts/build.ts. */
const SOURCE = typeof __TODO_BRIDGE_PLUGIN_SOURCE__ === "string" ? __TODO_BRIDGE_PLUGIN_SOURCE__ : ""
const MANIFEST = typeof __TODO_BRIDGE_PLUGIN_PACKAGE__ === "string" ? __TODO_BRIDGE_PLUGIN_PACKAGE__ : ""

export const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(MANIFEST).version || "0.0.0"
  } catch {
    return "0.0.0"
  }
})()

/** Marker written at the end of the file, so a partial write is detectable. */
const VERSION_MARKER = `\n// ${PLUGIN_ID}@${PLUGIN_VERSION}\n`
const ENTRY_CONTENT = SOURCE + VERSION_MARKER

/**
 * What the profile needs, given what is already on disk.
 *
 * `entry` is the current file content, or null when it is missing or unreadable.
 * Returns a plan the caller applies; keeping this pure is what lets the harness
 * test every state — fresh, current, stale, partial — with no filesystem.
 */
export function planInstall(entry) {
  if (typeof entry !== "string") return { action: "write", reason: "missing" }
  if (!entry.includes(PLUGIN_ID)) return { action: "write", reason: "foreign" }
  if (entry.endsWith(VERSION_MARKER)) return { action: "none", reason: "current" }
  // A marker that names a different version, or an older copy from before this
  // mechanism existed: both are ours to replace.
  return { action: "write", reason: "outdated" }
}

/**
 * Writes the plugin into OpenCode's autodiscovery directory.
 *
 * `readFile` and `writeFile` are the host's own file calls, injected so this
 * module stays testable. Every failure is reported, never thrown: the section
 * still works for anyone who installed the plugin by hand.
 */
export async function ensureInstalled(host) {
  const result = { ok: false, reason: "", version: PLUGIN_VERSION }

  if (!SOURCE || !MANIFEST) {
    return { ...result, reason: "build-missing-source" }
  }

  let entry = null
  try {
    entry = (await host.readFile(PLUGIN_ENTRY_PATH)).content
  } catch (error) {
    const code = error && error.code
    // Missing is the normal first run. Anything else is worth surfacing.
    if (code !== "NOT_FOUND") {
      return { ...result, reason: `read-failed:${code || "unknown"}` }
    }
  }

  const plan = planInstall(entry)
  if (plan.action === "none") return { ok: true, reason: "current", version: PLUGIN_VERSION }

  try {
    await host.writeFile(PLUGIN_ENTRY_PATH, ENTRY_CONTENT)
    await host.writeFile(PLUGIN_MANIFEST_PATH, MANIFEST)
  } catch (error) {
    const code = error && error.code
    return { ...result, reason: `write-failed:${code || "unknown"}` }
  }

  return { ok: true, reason: plan.reason, version: PLUGIN_VERSION }
}
