// Build/version drift guard.
//
// The status section inlines the plugin source and manifest at build time. A
// version bump without a rebuild, or a source change without a rebuild, ships a
// stale plugin even though the source tests pass. This check runs under Node and
// reads only committed artifacts; it never writes.

import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"

const root = JSON.parse(readFileSync("package.json", "utf8"))
const plugin = JSON.parse(readFileSync("opencode-plugin/package.json", "utf8"))
const source = readFileSync("opencode-plugin/index.js", "utf8")
const status = readFileSync("status/main.js", "utf8")
const panel = readFileSync("panel/main.js", "utf8")
const board = readFileSync("board/main.js", "utf8")
const sourceHash = createHash("sha256").update(source).digest("hex")

// Same serialization as scripts/build.ts: every UI source file, in name order.
const uiFiles = readdirSync("src").filter((file) => file.endsWith(".js")).sort()
const uiHash = createHash("sha256")
for (const file of uiFiles) {
  uiHash.update(file).update("\n").update(readFileSync(`src/${file}`, "utf8")).update("\n")
}
const uiSourceHash = uiHash.digest("hex")

let failed = 0
const check = (name, pass, detail = "") => {
  if (!pass) failed += 1
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

const expected = "1.2.0"
check("root package version is current", root.version === expected, root.version)
check("plugin package version matches root", plugin.version === root.version, `${plugin.version} vs ${root.version}`)
check("status build embeds the current manifest version", status.includes(`"version": "${expected}"`))
check("status build embeds the current plugin source", status.includes("createCoalescingQueue") && status.includes("resultContent"))
check("status build embeds the structure renderer", status.includes("Phases: ") && status.includes(" deps:"))
check("status build matches the current plugin source hash", status.includes(`// plugin-source-sha256: ${sourceHash}`), sourceHash.slice(0, 12))
check(
  "every built page matches the current UI source hash",
  [status, panel, board].every((text) => text.includes(`// ui-source-sha256: ${uiSourceHash}`)),
  uiSourceHash.slice(0, 12),
)

if (failed > 0) {
  console.error(`\n${failed} build check(s) failed`)
  process.exit(1)
}
console.log("\nall build checks passed")
