# 02 — Target architecture

## System shape

```text
                         +--------------------------+
                         | Product control plane    |
                         | identity and membership  |
                         | project metadata         |
                         | managed workspace state  |
                         | credential references    |
                         +------------+-------------+
                                      |
                           create / wake / stop
                                      |
+------------------+       +----------v-----------+
| Web renderer     |       | Managed workspace    |
| or desktop UI    +------>| isolated compute     |
|                  | HTTPS | persistent volume    |
| existing client  |  WSS  | existing Vetra-derived |
| runtime          |       | server and providers |
+--------+---------+       +----------+-----------+
         |                            |
         | local mode                 +-- project source and Git
         v                            +-- dev server / preview
+--------------------+                +-- provider CLI processes
| Local environment  |
| existing desktop   |
| or CLI server      |
+--------------------+
```

The product control plane does not replace the execution environment. Its job is to allocate and
locate managed environments. Agent turns continue through the existing environment RPC seam.

## Modules and seams

### 1. Execution environment

**Existing interface**: the HTTP/WebSocket contracts in `packages/contracts`, consumed through
`packages/client-runtime`.

**Implementation**: `apps/server` with provider adapters, orchestration, Git, terminal, and files.

**Decision**: preserve this module for both local and managed modes. Cloud-specific allocation must
not be added to provider adapters or orchestration commands.

### 2. Managed workspace lifecycle

**New interface**: a small lifecycle module owned by the control plane.

The initial interface should express outcomes, not infrastructure:

```ts
interface ManagedWorkspaceLifecycle {
  create(input: CreateManagedWorkspace): Promise<ManagedWorkspaceDescriptor>;
  ensureRunning(workspaceId: WorkspaceId): Promise<ReachableManagedWorkspace>;
  stop(workspaceId: WorkspaceId): Promise<void>;
}
```

`ReachableManagedWorkspace` should expose a stable workspace identity, lifecycle state, compatible
environment descriptor, and an authenticated connection bootstrap. It should not expose container
IDs, Kubernetes pods, VM names, or volume paths.

There will eventually be two real adapters at this seam:

- a disposable local-container adapter used for development and integration tests;
- the selected production cloud-compute adapter.

Do not select the production adapter through React or server-wide conditionals.

### 3. Managed connection bootstrap

The first proof can reuse a `BearerConnectionTarget` and the server's one-time pairing/session
mechanism over HTTPS/WSS. Once managed lifecycle needs transparent wake/reconnect behavior, add a
managed target to the client connection model rather than teaching every screen how to provision a
workspace.

Requirements:

- no long-lived token in URL query parameters;
- WebSockets continue to use short-lived tickets;
- the hosted browser never receives a provider credential;
- control-plane identity and execution-environment authorization remain distinct;
- reconnect can wake a sleeping managed workspace without creating a second project.

### 4. Preview surface

Preview already varies by platform, so this is a real seam.

```text
Preview surface interface
  +-- Electron adapter: current isolated WebContentsView/webview behavior
  +-- Hosted adapter: sandboxed iframe pointed at a managed preview gateway
```

The common interface should cover current location, navigation/reload, runtime status, opening in a
new browser, and error state. Desktop-only automation and recording can remain optional capabilities
instead of becoming requirements for the hosted adapter.

### 5. Development process

The builder needs a durable notion of the process that produces a preview. Raw terminal tabs are not
enough for reliable Run/Stop/Restart UI.

A future `ProjectDevProcess` module should hide command choice, process ownership, port discovery,
restart, logs, and readiness behind a small interface. Its first implementation can use the existing
terminal/process machinery. Do not add this module until the cloud proof demonstrates what lifecycle
facts the UI actually needs.

### 6. Provider credentials

Provider credentials belong inside the trusted execution environment and must never be delivered to
the browser. A managed workspace may receive them through an encrypted secret mount or a
provider-specific login flow.

The provider driver interface remains unchanged. Credential installation is managed-workspace
bootstrap behavior.

## Data ownership

| Data                                              | Initial owner                                        |
| ------------------------------------------------- | ---------------------------------------------------- |
| User identity and membership                      | Control plane                                        |
| Project display metadata and managed workspace ID | Control plane                                        |
| Managed workspace lifecycle state                 | Control plane                                        |
| Source repository and working tree                | Managed workspace persistent volume                  |
| Threads and orchestration event store             | Existing server state in the workspace volume        |
| Git checkpoints                                   | Existing server/workspace Git storage                |
| Provider credentials                              | Encrypted secret storage, mounted into the workspace |
| Client preferences and known local environments   | Existing client/desktop storage                      |
| Preview process and logs                          | Execution environment                                |
| Deployment records                                | Deferred deployment module                           |

Do not duplicate thread state in the control plane during the first release. It would create two
authors for the same read model and weaken the existing event-sourced module.

## Initial managed isolation model

Use one managed workspace per project for the first proof and first private release. This is not the
cheapest possible model, but it creates unsurprising filesystem, process, port, and credential
isolation.

Each workspace needs:

- an immutable runtime image;
- a persistent volume for source and execution-environment state;
- CPU, memory, process, and storage limits;
- an HTTPS/WSS route to the existing server;
- a separate HTTPS route for the project preview;
- outbound network policy;
- secret injection that does not bake credentials into the image or volume snapshot;
- stop and delete semantics that are explicit and different.

Cost optimization through sleep, image snapshots, shared pools, or per-user runtimes comes only after
the one-project model works and its measurements are known.

## Local and managed equivalence

The following behavior should be equivalent across execution modes:

- create/select a project;
- create/select a thread;
- start, interrupt, and continue a provider turn;
- respond to approvals and user-input requests;
- inspect files, diffs, Git status, and terminals;
- view provider availability and authentication state;
- start or connect to a preview.

Only lifecycle and platform affordances differ:

- desktop can pick local folders and manage its local server;
- managed mode creates/wakes cloud compute and cannot open arbitrary client-local paths;
- desktop preview can use Electron capabilities;
- hosted preview uses a routed, sandboxed web origin.
