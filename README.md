# OpenChamber Todo Bridge

[![Release](https://img.shields.io/github/v/release/blackkcold/openchamber-todo-bridge?display_name=tag)](https://github.com/blackkcold/openchamber-todo-bridge/releases)
[![License](https://img.shields.io/github/license/blackkcold/openchamber-todo-bridge)](LICENSE)
![OpenChamber 2.0.4+](https://img.shields.io/badge/OpenChamber-2.0.4%2B-6c5ce7)

Visualize OpenCode todos in OpenChamber: a live task tree for the current session and a full-screen board for work across sessions. The agent owns the todo list; the UI is read-only.

| Work Status | Rail panel | Task board |
| --- | --- | --- |
| <img src="docs/screenshots/work-status.png" alt="Todo checklist in Work Status" width="280"> | <img src="docs/screenshots/rail-panel.png" alt="Hierarchical todo tree in the rail panel" width="280"> | <img src="docs/screenshots/task-board.png" alt="Cross-session todo board with swimlanes and task details" width="280"> |

## Features

- Restores `todowrite` / `todoread` for OpenCode v2 and displays session todos in OpenChamber.
- Groups nested tasks into a tree; `phase` adds colour-coded stages, and unfinished dependencies are marked blocked.
- Browse tasks across sessions in tree or swimlane view, with search, filters, and session archiving — manual, and optionally automatic for finished sessions.

## Install

In OpenChamber, open **Settings → Extensions**, paste this repository URL, select **Add**, and approve the requested permissions:

```text
https://github.com/blackkcold/openchamber-todo-bridge
```

Send a message in an OpenCode session to start using the todo tools. To pin a version, append a release tag such as `#v0.9.7` to the URL.

### v0.9.7 — a frost you can actually see

0.9.6 drew the bottom edge with a mask that started fully transparent and only became
opaque at 82% of the 28px strip. A mask does not weaken a backdrop blur: it composites the
blurred layer at partial alpha over sharp rows. So for most of the strip the text stayed
sharp under a thin veil, and the edge read as a fade with no blur in it. Measured on the
rendered panel, horizontal gradient energy across the edge band was 47, against 124 for the
same rows with no frost at all.

The mask now starts at 45% alpha and reaches opaque by 45% of the strip, which leaves about
15px at full blur strength while the entry stays soft. The tint drops from 70% to 55% of the
host background, so the blurred rows remain visible instead of being swallowed by it. The
band now measures 3 in both themes — the same as an unmasked blur — and the strip no longer
opens on a hard line. Height, the 40px of bottom padding and the `data-more` clearing are
unchanged, as is everything else from 0.9.6.

### v0.9.6 — a frosted bottom edge on the list

The rail panel's list frosts its bottom edge while rows remain below: a 28px strip of
`backdrop-filter` blur with a mask that tapers upward, tinted from the host palette, so a
long tree dissolves into whatever sits beneath the panel instead of ending on a half-cut
row. The frost clears in 160ms once the reader reaches the end, and the list carries 40px
of bottom padding, so the last row always scrolls clear of it. Nothing is drawn when the
list fits without scrolling; `prefers-reduced-motion` makes the appearance instant, and a
host without `backdrop-filter` falls back to the tint alone, which still reads as a fade.

The flag lives on `#root[data-more]` and is refreshed on scroll, on rail resize, and after
every repaint — a taller list fires no scroll event, so the repaint hook is what keeps the
edge honest when the finished toggle expands the tree. The task board and the Work Status
section are untouched: at 56px tall, a frost there would eat half the section this panel
is meant to fit into.

Also fixes the 1px frame shortfall and refreshes the design preview pages.

### v0.9.5 — a finished toggle you can always reach

The finished toggle moved from the end of the list to the header of the Work Status
section and the rail panel, so it is reachable without scrolling however long the
list is. Turning it on reveals completed rows in place inside the tree; turning it
off removes them in one step, so the list height never animates twice.

While the toggle animates, the list holds the reader's place: a row that was
scrolled into view stays where it was. Finished rows still strike through before
they leave, and the flight to the toggle is drawn on its own overlay, so the scroll
container cannot clip it.

The control itself is a soft pill with the count in a badge, and its chevron is an
inline SVG, so the stroke stays crisp at 9px. The surface mixes `currentColor`,
which keeps it legible on both themes, and `prefers-reduced-motion` disables the
transitions. This release also fixes the label's spacing, where a flex `gap` split
`已完成 / 1 / 项` into three separate items, and the pill being clipped by the host
frame's rounded corner.

### v0.9.4 — cache safety and write reliability

The per-round reminder now carries stable task ids, parent links, dependencies
and the declared phase order, so a compaction cannot flatten the task tree or
lose the board's DAG edges. Omitting `phases` preserves the stored order; only an
explicit `phases: []` clears it.

Todo writes are serialized per session, so two `todowrite` calls in one assistant
turn cannot leave storage, the mirror and `_index.json` disagreeing. Index writes
are coalesced, use unique temp files and refresh a summary when a mirror's size
or contents change without an mtime move. A fault in the context reminder no
longer fails the model request; `todowrite` still fails loudly if it cannot read
the previous phase order when `phases` is omitted. `todowrite` returns a compact
open-list result and keeps the full render for a finished list, where no reminder
is injected.

The `todowrite` tool description and input schema are unchanged from 0.9.3, so
upgrading does not invalidate the tools prefix; only the runtime behavior and the
transient tail reminder change. The deterministic cache guard and the read-only
provider-cache audit are described under Cache verification below. No
cost-savings percentage is claimed.

### v0.9.3 — cache-friendly task context

Task reminders now live at the tail of the outgoing request instead of changing
the system prefix. Unchanged lists produce identical wording, without a growing
round counter. Reminders remain transient: no extra user turns are saved, and
finished lists add no reminder. Todo storage, mirrors, and the UI are unchanged.

This removes a source of prefix instability; provider cache hits and actual cost
savings still depend on the model, routing, and workload. No savings percentage
is claimed. Regression coverage checks stable system/history prefixes and
changed, finished, and empty lists.

## Compatibility & permissions

- OpenCode v2
- OpenChamber desktop or web, version 2.0.4 or later
- `filesystem` for todo data and the OpenCode plugin directory; `sessions` to open the session a task belongs to

## Development

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run validate
bun run test
bun run build
```

The built pages in `status/`, `panel/`, and `board/` are committed because OpenChamber installs them without building.

### Cache verification

`bun run test` includes `scripts/test-cache.mjs`, which guards the deterministic
half of prompt caching: system/tools/history prefixes stay unchanged, an
unchanged todo list produces byte-identical reminder text, the transient reminder
never becomes a persisted user turn, a storage fault does not fail the model
request, and reminder/tool-result sizes stay inside a bounded budget.

For real provider data, run:

```bash
bun run cache-audit -- --limit 10
bun run cache-audit -- --session ses_... --turns 200
```

It opens the local OpenCode SQLite database read-only and reports input, cache
read/write, output, cost and the cache-read share per session. It also flags
persisted reminders and prints the current reminder size for sessions with open
tasks. With `--session`, it prints the idle gap before each turn and flags a full
cache miss that follows a gap of five minutes or more: provider cache TTL expiry
can lower the hit rate even when the tools prefix is unchanged. A reminder is
injected only while a list has open work, so compare sessions that actually have
open tasks. Text stability alone is not a cache-hit claim; use this audit on the
target model before and after a change.

## License

[MIT](LICENSE)
