# Vetra Code

Vetra Code is a web and desktop workspace for building full-stack applications with coding agents. It preserves the established bring-your-own-subscription runtime—Codex, Claude Code, Cursor, Grok, OpenCode, and Antigravity adapters; event-sourced orchestration; terminals; Git; files; previews; and checkpoints—while the product and builder experience evolve independently.

This repository is an early fork foundation. The marketing and mobile applications have been removed. Cloud execution and custom harnesses are planned, but the first runnable milestone is intentionally local web + desktop.

Vetra Code works with your existing subscriptions. If a provider is set up on your computer, Vetra Code can drive it.

## Safe local development

Vetra Code can run alongside other coding-agent clients. Its defaults are deliberately isolated:

| Resource              | Vetra Code                                 |
| --------------------- | ------------------------------------------ |
| Runtime data          | `~/.vetra-code`                            |
| Server port           | `4873`                                     |
| Dev server/web ports  | start at `14873` / `6733`                  |
| Desktop protocol      | `vetra://` (`vetra-dev://` in development) |
| Desktop app ID        | `com.vetra.code`                           |
| Environment variables | `VETRA_*`                                  |
| Git checkpoints       | `refs/vetra/checkpoints/*`                 |

Vetra Code runtime state is isolated under `~/.vetra-code` by default. Never point `VETRA_HOME` at another application's data directory.

## Prerequisites

- Node.js `24.13.1` or a compatible version from `package.json`
- pnpm `11.10.0`
- At least one installed and authenticated provider:
  - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
  - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
  - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
  - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
  - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
  - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

Install dependencies. Vite+ is a workspace dependency, so a global `vp` installation is not
required:

```bash
pnpm install
```

No `.env` file is required for local development. The optional values in `.env.example` are only for infrastructure you own.

## Run the web app

```bash
pnpm dev
```

Read the actual URLs and ports from the `[dev-runner]` line. Open the full `pairingUrl` printed by the server, including its token; the bare origin is not enough for a first connection.

To keep this checkout's data inside the repository instead of `~/.vetra-code`, use:

```bash
pnpm dev --home-dir .vetra-code
```

Linked Git worktrees already default to their own gitignored `.vetra-code` directory.

## Run the desktop app

In a second development session, or instead of web mode:

Stable:

```bash
pnpm dev:desktop
```

Desktop development uses the same isolated Vetra identity and a separate `vetra-code-dev` Electron user-data directory.

To verify the resolved state directory and ports without starting any process:

```bash
pnpm dev --dry-run
```

## Current boundaries

- Local web and desktop are the supported first milestone.
- Cloud/relay configuration is disabled when Vetra-owned Clerk and relay values are absent.
- Desktop auto-update is disabled unless `VETRA_ENABLE_AUTO_UPDATE=true` and a Vetra release repository is configured.
- Product analytics are off: `VETRA_TELEMETRY_ENABLED` defaults to false and no analytics project key ships, so nothing is sent unless you configure your own.
- The `t3` package is private during bootstrap, so registry installation, background-service installation, and package-based SSH launch are not release-ready yet.
- Internal workspace packages keep upstream's `@t3tools/*` scope so merges from `pingdotgg/t3code` stay mechanical. Vetra-owned naming lives in [productIdentity.ts](packages/shared/src/productIdentity.ts), and the `@vetra-code/*` scope is reserved for names we would publish.

## Planning and architecture

- [Remaking plan](./re-making-plan/README.md)
- [Bootstrap progress and handoff](./re-making-plan/08-bootstrap-progress.md)
- [Architecture overview](./docs/internals/overview.md)
- [Workspace layout](./docs/internals/workspace-layout.md)
- [Syncing upstream Vetra Code](./docs/internals/upstream-sync.md)
- [Contributing](./CONTRIBUTING.md)

## Origin and license

Vetra Code began as an open-source fork. The original copyright notice and MIT terms remain in [LICENSE](./LICENSE) while the product evolves independently.
