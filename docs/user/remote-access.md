# Remote access during bootstrap

Vetra Studio retains the foundation's direct, Tailscale, relay, and SSH connection architecture, but only direct
development pairing is part of the current supported checkpoint. A Vetra-hosted web domain, relay,
published server package, and package-based SSH launcher are not configured yet.

## Pair another browser with a development server

Start the server with an isolated home:

```bash
pnpm dev --home-dir .vetra-studio
```

Use the complete `pairingUrl` printed by the server. Pairing tokens are short-lived and single-use;
treat them like passwords and do not put them in screenshots, commits, or durable logs.

To mint another token for that running source server:

```bash
node apps/server/src/bin.ts pair --base-dir .vetra-studio
```

The other device must be able to reach the advertised address. A loopback URL works only on the
same machine. Prefer a trusted private network and HTTPS/WSS for another device; do not expose a
development server directly to the public internet.

## Deferred connection modes

- Vetra Connect and its relay stay hidden when Vetra-owned Clerk and relay settings are absent.
- Hosted pairing is unavailable until Vetra has its own HTTPS application domain.
- Package-based headless, SSH, and background-service launch are unavailable while
  `@vetra-studio/server` remains private.
- The mobile client was removed from this fork.

Do not mix pairing links, CLI packages, or URL schemes from another product with Vetra Studio. They can
connect to a different server and read or modify that environment's state.

## Security model retained

A pairing link authorizes a client to exchange its one-time token for a durable server session.
Revoke credentials or sessions that are no longer trusted. Managed cloud execution will keep this
typed authenticated connection seam while placing each server in its own isolated workspace.
