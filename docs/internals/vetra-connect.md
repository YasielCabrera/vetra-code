# Vetra Connect bootstrap status

Vetra retains the inherited authenticated relay seam, but no production Vetra control plane is
configured. Treat the relay implementation as source architecture, not as a service that a fresh
checkout may safely deploy or enable.

## Default behavior

Cloud UI is omitted when any required public setting is absent. A normal local checkout needs no
cloud environment variables and must not copy Vetra Studio production identifiers.

Future Vetra-owned public configuration uses:

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
