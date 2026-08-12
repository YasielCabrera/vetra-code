# Building Vetra Studio from an established agent-runtime foundation

This folder is the implementation plan for turning the existing agent-runtime foundation into a web and desktop
application builder. The intended product lets a user create and operate a full-stack application
with their existing Codex, Claude, Cursor, OpenCode, or other supported provider subscription.

The first release must support two execution modes:

- **Local**: the desktop app or CLI runs the existing execution runtime on the user's computer.
- **Managed**: the hosted web app connects to an isolated cloud runtime, so no user computer needs
  to be online.

The provider adapters, event-sourced orchestration, threads, approvals, checkpoints, Git, terminal,
filesystem, and remote connection model are foundations to preserve. The mobile and marketing apps
are out of scope and can be removed.

## The central architectural choice

Do not turn the current server into a large, shared multi-tenant process. Run the existing server
inside an isolated managed workspace and put a small control plane in front of managed workspaces.
This preserves the server's strongest existing interface: one execution environment owns its
filesystem, provider processes, terminals, Git state, and threads.

```text
Web or desktop client
        |
        | existing typed HTTP/WebSocket connection
        v
Execution environment
  - local Vetra server, or
  - isolated managed cloud workspace running the same server
        |
        +-- provider CLIs and credentials
        +-- project source and Git
        +-- dev server and preview process
```

Managed workspace creation, wake/sleep, routing, secrets, and durable allocation belong outside the
execution runtime. That keeps cloud infrastructure complexity from leaking into provider
orchestration or the UI.

## Plan order

1. [Foundation and scope](./01-foundation-and-scope.md)
2. [Target architecture](./02-target-architecture.md)
3. [Safe first run](./03-safe-first-run.md)
4. [Initial migration phases](./04-initial-migration.md)
5. [Builder workspace UI](./05-builder-ui.md)
6. [Managed cloud execution](./06-cloud-execution.md)
7. [Ordered backlog and decisions](./07-backlog-and-decisions.md)
8. [Domain language](./CONTEXT.md)
9. [Bootstrap progress and handoff](./08-bootstrap-progress.md)

## Current checkpoint

The fork-isolation and repository-cleanup checkpoint is complete. Vetra now has separate runtime,
desktop, browser-storage, protocol, port, environment-variable, and Git-ref identities; mobile and
marketing are removed; inherited production deployment workflows are disabled. See
[Bootstrap progress and handoff](./08-bootstrap-progress.md) for the exact verified commands and the
remaining boundaries before UI work starts.

## First milestone

The first milestone is intentionally smaller than the whole product:

- the fork has its own name, storage paths, URL schemes, application IDs, ports, and icons;
- it can run beside another installed or development coding-agent client without sharing state;
- mobile and marketing code no longer participate in installation, build, test, or CI;
- the web renderer has the first three-pane builder shell while retaining existing agent behavior;
- local provider-backed threads, approvals, Git changes, files, diffs, and terminals still work;
- managed execution is documented behind a stable module seam and proven with one disposable
  workspace and one provider before production infrastructure is selected.

## Explicit non-goals for the first milestone

- custom agent harnesses;
- production billing or usage metering;
- multiplayer editing;
- a complete VS Code replacement;
- one-click production publishing;
- automatic synchronization of the same project between local and managed environments;
- a production-grade scheduler that can scale to many tenants;
- a broad rewrite of historical database events.

## Definition of success

The milestone is complete when all of the following are true:

1. Another installed coding-agent client can stay open while Vetra Studio runs.
2. Neither process reads or writes the other's SQLite database, settings, credentials, logs,
   desktop profile, URL protocol, or ports.
3. The same React renderer provides the builder UI in the browser and Electron.
4. Existing provider adapters run without product-specific forks in their orchestration path.
5. A managed-workspace proof can create a repository, start the existing server, run one supported
   provider, stream a turn to the hosted browser, and expose a preview over HTTPS.
6. Removing the proof's managed runtime does not affect any local project or another installed client's
   data.
