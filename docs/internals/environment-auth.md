# Environment authentication

> For maintainers. Using Vetra Code? See [docs/user](../user/).

## Authority survives transport changes

Pairing delegates a set of scopes. Exchanging a bootstrap credential can narrow
that grant but cannot widen it. Ordinary pairing does not grant access-management
or relay-management authority. Creating another pairing link requires both
`access:write` and every scope being delegated. The
[auth handlers](../../apps/server/src/auth/http.ts) enforce this at issuance;
client labels and device metadata have no authorization role.

The access read model contains pairing metadata, never recoverable pairing
secrets. Only the creation response returns the raw credential. Otherwise read
access to the connections list would become a way to acquire another client's
authority.

Browser cookies, bearer tokens, and DPoP tokens adapt the same scoped session
model. DPoP binds a token to a client's proof key; an invalid proof must fail
rather than fall back to bearer authentication. The OAuth token-exchange
vocabulary gives these grants a familiar meaning, but the environment does not
implement a general-purpose OAuth authorization server.

Bearer and DPoP clients obtain short-lived WebSocket tickets through authenticated
HTTP so long-lived tokens stay out of socket URLs. Browser sessions can
authenticate the upgrade with their cookie. A successful handshake grants no
extra authority: [every RPC declares a required
scope](../../apps/server/src/auth/RpcAuthorization.ts), and the WebSocket RPC
group's `RpcScopeAuthorization` middleware checks it before any handler runs.

Desktop restarts forget the previous local bearer token, so its reusable
bootstrap grant replaces earlier sessions for the same subject and method.
Revocation and insertion share a [database
transaction](../../apps/server/src/persistence/AuthSessions.ts); a failed
replacement must leave the old credential usable. Pairing and browser sessions
do not follow this replacement rule.

### Reusable dev credential

Web development environments can accept one `VETRA_DEV_AUTH_TOKEN` across
worktrees and ports on one hostname. The token and startup URLs that contain it
grant administrative access. Desktop and non-development servers ignore it. See
the [development runbook](../operations/development.md#reusable-dev-credential)
for setup.

Each environment hashes the value and seeds its own database record at startup.
Environments do not share SQLite data, signing keys, environment IDs, session
records, pairing grants, or revocation state. Local revocation persists after
restart and does not affect another worktree. Removing or rotating the value
and restarting invalidates the old credential and its WebSocket tickets.

Normal credentials keep precedence. A rejected normal credential never falls
back to the reusable credential. OAuth exchanges create ordinary local bearer
or DPoP children with normal expiry and revocation. The reusable cookie expires
after 30 days.

## The environment is the filesystem boundary

Projects are organizational boundaries, not filesystem sandboxes.
`orchestration:read` permits reading files the server account can read, including
absolute paths outside a project. This lets clients display artifacts that an
agent writes in a temporary directory. Relative paths and writes still follow
the [workspace path rules](../../apps/server/src/workspace/WorkspaceFileSystem.ts).

Signed asset URLs are bearer credentials. A URL for media on the host grants
access to one canonical file and its device/inode identity, not its containing directory.
[Asset access](../../apps/server/src/assets/AssetAccess.ts) rechecks the opened
file's identity when serving it, so atomic replacement requires a new URL while
editing the same file in place does not. An HTML file authorized this way cannot
load sibling assets; directory-scoped workspace previews are a separate grant.
Clients should share the authored file reference so they do not disclose the
temporary URL's credential.

Clients with `orchestration:read` can request a `media-file` URL through `assets.createUrl` for
supported images, videos, HTML, and PDF files anywhere the environment's server account can read.
A thread ID supplies the workspace for relative paths; absolute paths refer to the environment
host, not the client.

[`AssetAccess.ts`](../../apps/server/src/assets/AssetAccess.ts) resolves symlinks, requires a regular
file, and validates the resolved file's literal extension. It opens the file and signs its canonical
path and device/inode identity for one hour. The token grants access to that exact file, not adjacent
files or its containing directory. Serving rechecks the canonical path, media type, and opened
descriptor's identity, then streams full or partial responses from that descriptor. Replacing a
file atomically requires a freshly signed URL; editing it in place does not. Because the token names
one file, an HTML document served this way cannot load sibling assets; the directory-scoped
`workspace-file` resource remains the route for HTML inside the workspace. Uploaded attachments keep
their separate asset resource.

Signed asset URLs are bearer credentials. Anyone who obtains a URL and can reach the environment
can fetch that file until it expires. Clients should copy the authored reference, not the temporary
URL. Responses use `nosniff`; SVG responses retain their restrictive sandbox policy. Video reads
support byte ranges so playback does not require a complete download first.

Host videos can change in place, so their responses use `private, no-store` and omit `ETag`
and `Last-Modified`. File metadata cannot prove byte-for-byte identity for `If-Range`; advertising
those validators would encourage native players to send conditional seeks that require a full
response. Ordinary range requests receive partial responses. An explicitly supplied `If-Range`
still falls back to a full response because no strong validator is available. Host image previews
keep their private cache policy and weak metadata validators.

The server serves media in place without importing it into attachment storage. Deletion makes
future server reads fail, though an already loaded client or its cache can retain bytes. Native
viewers may use temporary client-side files for display or explicit sharing; those are not durable
environment copies.

## Authentication Flows

### Browser Session

`POST /api/auth/browser-session` consumes a one-time bootstrap credential and creates a
browser session cookie. The cookie is an HTTP transport adapter for the same
scoped session model; the response never exposes the session secret to browser
JavaScript.

### Bearer Access Token

Non-browser clients use `POST /oauth/token` with an
`application/x-www-form-urlencoded` body:

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<bootstrap credential>
subject_token_type=urn:vetra:params:oauth:token-type:environment-bootstrap
requested_token_type=urn:ietf:params:oauth:token-type:access_token
scope=orchestration:read orchestration:operate terminal:operate review:write relay:read
```

Clients may additionally submit `client_label`, `client_device_type`, and
`client_os` extension parameters so the authorized-clients UI can identify the
device that established the session. These are presentation hints only; the
environment derives transport metadata such as IP address and user agent from
the request and does not use these fields for authorization.

The response has the token-exchange shape:

```json
{
  "access_token": "<opaque session token>",
  "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "orchestration:read orchestration:operate terminal:operate review:write relay:read"
}
```

Sessions issued from a plain bearer exchange use the store's
`DEFAULT_SESSION_TTL` of 30 days. The shorter one-hour `expires_in: 3600` applies
only to DPoP-bound exchanges, where the token is additionally constrained by a
proof key. See `SessionStore.ts` and `EnvironmentAuth.ts`.

The reusable `desktop-bootstrap` grant replaces active sessions with the same
subject and authentication method. Revocation and insertion share one database
transaction, so a failed insertion preserves the previous credential. This also
removes stale local desktop entries from earlier launches. Browser-cookie sessions
and sessions issued through pairing links are not replaced.

Requested scopes must be a subset of the one-time bootstrap credential grant.
An ordinary paired client therefore cannot exchange its grant for
`access:read`, `access:write`, or `relay:write`.

### DPoP-Bound Access Token

The same `/oauth/token` exchange supports proof-of-possession tokens. A client
that sends a `DPoP` header has its proof verified by `verifyRequestDpopProof`;
the resulting JWK thumbprint is stored on the session, which is then issued with
method `dpop-access-token` and a one-hour TTL instead of the bearer default. An
invalid proof gets a DPoP challenge header and a credential error rather than a
bearer token. Newer servers include a safe `dpopFailureReason` category in that
error. When an older server omits the category, clients mention clock skew as
one possible cause rather than presenting it as confirmed.

`dpop-access-token` is advertised alongside `browser-session-cookie` and
`bearer-access-token` in the descriptor's `sessionMethods`
(`EnvironmentAuthPolicy.ts`), so clients can discover support rather than
assume it. Relay-brokered clients use this mode so that a leaked token cannot be
replayed without the corresponding key.

### WebSocket Ticket

`POST /api/auth/websocket-ticket` accepts any authenticated session and returns
a short-lived, single-purpose WebSocket ticket, issued through
`EnvironmentAuth.issueWebSocketTicket` with a five-minute default TTL. The
client presents its bearer or DPoP credential in headers to get the ticket, then
appends only that ticket to the socket URL as `wsTicket`. This keeps long-lived
tokens and browser cookies out of WebSocket URLs while letting the handshake
authenticate.

The ticket carries its session's scopes; each RPC method then enforces
`orchestration:read`, `orchestration:operate`, `terminal:operate`,
`review:write`, `relay:write`, or `access:read` as appropriate, through
`RPC_REQUIRED_SCOPES` in `apps/server/src/auth/RpcAuthorization.ts`. Review feedback submission currently dispatches
an orchestration operation, so clients performing it also need
`orchestration:operate`. Creating a ticket is not authorization to call every
RPC method.

## Standards Alignment

- Bearer access tokens are used through the `Authorization: Bearer` scheme from
  RFC 6750.
- The token endpoint profiles the request and response vocabulary from OAuth 2.0
  Token Exchange (RFC 8693), including `subject_token`, `requested_token_type`,
  `access_token`, `issued_token_type`, and `token_type`.
- Scope values follow the OAuth 2.0 scope model from RFC 6749: space-delimited,
  unordered capabilities with subset checking during exchange.

This is intentionally not a general-purpose OAuth authorization server. The
environment bootstrap token type is private, the bootstrap cookie and WebSocket
connection-token routes are product-specific adapters, and the API returns its
typed `HttpApi` errors rather than implementing every OAuth error response
surface.

## Upgrade Behavior

Migration `031_AuthAuthorizationScopes` is a hard cutover from role-bearing auth
records to scoped records. It deletes existing pairing links and sessions while
leaving non-authentication environment state unchanged. Upgraded clients must
pair again; old `owner` or `client` credentials are never silently mapped to new
capabilities.

## Relay Boundary

Relay-managed tunnels use their own tokens and keys. The relay can reuse scope
parsing and token-exchange conventions, but an environment access token is not a
relay token and cannot be presented to the relay.
