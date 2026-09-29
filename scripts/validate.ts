// Validates the extension manifest against the host's own schema, so a bad
// manifest is caught here instead of failing the install in OpenChamber.
// `parseManifestJson` is the same parser the app uses.
import { readFileSync } from "node:fs"

import { parseManifestJson } from "@openchamber/sdk/schemas"

const raw = readFileSync("package.json", "utf8")
const result = parseManifestJson(raw)

if (!result.ok) {
  console.error("manifest INVALID")
  console.error(JSON.stringify(result.issues ?? result, null, 2))
  process.exit(1)
}

console.log("manifest valid")
console.log(JSON.stringify(result.manifest?.openchamber ?? result.manifest, null, 2))
