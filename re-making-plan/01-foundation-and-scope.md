# 01 — Foundation and scope

## What should remain

The most valuable part of this repository is not the current visual design. It is the deep execution
module behind the typed client/server seam.

| Foundation                             | Location                          | Decision                           |
| -------------------------------------- | --------------------------------- | ---------------------------------- |
| Typed RPC and schemas                  | `packages/contracts`              | Keep and extend carefully          |
| Client connection and state runtime    | `packages/client-runtime`         | Keep for web/desktop               |
| Event-sourced orchestration            | `apps/server/src/orchestration`   | Keep                               |
| Provider driver seam                   | `apps/server/src/provider`        | Keep unchanged initially           |
| Provider adapters                      | `apps/server/src/provider/Layers` | Keep                               |
| Checkpoints, Git, files, terminal      | `apps/server/src`                 | Keep                               |
| React renderer                         | `apps/web`                        | Reshape into the builder workspace |
| Electron security and IPC shell        | `apps/desktop`                    | Keep; rebrand and prune later      |
| Direct, bearer, relay, SSH connections | client runtime and server         | Keep local/remote compatibility    |
| Mobile client                          | `apps/mobile`                     | Remove                             |
| Marketing site                         | `apps/marketing`                  | Remove                             |

The current hosted app is only a static client. It can connect to a reachable Vetra server, but it does
not create cloud compute, store server-side project metadata, proxy application traffic, or keep a
workspace alive. Managed execution is therefore a new product capability, not a switch that can be
enabled in the existing hosted app.

## Why the existing execution model fits

The current execution environment already owns exactly the processes and data a builder workspace
needs:

- provider discovery, configuration, authentication, and subprocesses;
- project directories and Git operations;
- threads and durable orchestration events;
- approvals and user-input requests;
- checkpoints and diffs;
- filesystem reads;
- terminals and long-lived processes;
- HTTP/WebSocket authentication.

Putting that server inside isolated cloud compute reuses the behavior rather than recreating it in a
new centralized backend.

## Scope rules

### Preserve the provider seam

Clients continue to dispatch orchestration commands. They must not call Codex, Claude, Cursor, or
OpenCode directly. Managed execution changes where a provider adapter runs, not how orchestration
talks to it.

Custom harnesses are deferred. When they arrive, they should be new provider drivers and adapters,
not conditionals spread through orchestration or React.

### Preserve one renderer

`apps/web/src/main.tsx` already selects browser history for web and hash history for Electron. The
desktop app loads the same renderer and contributes native behavior through `window.desktopBridge`.
The builder workspace must remain one renderer with platform adapters at actual seams.

### Do not make cloud logic a React concern

React should render a managed environment's lifecycle state and request create/wake/stop actions.
It should not know container vendors, cluster identifiers, volume paths, or provider secret formats.

### Keep a project in one environment initially

The current `Project` is environment-local. Preserve that invariant for the first release. A local
clone and a managed clone of the same repository are separate projects, even if repository identity
allows the UI to recognize that they are related.

Automatic migration and live synchronization between local and cloud projects are later features.
Git remains the explicit transport in the first release.

## Capabilities to prune, hide, or defer

Pruning should follow proven product behavior, not precede it.

| Capability                             | Initial treatment                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Legacy branding and IDs                | Replace before desktop development or packaging                                 |
| Vetra Connect production configuration | Leave disabled; do not reuse production identifiers                             |
| Existing relay                         | Keep until managed connectivity is proven; do not treat it as cloud compute     |
| SSH and Tailscale                      | Keep initially for local/remote compatibility; reconsider after first milestone |
| Auto-update                            | Disable until the fork owns update infrastructure and signing                   |
| Telemetry                              | Disable or point only to fork-owned infrastructure                              |
| Pull-request UI                        | Keep if GitHub workflows are part of the builder; otherwise prune later         |
| Desktop embedded browser preview       | Keep as one preview adapter                                                     |
| Mobile and marketing                   | Remove in the first cleanup phase                                               |
| Publish button                         | Render disabled or hide until a deployment module exists                        |

## Repository areas that will change first

- product identity and runtime state derivation;
- root workspace scripts and CI after removing mobile/marketing;
- `apps/web/src/routes`, `AppRoot.tsx`, and the application layout;
- preview state, so desktop webviews and hosted iframe previews share one interface;
- managed workspace contracts and a new control-plane app after the local shell remains green.

## Repository areas that should not change first

- provider adapter behavior;
- orchestration event semantics;
- checkpoint logic;
- terminal implementation;
- Git driver behavior;
- wire protocol naming solely for cosmetic rebranding;
- historical database event names without an explicit compatibility migration.

Internal packages and runtime environment variables use the Vetra-owned `@vetra-studio/*` and
`VETRA_*` namespaces.
