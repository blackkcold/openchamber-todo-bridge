# openchamber-todo-bridge

Show an OpenCode session's todo list in OpenChamber's **Work Status** panel.

Two halves, one repo:

| Half | What it is | Where it runs |
| --- | --- | --- |
| **Plugin** | An OpenCode plugin that restores `todowrite` / `todoread` and mirrors the list to a file | OpenCode server |
| **Extension** | An OpenChamber extension that renders that file as a checklist | OpenChamber Work Status panel |

## Why this exists

OpenCode v2 removed the `todowrite` / `todoread` tools. That was deliberate —
the maintainers found them to slow the agent down. But nothing replaced the
*reading* side, so there is no supported way for an external UI to show what an
agent is working through.

This repo checked every candidate channel before settling on a file:

| Candidate | Status |
| --- | --- |
| Todo HTTP endpoint | **None.** The v2 OpenAPI document has zero paths containing `todo`. |
| Todo event on the event stream | **None.** No `todo` appears anywhere in the event schema. |
| Plugin API for the native todo table | **None.** There is no `session.todo` domain on the plugin context. |
| The native `todo` SQLite table | Exists, but it is legacy: last written 2026-09-22, before the v2 move. It is not a stable interface and nothing exposes it. |
| A plain file | **Works.** The only medium both sides can reach. |

So the plugin mirrors to a file and the extension reads it. That is the whole
design.

## What you get

- `todowrite` / `todoread` back, with V1-compatible fields
  (`content`, `status`, `priority`)
- The current list re-injected as system context on **every** model request
  while tasks are open — so the agent keeps track of it across long
  conversations and context compaction
- A live checklist in the Work Status panel, per session

## Install

**One step.** Settings → Extensions → paste this repo's URL → Add, and approve
the permissions it asks for. That is the whole install.

The extension then places the OpenCode plugin itself, into the directory
OpenCode discovers on its own:

```
~/.config/opencode/plugins/openchamber-todo-bridge/
  index.js
  package.json
```

OpenCode loads that directory without a `plugins` entry in `opencode.json` and
watches it for changes, so the plugin is picked up **without a restart**.
(Verified on OpenCode 2.0.18: a plugin created while the server was running came
back `state: { status: "active" }` with nothing else touched.)

The section says so once, on the run that had to place the plugin. Send any
message in a session and it starts working.

Nothing edits `opencode.json`. That file belongs to OpenCode, and autodiscovery
makes the edit unnecessary.

### Pinning a version

Add `#v0.2.0` to the URL to follow a tag instead of the default branch:

```
https://github.com/blackkcold/openchamber-todo-bridge#v0.2.0
```

### Installing by hand

If you would rather not let the extension write into `~/.config/opencode/`, add
the plugin directory yourself:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/openchamber-todo-bridge/opencode-plugin"]
}
```

It has to be a **directory**, not a file — OpenCode rejects a file path with
`configured plugin path must be a directory`. Restart OpenCode, then confirm it
loaded:

```bash
opencode api get /api/plugin
# look for: { "id": "openchamber-todo-bridge", "state": { "status": "active" } }
```

### Permissions

The extension asks for **filesystem**, over exactly two patterns:

| Pattern | Why |
| --- | --- |
| `~/.config/openchamber/todos/*.json` | Read the mirrored list |
| `~/.config/opencode/plugins/openchamber-todo-bridge/*` | Place the OpenCode plugin |

Both are narrow and named. Nothing else on disk is reachable.


## Data file

```
~/.config/openchamber/todos/<sessionID>.json
```

```json
{
  "sessionID": "ses_...",
  "todos": [
    { "content": "Fix flaky checkout spec", "status": "in_progress", "priority": "high" },
    { "content": "Add regression test", "status": "completed" }
  ],
  "updatedAt": 1790666957365
}
```

`status` is one of `pending`, `in_progress`, `completed`, `cancelled`.
`priority` is optional: `high`, `medium`, `low`.

Point the mirror somewhere else with `TODO_BRIDGE_DIR`. If you do, update the
`filesystem` pattern in `package.json` to match — the extension can only read
the paths it declared.

Writes are atomic (temp file + `rename`), so the extension never reads a
half-written list. A mirror failure never fails the agent's tool call: the list
is already stored by then.

## Scope

- **Read-only in the panel.** Clicking a todo does not change it. The agent owns
  the list through `todowrite`.
- **Desktop and web only.** OpenChamber does not load extensions in VS Code or
  the mobile app.
- OpenCode v2 only. On v1 the built-in tools already exist, so this adds
  nothing.

## Layout

```
opencode-plugin/         OpenCode plugin — restore tools + mirror to a file
src/main.js              Extension source (the Work Status section)
src/plugin-install.js    Places the plugin into OpenCode's autodiscovery dir
status/                  Built extension page (committed; OpenChamber never builds)
scripts/build.ts         Bundles src/main.js to status/main.js as an IIFE
scripts/validate.ts      Checks the manifest against the host's own schema
design/                  Design notes, candidate layouts, and the test harnesses
```

The plugin source is **inlined into the section at build time**, so there is one
canonical copy in `opencode-plugin/` and the shipped page does not fetch its own
package over HTTP at runtime.

## Development

```bash
bun install
bun run validate   # manifest against @openchamber/sdk's parser
bun run test       # plugin behavior + the tool-description contract
bun run build      # src/main.js -> status/main.js (IIFE)
```

`status/main.js` is committed on purpose: OpenChamber installs extensions
without building them.

To exercise a change without installing anything:

```bash
python3 -m http.server 8899    # from the repo root
```

- `design/verify.html` renders the shipped section against a stub of the host
  protocol, at 2×.
- `design/plan-matrix.html` runs the install decision across every state —
  fresh, current, stale, partially written — and prints PASS/FAIL per case.


## Why the agent actually uses it

The tool description carries the whole behavioral contract, and it is long on
purpose. OpenCode's system prompt never mentions todos — in v1 the entire
guidance lived in a ~1.6KB tool description, and that is what made agents reach
for the tool unprompted.

An earlier revision of this plugin condensed that description to a few lines.
Agents then stopped updating the list, which is the expected result: with the
contract gone there is nothing telling them *when* to use the tool. The
description is restored close to v1's wording, and `bun run test` asserts that
the lines driving the behavior are still there, so it cannot quietly shrink
again.

The list is also re-injected on every model request while tasks are open. When
it goes unchanged for several rounds, the reminder says so outright instead of
repeating the same suggestion.

## License

MIT
