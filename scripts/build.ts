// Bundles the Work Status section as one classic script. OpenChamber loads
// extension pages in a sandboxed iframe that cannot run ES modules, so the
// output has to be an IIFE.
import { rm } from "node:fs/promises"

await rm("status/main.js", { force: true })

const result = await Bun.build({
  entrypoints: ["src/main.js"],
  outdir: "status",
  naming: "[name].[ext]",
  format: "iife",
  target: "browser",
  minify: false,
  sourcemap: "none",
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("built:", result.outputs.map((o) => o.path).join(", "))
