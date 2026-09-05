# Connection runtime

> For maintainers. Using Vetra Code? See [docs/user](../user/).

The connection runtime is used by the web renderer and desktop shell. It owns connectivity,
authentication, retries, transport lifetime, cached environment data, and
environment-scoped operations.

The web renderer mounts this runtime once at the application root. Desktop hosts
the same renderer and supplies its connection catalog through Electron IPC.
There is no legacy connection owner or supported mixed mode.

Foregrounding needs different treatment depending on the connection's state.
It wakes a retry immediately, leaves an ordinary in-flight attempt alone, and
probes an established session before replacing it. A long mobile background
suspension forces replacement because the OS can kill a socket without reporting
closure. Treating every foreground event as a reconnect delays healthy attempts;
treating every resume as harmless leaves suspended sockets stuck.

The [registry](../../packages/client-runtime/src/connection/registry.ts) scopes
connections by environment. An involuntary disconnect retains the registration
and cached data. Explicit removal closes the scope and clears credentials,
projections, and platform-owned state such as drafts. Cloud-account changes apply
to relay registrations; they must not discard directly paired environments.

## HTTP authorization

RPC sessions authenticate at socket upgrade, while HTTP requests need current
credentials from the
[authorization service](../../packages/client-runtime/src/authorization/service.ts).
Replacing a healthy socket for HTTP renewal would interrupt conversations and
change the transport generation without a transport failure. Credential expiry
does not close the socket, and refresh failure belongs to the HTTP operation.

Session listings must retain unrevoked connected sessions after credential expiry
so an open connection does not disappear from connection management. This does
not extend the credential's lifetime. New HTTP requests and socket upgrades still
require valid credentials.

## Transport health and data freshness are separate

A socket opening is insufficient evidence that the environment is usable. The
[RPC session](../../packages/client-runtime/src/rpc/session.ts) waits for the
initial server configuration before becoming ready. Shell and thread data then
have their own synchronization state. A failed shell subscription can coexist
with a healthy connection; labeling that state "reconnecting" promises a
transport retry that will never happen.

Cached projections remain readable offline. They must neither imply a live
connection nor overwrite newer live data during a reconnect. Loading and
resuming snapshots belongs to the shared state services, so every view agrees
on which data is current.

[Thread detail](../../packages/client-runtime/src/state/threads.ts) separates
subscription lifetime from cache lifetime. Mounted consumers share one live
stream, which stops when the last consumer unmounts; hidden mounted routes still
count. A registry-local cache retains state and its replay cursor for five idle
minutes so back navigation can resume without another snapshot download.

Retain state and cursor together only after an update finishes. Cancellation must
not advance the cached cursor beyond the applied data, and an old scope must not
overwrite its successor's cache. Preserve pagination data on reuse, but clear
canceled loading state.

- During establishment, `waitForEstablishmentInterrupt` consumes and **ignores**
  plain application activation. Restarting an in-flight attempt because the app
  came to the foreground would only delay it. The exception is
  `application-active-reconnect`, which mobile emits after a meaningful
  background suspension; it interrupts establishment and resets the retry
  ladder, because the OS may have silently killed the socket underneath the
  attempt.
- Credential changes interrupt establishment only for relay targets, where a new
  credential changes what is being established.
- Explicit disconnect, explicit retry, and going offline interrupt establishment
  in every case.
- While waiting out backoff, application activation resets the retry ladder so a
  foregrounded app reconnects immediately instead of serving the remaining
  delay.
- Once connected, `monitorConnectedLease` handles plain activation by probing
  the existing session (`lease.session.probe`, with a shorter timeout for
  mobile's `application-active-probe`) rather than reconnecting; a healthy
  session survives foregrounding. `application-active-reconnect` skips the probe
  and replaces the lease outright.

The UI derives `available`, `offline`, `connecting`, `reconnecting`,
`connected`, and `error` from supervisor state plus explicit data-sync state.
It does not infer connection health from cached data or the existence of a
transport object. An environment becomes `connected` after the socket opens and
the initial config RPC succeeds, proving that the server is responsive. Shell
and thread synchronization are independent data states. A healthy RPC transport
with a failed shell subscription is shown as connected with a synchronization
error, not as a reconnect that is not actually scheduled.

## Data Boundary

Finite requests, durable subscriptions, and commands are separate APIs:

- Query atoms revalidate when the RPC generation changes.
- Subscription atoms switch to replacement sessions.
- Subscription failure handling in [rpc/client.ts][client] distinguishes two
  cases. A transport failure (`isTransportFailure`: every failure is an RPC
  client error) ends the inner subscription without resubscribing, so the outer
  stream waits for the supervisor to supply a replacement session. A handled
  domain failure runs `onExpectedFailure` and, when
  `retryExpectedFailureAfter` is set, sleeps and resubscribes on the **same**
  session. A healthy transport is never torn down for a domain failure.
- Mutations resolve the current environment runtime at execution time.
- Shell and thread snapshots are available while offline.
- Sync status is explicit and independent per domain. Shell status is `empty`,
  `cached`, `synchronizing`, or `live`, with a separate `error` field; there is
  no `failed` status. Thread status adds `deleted`.
- Cached shell and thread projections are never allowed to overwrite newer live
  data during a fast reconnect.
- Domain atom factories route effects through the environment registry and
  resolve the current scoped service at execution time. Project and thread
  commands are Atom factories under `src/state`
  (`createProjectEnvironmentAtoms`, `createThreadEnvironmentAtoms`), as are the
  shell and thread state factories (`createEnvironmentShellAtoms`,
  `createEnvironmentThreadStateAtoms`).
- The web renderer owns its Atom runtime, React hooks, and feature composition.

The Promise bridge exists only at the React/Atom boundary. Runtime and business
logic remain Effect-native.

## Platform Layers

The web renderer provides:

- network status and network-change streams;
- application lifecycle wakeups;
- cloud session credentials;
- device identity;
- platform registrations;
- persistent catalog, credential, shell, and thread stores;
- HTTP, crypto, and telemetry layers.

Platform layers adapt operating-system capabilities. They do not implement
connection policy. `EnvironmentOwnedDataCleanup` is part of this contract: on
removal the registry clears its cache and calls the platform implementation, so
web clears composer drafts and other environment-owned cached data.

Mobile cloud sign-out first saves relay drafts and queued messages in the local
composer store under the owning account. These saved copies retain attachment
files during cleanup and remain outside the active composer and upload queue.
Signing back into that account restores them before relay credentials activate.
Directly paired environments keep their drafts and outbox when cloud sign-out runs.

Mobile composer attachments upload over HTTP while their environment is connected,
with at most three concurrent transfers. Drafts retain local image data or an owned
file URI alongside the pending upload ID. Sending verifies and reuses that ID, or
uploads the local bytes again if it expired. Disconnecting cancels active transfers
without discarding drafts; reconnecting resumes preparation. Older servers without
attachment-upload support continue to receive inline images.

## Source Boundaries

Applications must import explicit package subpaths; the package intentionally
has no root export. The subpaths are documented in
[packages/client-runtime/README.md](../../packages/client-runtime/README.md),
with the `exports` map in that package's `package.json` as the authoritative
list. Files that are not exported are implementation details.

## Application Boundary

The application root mounts the shared connection layer, creates its own Atom
runtime, and selects the domain atom factories required by that platform. The
desktop shell may expose extra capabilities without changing connection ownership.

Application code must not construct RPC clients, retry loops, or raw
orchestration commands. Persistence paths belong to the platform registration
and cache stores, with explicit migration or invalidation policy.

## Verification

Core state-machine tests use `@effect/vitest` and deterministic service layers.
Required coverage includes:

- offline startup and online wakeup;
- forever retry with the 16-second cap;
- explicit retry interrupting backoff;
- authentication wakeups;
- involuntary close and reconnect;
- explicit removal clearing all owned state;
- relay token reuse and refresh;
- progressive relay discovery;
- shell and thread cache hydration;
- durable subscriptions switching sessions;
- command metadata and idempotent queued-command metadata.

[layer]: ../../packages/client-runtime/src/connection/layer.ts
[resolver]: ../../packages/client-runtime/src/connection/resolver.ts
[driver]: ../../packages/client-runtime/src/connection/driver.ts
[registry]: ../../packages/client-runtime/src/connection/registry.ts
[supervisor]: ../../packages/client-runtime/src/connection/supervisor.ts
[session]: ../../packages/client-runtime/src/rpc/session.ts
[client]: ../../packages/client-runtime/src/rpc/client.ts
