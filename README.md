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

### 1. The plugin

Clone this repo, then add the plugin **directory** to `plugins` in
`~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/openchamber-todo-bridge/opencode-plugin"
  ]
}
```

The entry must be a **directory**, not a file — OpenCode rejects a file path
with `configured plugin path must be a directory`.

Then restart OpenCode, or let the config watcher pick it up. Confirm it loaded:

```bash
opencode api get /api/plugin
# look for: { "id": "openchamber-todo-bridge", "state": { "status": "active" } }
```

### 2. The extension

Build it first (the built page is committed, so this is only needed after
editing `src/`):

```bash
bun install
bun run build
```

Then in OpenChamber: **Settings → Extensions → paste this repo's folder path →
Add**, and approve the single **filesystem** permission it asks for.

Finally expand **Todos** in the Work Status panel.

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
opencode-plugin/    OpenCode plugin — restore tools + mirror to a file
src/main.js         Extension source (the Work Status section)
status/             Built extension page (committed; OpenChamber never builds)
scripts/build.ts    Bundles src/main.js to status/main.js as an IIFE
scripts/validate.ts Checks the manifest against the host's own schema
```

## Development

```bash
bun install
bun run validate   # manifest against @openchamber/sdk's parser
bun run build      # src/main.js -> status/main.js (IIFE)
```

`status/main.js` is committed on purpose: OpenChamber installs extensions
without building them.

## License

MIT
