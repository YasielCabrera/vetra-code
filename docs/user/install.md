# Install and first run

Vetra Studio is currently available as a source checkout. Packaged desktop releases and a published
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
pnpm dev --home-dir .vetra-studio
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

## Next steps

- [Permission modes](./permission-modes.md)
- [Keyboard shortcuts](./keybindings.md)
- [Remote access status](./remote-access.md)
- [Update status](./updating.md)
