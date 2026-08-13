# 03 — Safe first run and collision prevention

This phase exists so Vetra Code can be developed while another installed coding-agent client remains in use.

## Source-control isolation

Keep the original repository reachable as an `upstream` remote and do product work on a dedicated
fork/branch. A linked Git worktree is preferable if this checkout must remain available for work on the
legacy upstream repository. Commit the planning folder before creating that worktree so the plan follows the new
branch.

Bringing later T3 Code commits into this fork is a recurring process, not a one-time merge. Follow
[Syncing upstream T3 Code](../docs/internals/upstream-sync.md). Do not raw-merge `upstream/main`.

A linked worktree receives repository-local development state automatically, but an explicit
`--home-dir` is still useful for the first run because the selected path is easy to verify.
Repository-local worktree state outranks an ambient `VETRA_HOME`; an explicit `--home-dir` wins over both.

## What can conflict today

Source edits do not alter another installed application. Runtime and packaging identity can still
collide if development commands use defaults:

- server data in another application's home directory;
- development or production SQLite databases;
- provider settings and saved credentials;
- Electron user-data directories;
- another application's URL protocols;
- application IDs and Linux desktop entries;
- default server/web ports;
- browser local storage when two clients share an origin;
- updater, relay, Clerk, telemetry, and signing configuration.

## Safe Vetra baseline

Identity isolation is now implemented for web and desktop. Install and inspect the resolved
configuration without starting any process:

```bash
pnpm install
pnpm dev --dry-run
```

For the first live web run, keep state explicitly inside this repository:

```bash
pnpm dev --home-dir .vetra-code
```

`.vetra-code` is ignored by Git. The command stores runtime state below
`<repo>/.vetra-code/userdata`, derives Vetra-specific ports, and prints the actual ports.

Before opening the pairing URL, verify that the `[dev-runner]` line contains:

```text
baseDir=<repo>/.vetra-code
```

Stop immediately if it prints a path outside this checkout's `.vetra-code` directory or any path used by another installed app.

Open the full pairing URL printed by the isolated server. Do not open another application's origin or
reuse a pairing token from another server.

### Provider homes are separate from the server home

`--home-dir` isolates the server database and settings, but provider CLIs keep their own state. A
default Codex provider normally uses `~/.codex`; a default Claude provider normally uses Claude's
standard config directory. Running login/logout or sessions against those defaults can still affect
the provider state used by another coding-agent client.

For a fully isolated development provider, create a provider-specific home below the ignored fork
directory and authenticate that home explicitly. For example, choose one of:

```bash
mkdir -p "$PWD/.vetra-code/providers/codex"
CODEX_HOME="$PWD/.vetra-code/providers/codex" codex login
```

```bash
mkdir -p "$PWD/.vetra-code/providers/claude"
CLAUDE_CONFIG_DIR="$PWD/.vetra-code/providers/claude" claude auth login
```

Then configure the isolated server's provider instance to use that exact `CODEX_HOME` or
`CLAUDE_CONFIG_DIR`. Do not use a shadow home that links back to the normal provider home for this
collision test. Do not commit, copy, print, or inspect the resulting credential files.

## Rules during the isolation phase

- Never point a development server at another application's data directory.
- Never copy, move, symlink, migrate, or vacuum another application's database into Vetra Code unless a
  later test plan explicitly requires a read-only-derived fixture.
- Do not copy the installed app's secrets directory.
- Do not run provider login/logout against the normal Codex, Claude, Cursor, or OpenCode home while
  testing isolation.
- Run desktop development only through `pnpm dev:desktop`, which uses the isolated Vetra identity.
- Do not install a generated development artifact over an existing production application.
- Do not use another product's bundle ID, URL protocol, executable name, updater feed, relay,
  Clerk application, telemetry destination, or signing identity.
- Do not set `VITE_HTTP_URL` or `VITE_WS_URL` for normal development.
- Stop only processes started by the current terminal or a port owner whose working directory was
  verified as this checkout. Never kill processes by matching `vetra`, `node`, Electron, or the
  worktree path.

## Desktop identity checklist

Choose these values before running the fork's Electron app:

- product base name;
- lowercase filesystem/package slug;
- development and production URL schemes;
- macOS/Windows application ID;
- Linux desktop entry and WM class;
- CLI executable name;
- development and production user-data directory names;
- default server base directory;
- application icon set;
- artifact filename prefix.

The implementation should consolidate these values into one small shared product-identity module
that can be consumed by runtime and build scripts. Avoid a blind repository-wide text replacement.

The bootstrap audit covered these locations:

- `apps/web/src/branding.ts`
- `apps/desktop/src/app/DesktopEnvironment.ts`
- `apps/desktop/src/app/DesktopEarlyElectronStartup.ts`
- `apps/desktop/src/app/DesktopStatePaths.ts`
- `apps/desktop/src/electron/ElectronProtocol.ts`
- `apps/desktop/scripts/electron-launcher.mjs`
- `apps/desktop/package.json`
- `apps/server/src/cli/config.ts`
- `apps/server/src/config.ts`
- `apps/server/src/os-jank.ts`
- `packages/shared/src/devHome.ts`
- `scripts/dev-runner.ts`
- `scripts/build-desktop-artifact.ts`
- `assets/`

Changing visible text alone is insufficient. The new default data home and Electron user-data path
are the critical collision-prevention changes.

## Configuration isolation

For the first development passes:

- leave Vetra Connect/cloud UI disabled by not copying `.env.example`;
- set auto-update disabled for the desktop fork;
- do not configure telemetry exporters;
- place future fork-owned public configuration in `.env.local`, which remains uncommitted;
- keep provider login inside the isolated environment;
- give local development providers explicit isolated provider homes;
- never import local provider credentials into a managed workspace automatically.

Vetra-owned runtime variables use `VETRA_*`. Do not add aliases for legacy product variables; aliases
would let two products silently share paths, ports, cloud endpoints, update settings, or telemetry.

## Verification before desktop development

With another installed coding-agent client open:

1. Start the fork's web-only command above.
2. Confirm different ports and the exact isolated base directory.
3. Create a disposable project and thread in the fork.
4. Confirm neither item appears in the other client.
5. Stop and restart the fork; confirm its disposable data returns.
6. Quit only the Vetra process; confirm the other client remains connected.
7. After desktop identity changes, repeat the check with `pnpm dev:desktop` and confirm its selected
   home is Vetra-owned.

Desktop development is allowed only after its profile, scheme, and app ID are observably distinct.
