# Vetra Connect troubleshooting

A Vetra Connect connection passes through four stages:

1. **This device** reaches Vetra Connect over the internet.
2. **Vetra Connect** verifies your sign-in and host link.
3. **The host's tunnel** (`cloudflared`) forwards the request to the host.
4. **Vetra Code on the host** answers.

When a connection fails, open **Settings → Environments**, select the environment, and choose **Details**—the first failed stage identifies the cause below. On the host itself, run `vetra connect status` or check **Settings → Sharing & access**.

## The host's tunnel is offline

Vetra Connect could not reach the host's tunnel (host is asleep/offline, Vetra Code isn't running, or outbound port 7844 is blocked).

1. Confirm the host is awake and running Vetra Code.
2. Run `vetra connect status` on the host.
3. If the host was offline for 7+ days on an older version, start and update Vetra Code on the host to recreate its tunnel.

## Port 7844 is blocked on the host

`cloudflared` connects outbound to Cloudflare on **TCP and UDP port 7844** (normal web traffic still works when 7844 is blocked).

- **Tailscale exit node**: Run `tailscale set --exit-node=` on the host or allow outbound 7844 on the exit node.
- **Work VPN / firewall**: Allow outbound TCP/UDP 7844, or bypass Vetra Connect by adding a direct Tailscale route ([Reach one machine several ways](./remote-access.md#reach-one-machine-several-ways)).

## The tunnel works, but Vetra Code does not answer

The tunnel is up, but Vetra Code didn't respond on `127.0.0.1` (crashed, starting up, port changed, or `VETRA_HOST` bound only a non-loopback IP).

Restart Vetra Code on the host (`vetra service restart` for a background service) and run `vetra connect status`.

## The Vetra Connect address does not resolve or answer

The host's Vetra Connect address failed DNS, TLS, connection, or timed out.

1. Confirm the host is online and run `vetra connect status`.
2. If only the host fails, check DNS/VPN/proxy (stale DNS caches clear in ~30 minutes).
3. If the address no longer points to this host, re-link it: toggle **Vetra Connect** off and on in **Settings → Sharing & access**, or run `vetra connect link` and restart the server.

## This device can't reach Vetra Connect

The issue is on the client device's network:

1. Check for captive portals or dead Wi-Fi.
2. Temporarily disable VPNs, firewalls, ad blockers, or DNS filters (on a phone, test turning off Wi-Fi **Connectivity Assist**).
3. Try another network or add a direct Tailscale route ([Reach one machine several ways](./remote-access.md#reach-one-machine-several-ways)).

## Sign-in, account, or link problems

- **Different account**: Sign in to the same Vetra Connect account on both sides (on host: `vetra connect logout && t3 connect`).
- **Vetra Connect disabled on host**: Turn on **Settings → Sharing & access → Vetra Connect** or run `vetra connect`.
- **Link not yet applied**: Restart Vetra Code on the host (`vetra service restart` or restart desktop app).
- **Expired session**: Sign out of Vetra Connect and sign back in.
- **Waiting for device approval**: Approve the displayed code from an existing device or run `vetra auth connect-device approve <code>` on the host ([Approve new devices](./remote-access.md#approve-new-devices)).
- **Machine limit reached**: Deregister an unused host or [link a paid Vetra Chat account](./remote-access.md#more-machines-with-vetra-chat), then restart the host.

## The clock is off

Vetra Connect uses short-lived signed proofs. Enable automatic date and time on both the host and client device, then retry.

## The host runs an older Vetra Code

Update Vetra Code on the host machine ([Updating Vetra Code](./updating.md)).

## Vetra Connect returned an error

| Error                                            | Fix                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` / tunnel limit | Deregister an unused host or link a paid Vetra Chat account, then restart the host.                                           |
| `auth_invalid` / `invalid_bearer`                | Run `vetra connect login` (or `vetra connect logout && t3 connect`), then restart the server.                                 |
| Expired or invalid link proof                    | Sync system clock, update Vetra Code, and restart.                                                                            |
| HTTP 403 (unrecognized)                          | If device approval is on, update the client and approve it; otherwise check proxies/firewalls and save any Cloudflare Ray ID. |
| HTTP 408, 429, or 5xx                            | Temporary—wait a few minutes for automatic retry.                                                                             |

After fixing a permanent error, restart the host (`vetra service restart` or restart `vetra serve`). If Vetra Code stops when SSH disconnects, see [background-service troubleshooting](./background-service.md#troubleshooting).

## Report a problem

Open an issue on [GitHub](https://github.com/YasielCabrera/vetra-code/issues) with:

- **Copy diagnostics** from the environment's **Details**
- Output of `vetra connect status` on the host
- Trace ID (if shown)
- `~/.t3/userdata/logs/relay-client.ndjson` (tunnel tokens are already stripped)
