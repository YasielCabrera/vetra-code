# Vetra Connect bootstrap status

Vetra retains the inherited authenticated relay seam, but no production Vetra control plane is
configured. Treat the relay implementation as source architecture, not as a service that a fresh
checkout may safely deploy or enable.

## Default behavior

Cloud UI is omitted when any required public setting is absent. A normal local checkout needs no
cloud environment variables and must not copy Vetra Code production identifiers.

Future Vetra-owned public configuration uses:
Vetra Connect uses Clerk for cloud identity. The relay manages environment links, bootstrap
credentials, and managed tunnel allocations. Regular HTTP and WebSocket traffic goes directly from
clients to the environment's tunnel hostname—the relay Worker is not in the data path.

The one forwarded exception is automation webhooks
([`HookForwarder.ts`](../../infra/relay/src/hooks/HookForwarder.ts)), which give senders a stable
URL while leaving token/signature verification to the environment and keeping bodies/tokens out of
traces. Opt-in offline holding stores raw webhook requests in a per-link Durable Object
([`HookInboxObject.ts`](../../infra/relay/src/hooks/HookInboxObject.ts)) rather than Queues or
Postgres because held requests need per-link ordering, retry timing, and larger payload limits.

Deployment and Clerk configuration are not documented here: this fork owns no relay or Clerk
application yet (see [Syncing upstream](./upstream-sync.md)).

```dotenv
VETRA_CLERK_PUBLISHABLE_KEY=<publishable key>
VETRA_CLERK_JWT_TEMPLATE=<JWT template name>
VETRA_CLERK_CLI_OAUTH_CLIENT_ID=<public OAuth client ID>
VETRA_RELAY_URL=https://relay.vetra.example
```

`.env.example` intentionally contains no production values. Secrets such as a Clerk secret key,
database credentials, provider credentials, and signing keys must never be placed in client-facing
variables or committed files.

## Retained architecture

- browser and desktop clients connect to an environment through typed HTTP/WebSocket contracts;
- an environment owns its filesystem, Git state, terminals, provider processes, and threads;
- relay authentication and environment publication remain adapter boundaries;
- managed cloud workspaces should run the existing server per isolated workspace, with a small
  control plane handling create, wake, stop, routing, secrets, and durable allocation.

The relay is connectivity, not cloud compute. Do not turn the existing server into a shared
multi-tenant process.

## Before enabling Vetra Connect

1. Create Vetra-owned development and production Clerk applications.
2. Choose a new JWT audience and OAuth callbacks using only Vetra domains and `vetra://` protocols.
3. Provision Vetra-owned relay API/tunnel domains and an isolated database.
4. Remove or redesign inherited mobile push paths, because the mobile application was removed.
5. Threat-model token storage, DPoP, environment publication, tunnel ownership, and revocation.
6. Test local, direct remote, relay, and managed-workspace connection modes independently.
7. Add a dedicated deployment workflow only after the release checklist is satisfied.

The target managed-workspace model is documented in
[the remaking plan](../../re-making-plan/06-cloud-execution.md).

- **DPoP-bound bootstrap minting.** For a linked user, the relay asks the environment to mint a
  one-time bootstrap credential bound to the client's DPoP key. The client redeems it directly with
  the environment for an [environment session](./04_environment-auth.md). The relay never sees session
  tokens, and a bootstrap credential is useless without the client's proof key.
- **Mutual authentication.** The environment accepts only bounded, replay-guarded relay proofs for
  its own identity, linked user, and operation; the relay verifies signed environment responses
  bound to the request nonce and client proof key so nothing behind the tunnel can impersonate the
  environment ([`CloudLink.ts`](../../apps/server/src/cloud/CloudLink.ts),
  [`EnvironmentConnector.ts`](../../infra/relay/src/environments/EnvironmentConnector.ts)).
- **Explicit trust assumption & device approval.** DPoP protects an honest exchange, not a
  compromised relay signing key. Enabling `requireConnectDeviceApproval` shifts trust from the relay
  to approved DPoP key thumbprints: untrusted keys mint credentials that cannot be spent until
  someone with `access:write` approves the key, and revoking a key revokes all of its sessions and
  pending credentials. Approving admits a device already signed in to the owner's cloud account
  and returns no credential to the approver, so `access:write` alone is enough, as it is for
  turning the setting off.
- **Anti-hijack and anti-SSRF rules.** Managed tunnels expose only the server's own loopback HTTP
  origin (ignoring caller-supplied origins). The relay refuses to relink an active environment ID
  under a different key until unlinked, resolves endpoints only from its own managed allocations,
  and never follows redirects on health or mint requests.

## Link, allocation, and tunnel lifetimes

- CLI authorization, desired exposure, and a running connector have separate lifetimes: linking can
  record intent while stopped, and logout revokes cloud credentials without uninstalling the
  background service.
- Normal CLI shutdown releases its paid tunnel while keeping the hostname reservation and allocation
  record (so the environment shows offline rather than unauthorized). Client-installed links and
  update handoffs retain the tunnel across shutdown so updates do not pay DNS/routing propagation
  delay.
- Every allocation mutation bumps its `generation`. Unlink commits authorization revocation before
  external teardown, and release/reclamation lock on the claimed generation so delayed cleanup never
  deletes a tunnel reused by a concurrent restart or relink
  ([`ManagedEndpointProvider.ts`](../../infra/relay/src/environments/ManagedEndpointProvider.ts)).
- Idle tunnel reclamation deletes only tunnels whose host has registered recovery (and never
  unallocated orphans) so hosts that cannot self-heal are left alone.

## Vetra Chat plan cap link

Vetra Chat uses WorkOS rather than Clerk, so accounts link by user consent via a shared secret. Vetra Chat
owns the link and plan state; the relay stores no copy and queries Vetra Chat only when an account hits
its default cap for a new environment, failing closed to the default cap without disrupting existing
slots.

## OAuth traps

- Interactive clients use Clerk session-template JWTs; the headless CLI uses a public PKCE OAuth
  client with no secret. The relay must accept both.
- Loopback CLI login starts on the hosted `/connect` page so sign-in finishes before Clerk's
  authorize endpoint (going straight to authorize drops parameters across sign-in redirects).
- SSH and headless sessions use Clerk's OAuth device authorization grant directly against Clerk's
  token endpoint, which must stay enabled on the CLI OAuth application.
