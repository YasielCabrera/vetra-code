# Remote access during bootstrap

Vetra Code retains the foundation's direct, Tailscale, relay, and SSH connection architecture, but only direct
development pairing is part of the current supported checkpoint. A Vetra-hosted web domain, relay,
published server package, and package-based SSH launcher are not configured yet.

## Pair another browser with a development server

Start the server with an isolated home:

```bash
pnpm dev --home-dir .vetra-code
```

Use the complete `pairingUrl` printed by the server. Pairing tokens are short-lived and single-use;
treat them like passwords and do not put them in screenshots, commits, or durable logs.

To mint another token for that running source server:

```bash
node apps/server/src/bin.ts pair --base-dir .vetra-code
```

The other device must be able to reach the advertised address. A loopback URL works only on the
same machine. Prefer a trusted private network and HTTPS/WSS for another device; do not expose a
development server directly to the public internet.

## Deferred connection modes

- Vetra Connect and its relay stay hidden when Vetra-owned Clerk and relay settings are absent.
- Hosted pairing is unavailable until Vetra has its own HTTPS application domain.
- Package-based headless, SSH, and background-service launch are unavailable while
  `t3` remains private.
- The mobile client was removed from this fork.

Do not mix pairing links, CLI packages, or URL schemes from another product with Vetra Code. They can
connect to a different server and read or modify that environment's state.

## Balance new threads across machines

Auto balance is off by default. On web and desktop, enable it in
**Settings → Connections → Load balancing** to automatically choose a machine for
new threads in projects grouped across connected environments. The section
appears once two or more machines are switched on.
Each machine starts at **Normal**. Choose **Prefer** to favor it when it has CPU and
memory available, **Less often** to reduce its share, or **Manual only** to exclude
it from automatic selection. These are preferences, not fixed traffic percentages.
Preferences are saved separately in each client.

The composer checks eligible machines when choosing a draft's environment, then keeps
that choice stable. Choose **Auto balance** again to check current resources, or choose
a specific machine to override it. Choosing a branch or worktree also keeps the draft
on that machine. Existing threads stay where they started. If resource checks are
unavailable or all eligible machines are full, choose a machine manually to continue.

## Security model retained

A pairing link authorizes a client to exchange its one-time token for a durable server session.
Revoke credentials or sessions that are no longer trusted. Managed cloud execution will keep this
typed authenticated connection seam while placing each server in its own isolated workspace.

## Vetra Connect environment deregistration

When Vetra Connect is configured, the account menu's **Vetra Connect** page lists environments
registered to the signed-in account. **Deregister** revokes that environment's Connect access,
removes any managed tunnel, and frees its host space. This is an account action and does not
need a live connection to the environment.

Until Vetra-owned Clerk and relay settings are present, that page stays hidden with the rest of
Vetra Connect. Device-local connect and disconnect controls remain in **Settings** →
**Connections**.
