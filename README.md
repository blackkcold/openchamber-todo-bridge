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

Send a message in an OpenCode session to start using the todo tools. To pin a version, append a release tag such as `#v0.9.2` to the URL.

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

## License

[MIT](LICENSE)
