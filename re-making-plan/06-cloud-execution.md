# 06 — Managed cloud execution

## Goal of the first proof

Prove that the existing execution runtime can operate as the engine of an isolated hosted builder.
The proof is successful only if a user can create source, run an agent, retain a thread, run the
generated application, and see its preview without a local computer.

It is not a production launch.

## Proof topology

```text
Hosted browser
  |
  +-- HTTPS/WSS --> existing server in disposable managed workspace
  |
  +-- HTTPS ------> preview gateway --> project dev-server port

Control-plane proof
  |
  +-- create/wake/stop/delete managed workspace
  +-- issue or broker environment connection bootstrap

Managed workspace
  +-- persistent source/state volume
  +-- existing server
  +-- one provider CLI
  +-- Git and language/toolchain basics
  +-- project development process
```

## Step 1 — Build a local managed-workspace harness

Use disposable local container or VM isolation to iterate on the runtime contract before choosing a
production cloud vendor.

The runtime image should contain only what the proof needs:

- compatible Node.js;
- Git and basic shell tools;
- the built server artifact;
- one provider CLI;
- package managers/toolchains needed by the chosen starter application;
- a non-root runtime user;
- an explicit writable source/state mount.

Do not mount the host's home directory, SSH directory, Git credential store, another application's data directory, or provider
credential directories. Use generated proof credentials and disposable volumes.

Acceptance:

- create, start, health-check, stop, restart, and delete are deterministic;
- source and threads survive stop/restart;
- delete removes only the exact proof workspace;
- the server cannot access host paths outside its mounts;
- runtime logs identify the managed workspace without exposing credentials.

## Step 2 — Start the existing server unchanged

Inside the managed workspace:

- assign a unique server base directory on the persistent volume;
- bind the server only to the workspace network interface expected by the gateway;
- create or clone one repository below the project mount;
- add that repository as a normal project;
- use the existing pairing/session and WebSocket ticket behavior.

Do not add a `cloudMode` branch to orchestration. If the server requires a cloud-specific filesystem
or subprocess change, first ask whether container isolation can satisfy the invariant without an
application branch.

## Step 3 — Prove one provider

Choose one provider for the first proof. Codex or Claude are the likely candidates because the
current adapters are mature, but the choice must be explicit.

The proof must answer:

- Does the provider's subscription/authentication flow permit use in a hosted, user-isolated
  runtime?
- Can login complete without a browser on the runtime itself?
- Which files or tokens are produced?
- Can credentials be mounted or restored without copying a user's local credentials?
- What happens when credentials expire while a thread is active?
- Can two workspaces use the same account concurrently?
- What terms, rate limits, or product restrictions affect this usage model?

Provider credentials must not be baked into images, committed to source, written to the control-plane
database in plaintext, returned through client RPC, or included in workspace snapshots.

After one provider works, run an adapter matrix for Codex, Claude, Cursor, and OpenCode. The existing
provider interface should make this mostly an image/authentication exercise.

## Step 4 — Add HTTPS/WSS routing

The hosted browser requires a secure endpoint. The routing layer must:

- map an authenticated project/workspace identity to one running environment;
- support WebSocket upgrades;
- preserve streaming and backpressure;
- reject cross-workspace access;
- health-check before returning a reachable descriptor;
- avoid exposing infrastructure identifiers as authorization;
- keep one-time credentials out of query strings and access logs.

The first proof can use the existing bearer pairing flow. A polished managed connection target comes
after wake/reconnect semantics are known.

## Step 5 — Add preview routing

Do not expose arbitrary managed-workspace ports directly to the internet.

The preview gateway needs:

- an allowlisted or runtime-registered port for the project's development process;
- a stable HTTPS origin scoped to the workspace/project;
- WebSocket proxy support for development HMR;
- authentication at the gateway without injecting environment credentials into project requests;
- isolation of cookies and browser storage between projects;
- start/ready/failure state that the client can observe;
- request and bandwidth limits appropriate for untrusted generated applications.

The hosted preview adapter renders this origin in a sandboxed iframe.

## Step 6 — Prove lifecycle and persistence

Required scenario:

1. Create a managed project.
2. Authenticate the selected provider.
3. Ask the provider to generate a small full-stack application.
4. Inspect its files and diff.
5. Start the development process and load preview.
6. Stop the managed workspace.
7. Wake it from a fresh hosted-client session.
8. Confirm source, Git state, thread history, and provider configuration remain valid.
9. Delete the workspace and confirm its endpoint, volume, and credentials are no longer reachable.

Use receipts, lifecycle events, and process readiness signals. Do not make integration tests pass by
sleeping for arbitrary durations.

## Control-plane minimum

The proof control plane needs only:

- user authentication;
- project ID and display metadata;
- managed workspace ID and lifecycle state;
- create, ensure-running, stop, and delete commands;
- connection bootstrap issuance;
- encrypted credential references;
- an audit trail for destructive lifecycle actions.

It does not need billing, organizations, invitations, template marketplace, deployment records,
analytics dashboards, or provider token usage accounting.

## Production questions deliberately left open

- compute vendor and isolation primitive;
- database and durable queue choices;
- regional placement;
- idle timeout and wake latency target;
- volume snapshots and backups;
- secret manager;
- per-user versus per-project credential storage;
- egress policy and abuse prevention;
- resource limits and billing;
- deployment target;
- source repository hosting and ownership.

Select these after the local managed-workspace proof measures image size, boot time, idle memory,
disk growth, WebSocket behavior, preview routing, and provider authentication constraints.
