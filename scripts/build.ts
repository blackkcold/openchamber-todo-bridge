// Bundles the three guest pages as classic scripts: the Work Status section,
// the rail panel, and the task board. OpenChamber loads extension pages in a
// sandboxed iframe that cannot run ES modules, so each output has to be an IIFE.
//
// It also inlines the OpenCode plugin's source and manifest into the section.
// The section writes them to OpenCode's autodiscovery directory so installing
// the extension is all a user has to do — there is no second install step and no
// config edit. Reading them from one canonical file at build time keeps a single
// source of truth instead of a copy that can drift. Only the section references
// them, so the panel and board do not carry that weight.
import { createHash } from "node:crypto"
import { appendFile, readFile, rm } from "node:fs/promises"

const PAGES = [
  { source: "src/main.js", outdir: "status", plugin: true },
  { source: "src/panel.js", outdir: "panel", plugin: false },
  { source: "src/board.js", outdir: "board", plugin: false },
]

await Promise.all(PAGES.map((page) => rm(`${page.outdir}/main.js`, { force: true })))

const pluginSource = await readFile("opencode-plugin/index.js", "utf8")
const pluginPackage = await readFile("opencode-plugin/package.json", "utf8")
/** A build-drift marker: a source change without a rebuild fails test-build. */
const pluginSourceHash = createHash("sha256").update(pluginSource).digest("hex")

for (const page of PAGES) {
  const define = page.plugin
    ? {
        __TODO_BRIDGE_PLUGIN_SOURCE__: JSON.stringify(pluginSource),
        __TODO_BRIDGE_PLUGIN_PACKAGE__: JSON.stringify(pluginPackage),
        __TODO_BRIDGE_UI_ONLY__: "false",
      }
    : {}

  const result = await Bun.build({
    entrypoints: [page.source],
    outdir: page.outdir,
    naming: "main.[ext]",
    format: "iife",
    target: "browser",
    minify: false,
    sourcemap: "none",
    define,
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log("built:", result.outputs.map((o) => o.path).join(", "))
}

// The extension installs the built section without running this script. Keep a
// source hash beside the bundle so test-build can reject a stale generated file.
await appendFile("status/main.js", `\n// plugin-source-sha256: ${pluginSourceHash}\n`)

console.log(`inlined plugin: ${pluginSource.length} bytes source, ${pluginPackage.length} bytes manifest`)
console.log(`plugin source sha256: ${pluginSourceHash}`)
