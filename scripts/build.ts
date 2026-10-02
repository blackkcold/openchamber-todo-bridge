// Bundles the Work Status section as one classic script. OpenChamber loads
// extension pages in a sandboxed iframe that cannot run ES modules, so the
// output has to be an IIFE.
//
// It also inlines the OpenCode plugin's source and manifest. The section writes
// them to OpenCode's autodiscovery directory so installing the extension is all
// a user has to do — there is no second install step and no config edit. Reading
// them from one canonical file at build time keeps a single source of truth
// instead of a copy that can drift.
import { readFile, rm } from "node:fs/promises"

await rm("status/main.js", { force: true })

const pluginSource = await readFile("opencode-plugin/index.js", "utf8")
const pluginPackage = await readFile("opencode-plugin/package.json", "utf8")

const result = await Bun.build({
  entrypoints: ["src/main.js"],
  outdir: "status",
  naming: "[name].[ext]",
  format: "iife",
  target: "browser",
  minify: false,
  sourcemap: "none",
  define: {
    __TODO_BRIDGE_PLUGIN_SOURCE__: JSON.stringify(pluginSource),
    __TODO_BRIDGE_PLUGIN_PACKAGE__: JSON.stringify(pluginPackage),
    __TODO_BRIDGE_UI_ONLY__: "false",
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("built:", result.outputs.map((o) => o.path).join(", "))
console.log(`inlined plugin: ${pluginSource.length} bytes source, ${pluginPackage.length} bytes manifest`)
