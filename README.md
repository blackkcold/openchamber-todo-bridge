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

Append a release tag to the URL, for example `#v0.4.3`. Pinned versions do not update automatically.

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

## License

[MIT](LICENSE)
