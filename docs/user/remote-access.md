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

## Reach one machine several ways

A machine can have more than one route: LAN, Tailscale, another VPN, a public
URL, SSH, or Vetra Connect. Tailscale shares its `100.64.0.0/10` address range with
other VPNs such as Cloudflare WARP, so an address in that range shows as VPN
unless the machine confirms it is on Tailscale. To add a route, choose **Add
route** in the machine's route list, or next to it in the Vetra Connect list.
Pairing the same machine again over another address also adds a route instead
of a second machine. A new route is placed by speed, in that order, and you can
reorder routes at any time.

While connected through Vetra Connect or a paired address, Vetra Code also learns the
machine's current LAN and Tailscale addresses and adds them as routes, so
pairing once through Vetra Connect is enough to use the LAN at home. When the
machine's LAN address changes, for example after it joins another Wi-Fi network,
the learned route follows it. The machine must allow network access for its LAN
address to be learned. You can reorder a learned route, but not remove it; it
goes away with the route it was learned through, or when the machine stops
reporting that address.

Vetra Code connects over the first route that answers. Away from home, a LAN
address that does not answer is checked briefly and skipped. It is only tried
again, after the other routes, if none of them connect. While connected over a
later route, Vetra Code checks the earlier ones when your network changes, when you
return to the app, and every minute, and moves back as soon as one works.

On web and desktop, select the route count under the machine's name in
**Settings → Connections** to see its routes. Drag a route to change the order,
or remove it. Signing out of Vetra Connect removes only that route; a machine
you can still reach another way stays saved.

Vetra Connect routes appear only once Vetra Connect is configured; see
[Deferred connection modes](#deferred-connection-modes).

Open **Permissions** next to **Routes** in web or desktop to see what your
current connection can do on that environment. For a remote environment, this
is in its route details. Permissions shown there apply only to the route marked
**In use**; other routes are not checked. Direct pairing and Vetra Connect have
separate sessions and may grant different permissions.

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

## Browser on a remote environment

Browser tabs belong to the environment, so you and your agents see the same
tabs from any device. The desktop app shows its own environment's tabs
directly. Every other device, and the desktop app for other environments,
streams them from the host. Agents keep using them while no device is
connected, and `localhost` addresses reach servers on the host.

The first tab downloads a headless Chrome, about 120 MB, into the Vetra home. It
is the same browser [HTML renders](html-renders.md) use, so a host downloads it
only once. Some Linux hosts need [setup](#browser-host-setup) before it can
start.

Agent tabs have separate storage and share a Chromium process. Take control before
typing into an agent's tab, then release control when you want the agent to
continue. Read-only connections can watch without changing the page.

While you have control, the tab works with your device: text the page copies or
cuts goes to your clipboard, a file picker on the page opens your device's
picker, and a finished download is offered for you to save. Popups such as
sign-in windows open as their own tabs. Downloads stay on the host until the
tab closes. Audio does not play on your device.

### Browser host setup

macOS, Windows, and Linux desktops run the browser as is. Some Linux hosts need
one-time setup: Ubuntu 23.10 and later block the sandbox the browser runs in,
and minimal images and containers lack libraries it loads. When that happens,
the server says so at startup, and browser tabs and HTML previews show the
command to run on the host. For a source server, that is:

```bash
sudo node apps/server/src/bin.ts browser setup
```

The server shows the exact line for how you started it, and keeps your `PATH`
when Node is installed only for your user. Where `vetra` is not on your `PATH`,
such as with only the desktop app installed, it names the full path of the
app's own `vetra` instead. It allows Chrome's sandbox with an AppArmor profile
and installs any missing libraries with apt. It is safe to run again. Without
`sudo`, it only reports what it would change.

The browser always runs in Chrome's sandbox. Where you cannot change the host,
set `VETRA_SERVER_BROWSER_SANDBOX=0` for the environment to run without it.

## Connect an outside agent

Claude Code, Codex, ChatGPT and other agents Vetra Code did not start can drive
threads on an environment through its MCP server. See
[outside agents](./outside-agents.md) for setup.

## Security model retained

A pairing link authorizes a client to exchange its one-time token for a durable server session.
Revoke credentials or sessions that are no longer trusted. Managed cloud execution will keep this
typed authenticated connection seam while placing each server in its own isolated workspace.

To choose a token's permissions, pass `--scope` once for each scope you want:

```bash
node apps/server/src/bin.ts pair --base-dir .vetra-code --scope orchestration:read --scope relay:read
```

The selected scopes replace the default permissions. The same option works with
`auth pairing create` and `auth session issue`; each command's `--help` lists the
available scopes. Without `--scope`, pairing tokens retain standard client
permissions and issued bearer sessions retain administrative permissions.

To change an existing client's permissions, create a fresh pairing link with the
scopes it needs. In a browser opened directly on the environment, open that link
to replace the browser's current grant. For a saved remote environment in web or
desktop, use **Add Environment** with the fresh link or code; pairing the same
environment replaces its saved grant. Reconnecting alone does not change
permissions.

Grouping checkouts does not combine their permissions. Shared project settings
require `orchestration:operate` on every member environment; actions on one
checkout use that checkout's permissions.

`source-control:write` covers direct Git and pull request changes made from the
client: pushing, switching or creating branches, cloning, and removing
worktrees. It does not restrict what a task does. Starting a task in a new
worktree still creates that branch and worktree with `orchestration:operate`,
and the agent it runs can use Git however the environment allows.

Settings changes, provider management, and environment maintenance can be granted
separately from access administration. New standard pairings include these
permissions. Existing clients can stay connected after an update, but newly separated
features may require pairing again with the permissions they need. Older clients
may show controls that the server denies. Create a fresh pairing link to change
a client's permissions.

`filesystem:read` allows browsing host files, opening workspace files, and viewing
local changes. Add `filesystem:write` to allow editing files or saving plans to
the workspace. These scopes control direct file access from the client.

## Vetra Connect environment deregistration

When Vetra Connect is configured, the account menu's **Vetra Connect** page lists environments
registered to the signed-in account. **Deregister** revokes that environment's Connect access,
removes any managed tunnel, and frees its host space. This is an account action and does not
need a live connection to the environment.

Until Vetra-owned Clerk and relay settings are present, that page stays hidden with the rest of
Vetra Connect. Device-local connect and disconnect controls remain in **Settings** →
**Connections**. Removing an environment there only forgets it on that device; it stays
registered to your account.
