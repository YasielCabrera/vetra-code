# 08 — Bootstrap progress and handoff

This records the first completed implementation checkpoint. It is the starting point for the Vetra
Studio builder UI, not a claim that managed cloud execution or publishing is complete.

## Completed

| Area                  | Vetra Code identity or result                                                  |
| --------------------- | ------------------------------------------------------------------------------ |
| Product and CLI       | `Vetra Code`, `vetra`, `@vetra-code/server`                                    |
| Runtime data          | `~/.vetra-code`; optional repository-local `.vetra-code`                       |
| Ports                 | production server `4873`; development starts at server `14873`, web `6733`     |
| Desktop               | `com.vetra.code`, `com.vetra.code.dev`, `vetra://`, `vetra-dev://`             |
| Browser state         | Vetra-specific local storage, IndexedDB, events, and preview partitions        |
| Environment           | Vetra-owned runtime settings use `VETRA_*`                                     |
| Package namespace     | all 14 workspace packages use `@vetra-code/*`                                  |
| Git state             | checkpoints and support refs live below `refs/vetra/*`                         |
| Project config        | `vetra.json` and `.vetra/vcs.json`                                             |
| Removed surfaces      | `apps/mobile`, `apps/marketing`, their workflows, scripts, patches, and skills |
| Production automation | inherited release and relay-deploy workflows removed                           |
| Source control        | local branch `vetra-code`; original repository retained as `upstream`          |

The root `vetra.json` configures Vetra Code's worktree setup and shared project scripts.

## Safe first run

```bash
pnpm install
pnpm dev --dry-run
pnpm dev --home-dir .vetra-code
```

The dry run must report a Vetra directory and Vetra ports before a live process is started. The live
server prints a one-time `pairingUrl`; open the complete URL, including its token.

Desktop development uses:

```bash
pnpm dev:desktop
```

Do not set `VITE_HTTP_URL` or `VITE_WS_URL` for ordinary web development. Do not point `VETRA_HOME`
at another application's data directory or copy provider credentials into a managed workspace.

## Verification completed

- dependency installation and lockfile regeneration completed for 14 workspace projects;
- development dry run resolved `serverPort=14873`, `webPort=6733`, and
  `baseDir=~/.vetra-code` without starting a server;
- focused typechecks passed for all 13 packages with a typecheck task, including both provider
  protocol packages and the custom lint plugin;
- server/web and desktop production builds passed;
- the focused namespace, project-config, remote-auth, credentials, telemetry, SSH, preview, desktop,
  and lint-plugin batch passed (`263/263`);
- the final focused identity, auth-cookie, relay-wire, configuration, pairing, VCS, telemetry,
  preview, desktop-backend, and packaging batch passed (`315/315`);
- local release smoke checks passed without publishing or deploying;
- the full server test file passed (`124/124`).

No browser was opened and no process was started against another application's data directory during this checkpoint.

## Deliberately deferred

- the three-pane builder UI and project-creation experience;
- managed workspace provisioning, wake/sleep, preview routing, and durable cloud storage;
- Vetra-owned Clerk, relay, hosted domain, telemetry, signing, and updater infrastructure;
- package publishing, background-service installation, and package-based SSH launch;
- mobile push modules still inherited inside the relay implementation;
- final icons and platform store assets;
- compatibility migration of historical database event names;
- custom provider harnesses beyond the adapters already present.

## Next implementation task

Begin Phase 3 with a UI inventory, then recompose the existing renderer into project navigation,
agent activity, and Preview/Code workbench panes. Keep provider and orchestration contracts stable,
and preserve approvals, files, diffs, terminal, Git, settings, and checkpoints as the shell changes.
