# Install and first run

Vetra Code is currently available as a source checkout. Packaged desktop releases and a published
CLI package are intentionally disabled until Vetra owns its release repository, signing, hosted
domains, and update infrastructure.

## Requirements

- Node.js `24.13.1` or a compatible version from the root `package.json`
- pnpm `11.10.0`
- Git
- at least one provider runtime installed and authenticated; Antigravity can be installed from
  Vetra Code settings instead. See [Providers](#providers) below.

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

If the web or desktop app shows "Vetra Code could not load", check your connection and select
**Reload** to try again.

When the Vetra Code desktop app is running on the same machine, open the current directory in it
from the checkout:

```bash
node apps/server/src/bin.ts app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `vetra app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

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
`~/.vetra-code/wsl-runtime` inside the selected distro. The first launch after installing or updating Vetra
Code may take a little longer while that release's runtime is extracted. Later launches reuse the
Linux-local copy so startup does not depend on reading application files through `/mnt/c`. After a
successful launch, Vetra Code keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, Vetra Code launches from the
application files under `/mnt/c` instead and reinstalls the runtime on the next launch.

## Providers

Vetra Code uses provider runtimes but does not bundle them. Install and authenticate each
provider's CLI, or use Vetra Code's managed setup for Antigravity.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Vetra Code's provider settings.                                                                                      |
| Pi          | Install [Pi](https://pi.dev), then run `pi` once to finish its login or API-key setup.                                                                    |

Provider CLIs must be on the server's `PATH`. If Vetra Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Vetra Code warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when Vetra Code cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with Vetra Code. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
Vetra Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), and [Pi](./providers-pi.md).

Run CLI login commands on the machine running the Vetra Code server, not on the device you browse
from. Antigravity uses its sign-in controls in Vetra Code instead of a CLI login command.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Vetra Code.

Antigravity can use its managed runtime without a `PATH` entry. Its optional **Binary path**
overrides the managed runtime and must point to the official ACP executable.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
Vetra Code. You can install Vetra Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status and setup instructions in **Settings**.

For multi-account setups, see [Codex](./providers-codex.md), [Claude](./providers-claude.md), and
[Antigravity](./providers-antigravity.md#accounts-and-removal).

## Next Steps

- [Permission modes](./permission-modes.md): how much Vetra Code asks before acting
- [Keyboard shortcuts](./keybindings.md)
- [Remote access status](./remote-access.md): connect from a phone, tablet, or another desktop
- [Update status](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
