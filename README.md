# OpenChamber Todo Bridge

Show your OpenCode session's todo list in OpenChamber's **Work Status** panel.

[![Release](https://img.shields.io/github/v/release/blackkcold/openchamber-todo-bridge?display_name=tag)](https://github.com/blackkcold/openchamber-todo-bridge/releases)
[![License](https://img.shields.io/github/license/blackkcold/openchamber-todo-bridge)](LICENSE)
![OpenChamber 2.0.4+](https://img.shields.io/badge/OpenChamber-2.0.4%2B-6c5ce7)

The bridge brings back `todowrite` / `todoread` for OpenCode v2 and displays the current checklist in OpenChamber. The agent manages the list; the panel is read-only.

## Install

In OpenChamber, open **Settings → Extensions**, paste this URL, select **Add**, and approve the requested permissions:

```text
https://github.com/blackkcold/openchamber-todo-bridge
```

Send a message in an OpenCode session to start using the todo tools.

### Install a specific version

Append a release tag to the URL, for example `#v0.4.3`. The plain URL above follows the default branch (`main`) and updates when it moves; a pinned URL follows that tag and does not update on its own.

```text
https://github.com/blackkcold/openchamber-todo-bridge#v0.4.3
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

The extension requests access only to its todo data and the OpenCode plugin installation directory.

## Development

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run validate
bun run test
bun run build
```

The built extension in `status/` is committed because OpenChamber installs it without building.

### Releasing

OpenChamber checks a git install by fetching the ref in its URL — the default branch when the URL has none — and reading `package.json` there. A release therefore has to reach `main`, not just a tag:

1. Bump `version` in `package.json` and `opencode-plugin/package.json`.
2. Run `bun run build` and commit the rebuilt `status/main.js`.
3. Merge to `main`, tag `vX.Y.Z` on `main`, and push the branch, `main`, and the tag.
4. Create the GitHub Release.

A tag that lives only on a side branch leaves `main` on the old version, and unpinned installs never see the update.

## License

[MIT](LICENSE)
