# Server updates

> Bootstrap note: the architecture is retained, but Vetra's server package is private and no
> versioned service-update channel is available yet. See [Updates during bootstrap](../user/updating.md).

Exact-version installs keep restarts independent of npm cache eviction or a moving
release tag. Installation and preflight happen in staging before publishing an
immutable runtime. Preflight checks the launcher protocol because a target that
needs new rollback guarantees cannot safely run under an older launcher. Upgrading
that launcher requires a local service update.

## Commit boundary

The launcher durably records the pending update before acknowledging it, then
stops the old child and starts the target as a trial. Service-state writes use
same-directory replacement with file and directory fsync. Invalid state stops
startup rather than guessing which runtime to boot.

The trial must finish migrations, acquire dependencies, bind HTTP, and park every
long-running root at the activation gate before reporting `prepared`. The launcher
then commits the target version durably and replies `committed`. Only then may the
child release its gates, accept commands, and publish ready. Keep fallible startup
acquisitions before this boundary. A listener alone does not prove the runtime is
ready to commit.

The launcher is the only runtime writer of `service-state.json`. Future `vetra service install` and
`vetra service update` commands may replace the launcher and state while the unit is stopped. Server children
only communicate with the launcher over their inherited IPC channel.

## Database rollback

After the old child exits, the launcher snapshots SQLite's main file, WAL, and
shared-memory file. This makes trial migrations reversible without down
migrations. The snapshot is made once per update and survives launcher restarts;
replacing it during a retry could capture changes from the failed trial.

Rollback stops the trial before restoring. A durable restore marker makes an
interrupted restore finish before either version boots. Keep the snapshot until
commit, or until both restoration and the terminal rollback state are durable.
Attachments and other files outside SQLite are outside this rollback boundary.

## Client acknowledgement

1. The active server installs `@vetra-code/server@<target>` into a unique staging directory.
2. The target runs `__service-preflight` and verifies that the stable launcher supports its update
   protocol.
3. The staging directory is renamed to its immutable version path only after preflight succeeds.
4. The active child sends `request-update`. The launcher validates the child and target, writes
   pending state, generates the update ID, then replies `update-accepted`.
5. After a short response-flush grace period, the launcher stops the active child.
6. With SQLite quiescent, the launcher snapshots the database, WAL, and shared-memory files.
7. The launcher starts the target as a trial and gives it the pending update over IPC.
8. The trial runs migrations, acquires dependencies, binds HTTP, starts every long-running root
   fiber, and verifies that each root is parked at the activation gate.
9. The trial sends `prepared`. The launcher durably commits B, deletes the snapshot, then replies
   `committed`.
10. The child opens the existing activation gate, accepts commands, and publishes lifecycle ready
    with the terminal update outcome.

Post-commit startup does not call service `start`, `initialize`, `connect`, `load`, or `acquire`
operations. It only opens prepared gates and publishes prepared lifecycle state.

The launcher serializes child exits, IPC messages, and timers. A trial must report prepared within
120 seconds. If the trial exits or times out before prepared, the launcher stops it, restores the
snapshot, records rollback, and starts A. A durable restore marker makes an interrupted restore
resume before either version can boot. After commit, B is active and the service manager's normal
restart policy applies.

## Database Rollback

The launcher snapshots `state.sqlite`, `state.sqlite-wal`, and `state.sqlite-shm` after the old
server stops and before the trial starts. This makes trial migrations and writes reversible without
requiring down migrations. The snapshot is retained across launcher restarts and is removed only
after commit or after both restore and the terminal rollback state are durable.

The protocol version is part of the safety boundary. A target that requires database snapshots is
blocked when the installed launcher is too old. Upgrade the launcher once with:

```sh
npx @vetra-code/server@<version> service update
```

This command is documentation for the future published package. It cannot be used while the package
remains private, and it must never be substituted with an unscoped or third-party package.

The local command stops the unit, selects the new launcher and exact runtime, then restarts the
service. Later releases, including releases with migrations, can use the remote trial path.

Snapshots briefly require enough free disk for another copy of the SQLite files. Attachments and
other files under the state directory are outside this rollback boundary.

## Client Correlation

The update acknowledgement includes the launcher-generated update ID. After reconnecting, clients
wait for a lifecycle ready event carrying that same ID. `committed` completes the operation only
when the ready server is the target version. `rolled-back` and `failed` end it immediately with the
recorded reason. Older servers without an ID retain version-only reconnect behavior.

## Capability and Compatibility

The existing additive RPC and lifecycle schemas remain compatible with older clients. New servers
advertise remote self-update only when they have valid launcher context and a live IPC channel.
Desktop-managed servers advertise `desktopAppUpdate` when the desktop telemetry control fd is
attached. The progress RPC asks the desktop app to check and download, then returns a preparation
token while the backend is still connected. Only after the client receives that result does it send
`server.commitDesktopUpdate`. A successful commit closes the connection and must reconnect at the
prepared version. The desktop app and bundled server versions stay equal because
`scripts/update-release-package-versions.ts` bumps them together. If install fails, the desktop keeps its windows, restarts stopped backends, and
replays the failure for the same token. This two-phase handoff prevents backend shutdown from
dropping the only successful RPC result. Desktop servers without the capability direct the user to
update the desktop app locally. Other process shapes provide a manual command; the old detached
foreground respawn path no longer exists.

## Source Map

- Launcher and state machine: `apps/server/src/serviceLauncher.ts`
- IPC and durable state types: `apps/server/src/cloud/serviceProtocol.ts`
- Child IPC adapter: `apps/server/src/cloud/serviceLauncherClient.ts`
- Staging and preflight: `apps/server/src/cloud/pinnedRuntime.ts` and `servicePreflight.ts`
- Service installation: `apps/server/src/cloud/bootService.ts`
- Activation boundary: `apps/server/src/serverRuntimeStartup.ts` and `serverActivation.ts`
- Client outcome correlation: `packages/client-runtime/src/state/server.ts`
