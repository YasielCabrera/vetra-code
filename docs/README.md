# Vetra Code docs

## Using Vetra Code

- [Install Vetra Code](./user/install.md)
- [First-run setup](./user/welcome-wizard.md)
- [Create a project](./user/creating-projects.md)
- [Browse your projects](./user/browsing-projects.md)
- [Messages and context](./user/composer.md)
- [Organizing threads](./user/thread-sidebar.md)
- [Permission modes](./user/permission-modes.md)
- [Explore project files](./user/file-explorer.md)
- [Terminal history](./user/terminal.md)
- [Source control](./user/source-control.md)
- [Inspect Powerhouse projects](./user/powerhouse-panel.md)
- [Run work on a schedule](./user/automations.md)
- [Project settings](./user/project-settings.md)
- [Appearance and themes](./user/appearance.md)
- [Environment themes](./user/environment-theme.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [Keyboard focus](./user/keyboard-focus.md)
- [SnapShots](./user/snap-shot.md)
- [Review usage](./user/usage.md)
- [Import browser sessions](./user/browser-import.md)
- [Devices and simulators](./user/devices.md)
- [Remote access](./user/remote-access.md)
- [Keeping app and server in sync](./user/updating.md)
- [Preview wallet (Web3)](./user/preview-wallet.md)
- [Background service (Linux)](./user/background-service.md)
- [Product usage data](./user/telemetry.md)
- Providers: [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md) · [Cursor](./user/providers-cursor.md) · [OpenCode](./user/providers-opencode.md) · [Antigravity](./user/providers-antigravity.md)

---

## Working on Vetra Code

Start with the [workspace layout](./internals/workspace-layout.md), [scripts](./internals/scripts.md),
and [contribution policy](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Workspace layout](./internals/workspace-layout.md)
- [Scripts](./internals/scripts.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Providers](./internals/providers.md)
- [Model classification](./internals/model-manifest.md)
- [Provider subscription usage](./internals/provider-subscription-usage.md)
- [Remote environments](./internals/remote.md)
- [Terminal runtime](./internals/terminal-runtime.md)
- [Terminal renderers](./architecture/terminal-renderers.md)
- [Assistant citations](./internals/assistant-citations.md)
- [Preview wallet](./internals/preview-wallet.md)
- [Powerhouse panel](./internals/powerhouse-panel.md)
- [Server updates](./internals/server-updates.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Product analytics](./internals/product-analytics.md)
- [Environment auth](./internals/environment-auth.md)
- [Vetra Connect](./internals/t3-connect.md)
- [Devices](./internals/devices.md)
- [CI gates](./internals/ci.md)
- [Engineering work artifacts](./internals/work-artifacts.md)

### Runbooks

- [Syncing upstream Vetra Code](./internals/upstream-sync.md)
- [Release](./operations/release.md)
- [Observability](./operations/observability.md)
- [Relay observability](./operations/relay-observability.md)
