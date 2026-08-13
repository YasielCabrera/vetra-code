# 04 — Initial migration phases

Each phase should land as a coherent change with focused verification. Avoid mixing identity,
application deletion, UI redesign, and cloud infrastructure into one unreviewable change.

## Phase 0 — Capture a clean baseline

### Work

1. Create a dedicated product fork/branch while retaining the original repository as `upstream`.
   Recurring syncs after this step: [Syncing upstream T3 Code](../docs/internals/upstream-sync.md).
2. Install Vite+ and dependencies if needed.
3. Run the web-only isolated command from `03-safe-first-run.md`.
4. Configure one provider with an isolated provider home below `.vetra-code/providers`; do not
   reuse or mutate its normal CLI home for the collision test.
5. Create a disposable project, start one thread, run one turn, inspect a diff, and open a terminal.
6. Record the actual `[dev-runner]` ports and base directory in local notes, not committed config.

### Acceptance

- the existing application works before any source changes;
- provider orchestration, files, Git, terminal, and thread persistence are understood;
- no state belonging to another installed coding-agent client changes;
- no browser or desktop automation is required for this milestone unless explicitly requested.

## Phase 1 — Establish fork identity

### Work

1. Pick product identity values from the checklist in `03-safe-first-run.md`.
2. Add one shared product-identity module for runtime and packaging constants.
3. Replace default server data home, Electron user-data directories, application IDs, protocols,
   desktop entries, executable/artifact names, and visible branding.
4. Replace icons with temporary fork-specific assets if final artwork is unavailable.
5. Disable auto-update, Vetra-owned cloud configuration, and telemetry by default.
6. Update identity-focused tests alongside implementation.

### Acceptance

- web and desktop processes can run alongside another installed coding-agent client;
- the fork has separate server state and Electron browser profile;
- the fork cannot claim another product's URL protocols;
- packaging cannot overwrite or auto-update another installed application;
- all changed identity derivations have focused tests.

Historical database event names should change only through an explicit compatibility migration.
Runtime environment variables and internal package scopes use Vetra-owned names so ambient configuration
and dependency metadata cannot cross product boundaries.

## Phase 2 — Remove mobile and marketing cleanly

Deletion must include their build and maintenance surfaces, not just their directories.

### Remove

- `apps/mobile/`
- `apps/marketing/`
- mobile showcase and native-static-check scripts/tests;
- mobile-only CI workflows and CI jobs;
- mobile store screenshot documentation;
- root scripts for mobile screenshots/lint and marketing dev/build/start;
- release-smoke expectations for mobile and marketing packages;
- mobile-specific formatting/lint ignores;
- mobile-only dependencies, catalogs, patches, and lockfile entries after dependency installation;
- issue-template surface choices that no longer exist.

### Update

- `AGENTS.md` multi-surface instructions to name web and desktop only;
- `docs/internals/overview.md`;
- `docs/internals/workspace-layout.md`;
- `docs/internals/connection-runtime.md`;
- `docs/internals/scripts.md`;
- `docs/internals/ci.md`;
- `docs/README.md`;
- root `package.json`;
- root `vite.config.ts`;
- release and CI scripts.

`packages/client-runtime` remains even though mobile is removed. It still provides the deep
connection/state module used by the web renderer in both browser and desktop.

### Verification

Run focused checks, not the repository-wide suite:

```bash
pnpm install
pnpm exec vp run --filter @vetra-code/contracts typecheck
pnpm exec vp run --filter @vetra-code/client-runtime typecheck
pnpm exec vp run --filter @vetra-code/web typecheck
pnpm exec vp run --filter @vetra-code/desktop typecheck
pnpm exec vp run --filter @vetra-code/server typecheck
```

Also run the focused tests for files changed during identity work and a web/server build that proves
deleted packages are no longer expected. Regenerate the lockfile through the normal install; do not
edit it manually.

## Phase 3 — Introduce the builder shell

### Work

1. Preserve the current route and thread model.
2. Recompose the authenticated application shell into project navigation, agent activity, and
   workbench panes.
3. Reuse existing chat, approvals, tool activity, files, diffs, terminal, provider selection, and
   settings modules.
4. Add Preview/Code workbench tabs without changing provider or orchestration contracts.
5. Show Run and Publish affordances only as honest states; Publish remains disabled or hidden.
6. Keep the existing responsive sidebar behavior where it is useful.

### Acceptance

- one existing local thread can be completed through the new shell;
- approvals and user-input requests remain visible and actionable;
- file/diff/terminal surfaces still use existing state rather than duplicate fetches;
- web and desktop render the same shell;
- no continuously repainting decorative animation is added;
- routing and large-list rendering do not regress.

## Phase 4 — Prove managed execution

Build the smallest vertical proof described in `06-cloud-execution.md`:

1. create one isolated disposable managed workspace;
2. start the existing server inside it with its own volume and base directory;
3. create one repository-backed project;
4. authenticate one provider using an explicit cloud-safe flow;
5. connect the hosted browser over HTTPS/WSS;
6. run one agent turn and observe the diff;
7. start one development process and render its preview through a routed HTTPS origin;
8. stop and restart the workspace without losing project/thread state;
9. delete the proof and confirm no local state is affected.

This proof should happen before a large project dashboard, billing system, template catalog, or
deployment product is built.

## Phase 5 — Integrate managed lifecycle into the UI

Only after Phase 4 works:

- add project creation backed by the control plane;
- display create/start/wake/stop/failure lifecycle states;
- teach the connection supervisor how a managed environment becomes reachable;
- add the hosted preview adapter;
- add provider authentication onboarding for managed environments;
- retain manual/local environment creation as a separate path.
