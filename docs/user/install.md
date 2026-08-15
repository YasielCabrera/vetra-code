# Install and first run

Vetra Code is currently available as a source checkout. Packaged desktop releases and a published
CLI package are intentionally disabled until Vetra owns its release repository, signing, hosted
domains, and update infrastructure.

## Requirements

- Node.js `24.13.1` or a compatible version from the root `package.json`
- pnpm `11.10.0`
- Git
- at least one provider CLI installed and authenticated

| Provider   | Default binary | Login command         |
| ---------- | -------------- | --------------------- |
| Codex      | `codex`        | `codex login`         |
| Claude     | `claude`       | `claude auth login`   |
| Cursor     | `cursor-agent` | `agent login`         |
| Grok Build | `grok`         | `grok login`          |
| OpenCode   | `opencode`     | `opencode auth login` |

Run provider login on the machine where the Vetra server runs. A CLI can instead be configured with
an explicit binary path in **Settings** when it is not on that process's `PATH`.

## Web development

From the repository root:

```bash
pnpm install
pnpm dev --dry-run
pnpm dev --home-dir .vetra-code
```

The dry run should report Vetra ports and a Vetra state directory. The live server prints a
one-time `pairingUrl`; open the complete URL, including its token.

The explicit repository-local home is recommended for the first run. It prevents this checkout's
projects, threads, settings, and secrets from mixing with any other Vetra checkout. Never use
another application's data directory as a Vetra home.

## Desktop development

```bash
pnpm dev:desktop
```

The desktop app uses Vetra application IDs, protocols, and Electron storage. It can therefore run
beside another installed coding-agent client without sharing its profile.

## Current distribution boundary

Vetra package publishing, automatic updates, background-service installation, and package-based remote
launch remain unavailable during bootstrap. Run the project from this source checkout for now.

## Providers

Vetra Code drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider   | CLI                                                   | Default binary | Log in with           |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
Vetra Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the Vetra Code server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Vetra Code.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
Vetra Code. You can install Vetra Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much Vetra Code asks before acting
- [Keyboard shortcuts](./keybindings.md)
- [Remote access status](./remote-access.md): connect from a phone, tablet, or another desktop
- [Update status](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
