# OpenChamber Todo Bridge

Show your OpenCode session's todo list in OpenChamber — a live **task tree** in the **Work Status** panel, a rail **panel**, and a full-screen **task board**.

[![Release](https://img.shields.io/github/v/release/blackkcold/openchamber-todo-bridge?display_name=tag)](https://github.com/blackkcold/openchamber-todo-bridge/releases)
[![License](https://img.shields.io/github/license/blackkcold/openchamber-todo-bridge)](LICENSE)
![OpenChamber 2.0.4+](https://img.shields.io/badge/OpenChamber-2.0.4%2B-6c5ce7)

The bridge brings back `todowrite` / `todoread` for OpenCode v2 and displays the list in OpenChamber. When the agent nests tasks with `id` / `parentId` and names each one's `phase`, the panel draws them as a task tree — a colour per stage, an SVG symbol per status, elbow connectors for the hierarchy — and the board shows every session side by side. A flat list still works; it just stays a checklist. The agent manages the list; the UI is read-only.

## Surfaces

| Where | What |
| --- | --- |
| Work Status section | The current session's task tree, animated. Sized to its content up to the host's 320px ceiling. |
| Rail panel | The same tree in a panel, with a button to jump to the session it belongs to. |
| Task board (`page`) | The **current** session pinned in its own card at the top, then the most recent sessions — 15 at first, loading more (and their trees) only as you scroll. Each shows a view switch (task tree / phase-swimlane graph), a session selector, filters, a cross-session summary, a phase legend, and a node detail. Its actions compose an instruction into the chat box, copy the task, or open the session it belongs to; it never writes the list back. |

The board reads the plugin's `_index.json` alone to draw its summary bar, its session labels and every card header — each index entry carries a per-session summary — so it opens instantly however many sessions exist, and opens a session's mirror only to draw that session's tree.

The task-tree / graph view understands three optional fields beyond the checklist: `id` / `parentId` nest a subtask, `phase` names its stage (drawn as colour bands / swimlanes), and `dependsOn` records a cross-task dependency — a node whose dependency is not completed is marked **blocked** (a dashed ring in the tree, a dashed chip in the swimlane). A top-level `phases` array fixes the colour / lane order. All are optional and validated (a malformed one is refused so the model corrects itself); the plugin mirrors a `version: 2` file and still reads a v1 (flat) one, which just stays a checklist.

Finished work is hidden by default: the section and the panel show only in-progress and pending tasks, with the rest behind one **已完成 N 项** fold; the board has a **显示已完成** switch. A finished task is hidden only when its whole subtree is finished, so a task that still has open work under it stays as context — and the hidden rows are rendered only when revealed.

A list that names stages (`phase`) but does not nest them still becomes a tree: the renderer adds one **group row per stage** and hangs the tasks under it, so a flat-but-phased list indents and draws connectors instead of reading as a plain list. Explicit nesting (`parentId`) always wins.

Dead sessions can be set aside. Each card below the current session carries a **归档** action, and a **批量归档已完成** button archives every session whose work is already finished (no pending or in-progress task). A set-aside session leaves the list and joins a collapsed **🗄 已归档 N 个会话** row at the end — its mirror is not read and it is not drawn until you open that row, where each card offers **恢复** (and the fold offers **全部恢复**). Archiving is the board's own state, kept in the extension's storage, never in the todo files — so it never races the agent, and a session that runs `todowrite` again returns to the list on its own.

## Install

In OpenChamber, open **Settings → Extensions**, paste this URL, select **Add**, and approve the requested permissions:

```text
https://github.com/blackkcold/openchamber-todo-bridge
```

Send a message in an OpenCode session to start using the todo tools.

### Install a specific version

Append a release tag to the URL, for example `#v0.9.0`. The plain URL above follows the default branch (`main`) and updates when it moves; a pinned URL follows that tag and does not update on its own.

```text
https://github.com/blackkcold/openchamber-todo-bridge#v0.9.0
```

### Manual plugin setup

If you prefer to install the OpenCode plugin yourself, add its directory to your OpenCode configuration and restart OpenCode:

```jsonc
{
  "plugins": ["/absolute/path/to/openchamber-todo-bridge/opencode-plugin"]
}
```

## Compatibility

- OpenCode v2
- OpenChamber desktop and web
- OpenChamber 2.0.4 or later

The extension asks for `filesystem` (its todo data and the OpenCode plugin directory) and `sessions` (so the panel and board can open the session a task belongs to — `host.openSession`).

## Development

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run validate
bun run test
bun run build
```

The built pages in `status/`, `panel/` and `board/` are committed because OpenChamber installs them without building.

### Releasing

OpenChamber checks a git install by fetching the ref in its URL — the default branch when the URL has none — and reading `package.json` there. A release therefore has to reach `main`, not just a tag:

1. Bump `version` in `package.json` and `opencode-plugin/package.json`.
2. Run `bun run build` and commit the rebuilt `status/main.js`, `panel/main.js` and `board/main.js`.
3. Merge to `main`, tag `vX.Y.Z` on `main`, and push the branch, `main`, and the tag.
4. Create the GitHub Release.

A tag that lives only on a side branch leaves `main` on the old version, and unpinned installs never see the update.

## License

[MIT](LICENSE)
