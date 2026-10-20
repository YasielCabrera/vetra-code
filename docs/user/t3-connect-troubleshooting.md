# Vetra Connect troubleshooting

A Vetra Connect connection goes through four parts, in this order:

1. **This device** reaches Vetra Connect over the internet.
2. **Vetra Connect** checks your sign-in and the host's link.
3. **The host's tunnel** (cloudflared on the host) carries the request to the host.
4. **Vetra Code on the host** answers.

When a connection fails, open **Settings > Connections**, find the environment,
and select **Details**. The first part marked as failed is the cause. Find its
section below.

To see the host's side, run `vetra connect status` on the host, or open
**Settings > Connections** on the host. Both check the host's Vetra Connect
address from the host, and say why it fails. `vetra connect` runs the same check
when it finishes setup. This check cannot test another device's network. For a
problem on one device, use **Details** on that device.

## The host's tunnel is offline

Vetra Connect could not reach the host's tunnel. This means one of these:

- The host is asleep, turned off, or offline.
- Vetra Code is not running on the host.
- The host's network blocks the tunnel. See
  [Port 7844 is blocked on the host](#port-7844-is-blocked-on-the-host).

Fix:

1. Make sure the host is awake and Vetra Code runs on it.
2. On the host, run `vetra connect status`. It names the problem on the host's side.
3. If the host was offline for a long time, Vetra Connect removes its tunnel. Start
   Vetra Code on the host and update it to the latest version. It gets a new tunnel.

## Port 7844 is blocked on the host

The tunnel on the host connects out to Cloudflare on port 7844, with TCP and
UDP. Both tunnel protocols (QUIC and HTTP/2) use this port. When the host's
network blocks it, the tunnel cannot start, but normal web traffic still works.
The host looks online, so this problem is easy to miss.

Common causes:

- **A Tailscale exit node on the host.** All of the host's internet traffic goes
  through the exit node, and that network blocks port 7844. Turn off the exit
  node on the host with `tailscale set --exit-node=`, or allow outbound port
  7844 on the exit node's network.
- **A VPN on the host.** Work VPNs often block unknown ports. Ask for port 7844
  to be allowed, or use a direct route instead (see below).
- **A firewall or strict network.** Allow outbound TCP and UDP port 7844.

If you cannot unblock the port, you can connect without Vetra Connect. When the
host and this device are on the same Tailscale network, add the host's
Tailscale address as a direct route. See
[Reach one machine several ways](./remote-access.md#reach-one-machine-several-ways).

## The tunnel works, but Vetra Code does not answer

The host's tunnel is up, but it cannot reach Vetra Code on the host. Common causes:

- Vetra Code on the host stopped, crashed, or is still starting.
- Vetra Code restarted on a different port, for example after an update, and the
  tunnel still points at the old port.
- The server binds only one network address with `VETRA_HOST`. The tunnel
  sends requests to `127.0.0.1`, so the server must also listen there.

Fix: restart Vetra Code on the host. For the background service, run
`vetra service restart`. Then run `vetra connect status` on the host.

## The Vetra Connect address does not resolve or answer

The host's Vetra Connect address did not resolve, refused the connection, failed a
secure (TLS) connection, or did not answer in time.

Fix:

1. Make sure the host is awake and online.
2. On the host, run `vetra connect status`.
3. If the check fails only on the host, check the host's DNS, VPN, or proxy.

## This device can't reach Vetra Connect

The problem is on this device's network, not on the host. This device could
not reach Vetra Connect, or it reached Vetra Connect but not the host's tunnel
address.

Fix:

1. Check this device's internet connection. On a captive or dead Wi-Fi network,
   the device can look online but cannot reach anything.
2. A VPN, firewall, ad blocker, or DNS filter on this device can block T3
   Connect. Turn it off for a moment to test.
3. On iPhone, Connectivity Assist in the Wi-Fi settings can break Vetra Connect.
   Turn it off to test.
4. Try another network, or add a direct route to the host, such as its
   Tailscale address. See
   [Reach one machine several ways](./remote-access.md#reach-one-machine-several-ways).

## Sign-in, account, or link problems

Vetra Connect does not have an active link between your account and the host.

- **The host is linked to a different account.** Sign in to the same Vetra Connect
  account on this device and on the host. On the host, run `vetra connect logout`,
  then `vetra connect`.
- **Vetra Connect is off on the host, or the host only publishes agent activity.**
  On the host, open **Settings > Connections** and turn **Vetra Connect** on, or
  run `vetra connect`.
- **The host was linked, but the server did not apply the link yet.** Run
  `vetra service restart` on the host, or restart `vetra serve`.
- **This device's sign-in expired, or the host no longer accepts this
  device.** Sign out of Vetra Connect and sign in again.
- **Your account reached its tunnel limit.** Remove an environment you do not
  use from your T3 account's Vetra Connect page, then restart Vetra Code on the host.

## The clock is off

Vetra Connect signs requests with short-lived proofs. When the clock on this
device or the host is a few minutes wrong, Vetra Connect rejects them. Turn on
automatic date and time on both devices, then retry.

## The host runs an older Vetra Code

This app needs a newer Vetra Code on the host. Update Vetra Code on the host. See
[Updating Vetra Code](./updating.md).

## Vetra Connect returned an error

| Error                                                     | Fix                                                                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` or managed tunnel limit | Remove an unused environment, then restart Vetra Code on the host.                                                                                   |
| `auth_invalid` or `invalid_bearer`                        | Run `vetra connect login`. If credentials were revoked, run `vetra connect logout`, then `vetra connect` again. Restart the server after signing in. |
| Expired or invalid link proof                             | Check the host's date and time, update Vetra Code, then restart it.                                                                                  |
| HTTP 403 without a recognized error                       | Check relay access, proxies, and firewall rules. Keep any Cloudflare Ray ID for a bug report.                                                        |
| HTTP 408, 429, or 5xx                                     | Wait a few minutes. Vetra Code retries temporary failures on its own.                                                                                |

After you fix a permanent rejection, restart the host's server with
`vetra service restart`. For a foreground server, stop it and run `vetra serve` again.

If Vetra Code on the host disappears when SSH closes, see
[background-service troubleshooting](./background-service.md#troubleshooting).

## Report a problem

If none of this helps, open an issue on
[GitHub](https://github.com/pingdotgg/t3code/issues). Include:

- The text from **Copy diagnostics** in the environment's **Details**.
- The output of `vetra connect status` on the host.
- The trace ID, if one is shown.
