/**
 * Builds the UI-only test extension.
 *
 * The shipped extension installs an OpenCode plugin and renders three pages.
 * This build keeps only the render half: the same `status/`, `panel/` and
 * `board/` sources, but the section compiled with `__TODO_BRIDGE_UI_ONLY__` so it
 * never touches OpenCode. It reads the todos files the stable extension's plugin
 * already writes, which is what makes it a real test of the UI against live data.
 *
 * It is a **separate package** with its own panel id (`todo-bridge-test`), so it
 * installs beside the stable `todo-bridge` instead of replacing it. Nothing here
 * is copied into `status/`, `panel/` or `board/`; the shipped build is untouched.
 *
 * Output: `test-extension/` (git-ignored, regenerated on every run).
 *
 *   bun run test-extension
 *
 * The manifest is parsed with the SDK's own schema before the folder is left in
 * place, so a bad contribution fails here rather than at install in the app.
 * Install it in OpenChamber with Settings → Extensions → Add → folder, or:
 *
 *   curl -s -X POST http://127.0.0.1:57123/api/guests \
 *     -H 'content-type: application/json' \
 *     -d '{"path":"'"$PWD"'/test-extension"}'
 *
 * It asks for one capability, `filesystem` over `~/.config/openchamber/todos/*.json`,
 * which you approve in the Extensions list on first run.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"

import { parseManifestJson } from "@openchamber/sdk/schemas"

const OUT_DIR = "test-extension"

// source -> [output dir, page file], and whether the section's UI-only flag applies.
const PAGES = [
  { source: "src/main.js", dir: "status", plugin: true },
  { source: "src/panel.js", dir: "panel", plugin: false },
  { source: "src/board.js", dir: "board", plugin: false },
]

const pkg = JSON.parse(await readFile("package.json", "utf8"))
const statusHeight = pkg.openchamber?.contributes?.statusSection?.height ?? 56
const buildStamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", ".").replace("Z", "")

// --- build the UI-only bundles -------------------------------------------------
await rm(OUT_DIR, { recursive: true, force: true })

for (const page of PAGES) {
  const dir = `${OUT_DIR}/${page.dir}`
  await mkdir(dir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [page.source],
    outdir: dir,
    naming: "main.[ext]",
    format: "iife",
    target: "browser",
    minify: false,
    sourcemap: "none",
    define: page.plugin ? { __TODO_BRIDGE_UI_ONLY__: "true" } : {},
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }

  // The pages are authored, not built, and carry no plugin half: reuse as is.
  await cp(`${page.dir}/index.html`, `${dir}/index.html`)
  console.log("built:", result.outputs.map((o) => o.path).join(", "))
}

// --- the test manifest --------------------------------------------------------
const manifest = {
  name: "openchamber-todo-bridge-test",
  version: `${pkg.version}-test.${buildStamp}`,
  private: true,
  type: "module",
  description:
    "UI-only test build of the Todos surfaces (Work Status section, rail panel, task board). Renders the lists the stable extension's OpenCode plugin mirrors; installs no plugin itself. Installs beside todo-bridge, not over it.",
  openchamber: {
    apiVersion: pkg.openchamber.apiVersion,
    engines: pkg.openchamber.engines,
    contributes: {
      panel: { id: "todo-bridge-test", name: "Todos (Test)", icon: "checkbox-circle", entry: "panel/index.html" },
      page: { entry: "board/index.html", title: "任务图 (Test)" },
      capabilities: ["sessions"],
      statusSection: {
        entry: "status/index.html",
        title: "Todos (Test)",
        height: statusHeight,
      },
      // Read-only: the todos the stable extension's plugin mirrors. `_index.json`
      // (written by the plugin) lists the sessions, so the board never has to
      // `listDir` — the grant stays file-level, no broader directory access.
      filesystem: ["~/.config/openchamber/todos/*.json"],
    },
  },
}

const raw = `${JSON.stringify(manifest, null, 2)}\n`
const parsed = parseManifestJson(raw)
if (!parsed.ok) {
  console.error("test manifest INVALID")
  console.error(JSON.stringify(parsed.issues ?? parsed, null, 2))
  process.exit(1)
}

await writeFile(`${OUT_DIR}/package.json`, raw)

console.log(`wrote: ${OUT_DIR}/package.json  (id todo-bridge-test, v${manifest.version}, UI-only)`)
console.log(`manifest valid — install the folder: ${process.cwd()}/${OUT_DIR}`)
