/**
 * Node test for src/plugin-install.js's pure decision helper.
 *
 * `planInstall` decides whether the section should write the companion OpenCode
 * plugin. The bug this pins down: an extension whose bundled plugin is older
 * than the copy on disk used to overwrite it — silently downgrading a newer
 * plugin. It must never do that.
 */
import { planInstall, PLUGIN_ID } from "../src/plugin-install.js"

let failed = 0
const check = (name, got, want) => {
  const ok = got && got.action === want.action && got.reason === want.reason
  if (!ok) { failed += 1; console.error(`FAIL: ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`) }
  else console.log("PASS:", name)
}

const entry = (version) => `// plugin body\n\n// ${PLUGIN_ID}@${version}\n`
const partial = `// ${PLUGIN_ID} partial file, marker never landed\n`

check("missing (null)", planInstall(null), { action: "write", reason: "missing" })
check("missing (undefined)", planInstall(undefined), { action: "write", reason: "missing" })
check("foreign", planInstall("some other plugin\n"), { action: "write", reason: "foreign" })
check("current", planInstall(entry("0.6.0"), "0.6.0"), { action: "none", reason: "current" })
check("older on disk -> upgrade", planInstall(entry("0.5.1"), "0.6.0"), { action: "write", reason: "outdated" })
check("newer on disk -> no downgrade", planInstall(entry("0.7.0"), "0.6.0"), { action: "none", reason: "newer-on-disk" })
check("same major, higher minor -> no downgrade", planInstall(entry("0.6.1"), "0.6.0"), { action: "none", reason: "newer-on-disk" })
check("partial write (has id, no marker)", planInstall(partial, "0.6.0"), { action: "write", reason: "outdated" })
check("unparsable marker -> replace", planInstall(entry("weird"), "0.6.0"), { action: "write", reason: "outdated" })
check("multi-digit compare", planInstall(entry("0.10.0"), "0.9.0"), { action: "none", reason: "newer-on-disk" })

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log("\nall install checks passed")
