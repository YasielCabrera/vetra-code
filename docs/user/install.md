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

## Open a project in the desktop app

When the Vetra Code desktop app is running on the same machine, open the current directory in it
from the checkout:

```bash
node apps/server/src/bin.ts app
```

Pass a path to open another directory:

```bash
node apps/server/src/bin.ts app ../my-project
```

The command adds the directory as a project when needed, focuses the desktop app, and opens a new
thread. It does not launch the desktop app, open a browser, or start a Vetra Code server. A
background server does not count as the desktop app. The command also rejects SSH sessions, because
a remote shell cannot focus a local desktop window. Until Vetra publishes a CLI package, run it
from the same checkout that runs the desktop app.

## Desktop development

```bash
pnpm dev:desktop
```

The desktop app uses Vetra application IDs, protocols, and Electron storage. It can therefore run
beside another installed coding-agent client without sharing its profile.

## Current distribution boundary

Vetra package publishing, automatic updates, background-service installation, and package-based remote
launch remain unavailable during bootstrap. Run the project from this source checkout for now.

### Windows Subsystem for Linux

When the desktop app runs a WSL backend, it installs the matching server runtime into
`~/.t3/wsl-runtime` inside the selected distro. The first launch after installing or updating T3
Code may take a little longer while that release's runtime is extracted. Later launches reuse the
Linux-local copy so startup does not depend on reading application files through `/mnt/c`. After a
successful launch, Vetra Code keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, Vetra Code launches from the
application files under `/mnt/c` instead and reinstalls the runtime on the next launch.

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

Codex and Claude are on by default. Cursor, Grok Build, and OpenCode are off by default; turn
them on in **Settings** → the provider's card when you want to use them.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
Vetra Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Grok models that support adjustable reasoning show a **Reasoning** control beside the model picker.
The available levels and default come from the installed Grok Build CLI, so they can vary by model
and CLI version.

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
