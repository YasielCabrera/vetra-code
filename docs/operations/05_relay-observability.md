# Relay observability

> Bootstrap note: the dataset names below describe inherited relay resources. Do not target them
> from Vetra; provision Vetra-owned observability resources before deploying a relay.
> The relay Alchemy stack (`infra/relay`) provisions stage-scoped Axiom datasets (`vetra-code-relay-traces-<stage>`, `vetra-code-mobile-logs-<stage>`, `vetra-code-mobile-metrics-<stage>`), scoped write-only ingest tokens, the `vetra-code-mobile-sourcemaps-<stage>` R2 bucket, and health dashboards (`vetra-code-relay-health`, `vetra-code-mobile-health`).

Prefer Axiom dashboards and APL queries over tailing the Cloudflare Worker. Scripted queries use account-level `AXIOM_TOKEN` + `AXIOM_ORG_ID` (runtime ingest tokens are write-only). Effect HTTP attributes live under `attributes.http.*`, and relay custom annotations live under `attributes.custom`.

## Alerts

Threshold monitors in [`infra/relay/src/monitoring.ts`](../../infra/relay/src/monitoring.ts) activate when `RELAY_ALERT_NOTIFIER_ID` is set (optional warnings go to `RELAY_WARNING_NOTIFIER_ID`). Monitors count HTTP status codes, not span errors—a 9 s relay timeout returns 504 even without a span error flag, and `/connect` 502s are normal for offline hosts.

The dashboard's "Connecting" charts show connections as users see them. Web, desktop, and mobile
export a root `relay.connection.attempt` span per attempt, which lasts until initial sync finishes, in
the same trace as the relay's and the host's spans. Most reconnects reuse a cached relay token and go
straight to the host, so relay latency only affects cold connects. A slow total with fast phases
usually means the client waited out an unreachable direct (LAN) route before falling back to the relay.

**Links failing / tunnel recovery failing.** Open the dashboard's "Link failures by reason" table.
`provisioning: ensure-tunnel` or `configure-tunnel` with Cloudflare 429s on the "Cloudflare API calls
by status" chart is the #16810 failure: the account's Cloudflare API rate limit. Ask Cloudflare to
raise it, and check whether something is calling the API in a loop (tunnel recovery from hosts is the
largest caller). Slow Postgres instead points at the database or Hyperdrive.

**Environments unreachable.** Clients reach fewer hosts than usual. Check Cloudflare Tunnel status and
recent relay deploys before suspecting hosts: a host-side problem does not move this many
environments at once.

**Push delivery failing.** Look at the `relay.apns_deliveries.process_signed_job` or `relay.fcm.process`
error messages. An expired APNs key or FCM service account fails every job.

**Cloudflare API rate limited / near its limit.** The warning fires on sustained 429s; the page fires
when they are frequent enough to stall provisioning. Compare the call volume on the dashboard with the
account limit, which Cloudflare raised to 20,000 calls per 5 minutes in October 2026 (peak use then
was about 2,100).

**Traffic dropped.** The Worker is down, a deploy broke it, or spans stopped reaching Axiom. Check
the configured relay’s `/health` endpoint first.

**Tunnel cleanup stopped / tunnel deletions failing.** Monitors for the five-minute reaper that deletes
idle Cloudflare tunnels. "Stopped" pages after two hours without a finished sweep, so it also fires
when every sweep fails; a sweep fails when listing tunnels does, behind Cloudflare 429s or listings
that outlast the sweep's list timeout. "Deletions failing" is a warning. Idle tunnels are
billed until the reaper catches up, which the "Idle tunnels in Cloudflare" chart shows. A failed
sweep records no counts, so while sweeps fail the chart stops at the last good one; check the tunnel
list in the Cloudflare dashboard for current numbers. For failed
deletions, read the relay's "Failed to delete an inactive managed tunnel" warnings. To pause cleanup,
see [Managed tunnel cleanup rollout](03_release.md#managed-tunnel-cleanup-rollout).

**Links degraded / database slow.** Warnings for slow degradation. Link failures above 20% over six
hours have so far meant provisioning running into the 9 s deadline, with Postgres latency as the
usual cause.

## Mobile crashes and errors

The mobile app sends `expo-observe` telemetry to the relay (`/v1/mobile/observe`), which forwards logs, metrics, and spans to Axiom and symbolicates release Hermes JS stacks using source maps from R2 (`relay.symbolication.status` records the outcome).

- **Counting real native crashes:** Fatal JS errors also trigger a native abort; filter out `relay.crash.js_fatal` (and Android OS `SIGKILL`s, which indicate memory pressure/swiping) when counting native crashes:

  ```apl
  ['vetra-code-mobile-logs-prod']
  | where ['attributes.expo.error.source'] == 'nativeCrash'
  | where isnull(['attributes.relay.crash.js_fatal'])
  | summarize count() by ['attributes.exception.type'], ['attributes.exception.message']
  ```

- **Symbolicating iOS native crashes:** Download the build's dSYM archive from R2 at `ios/dsym/<easBuildId>.zip` and resolve offsets (`T3Code + <offset>`):

  ```sh
  unzip <easBuildId>.zip
  atos -arch arm64 -o T3Code.app.dSYM/Contents/Resources/DWARF/T3Code -l 0x100000000 \
    $(printf '0x%x' $((0x100000000 + <offset>)))
  ```

- **Source map upload secret:** `MOBILE_SOURCEMAPS_R2` comes from Alchemy output `mobileSourceMapsUploadCredentials` (`cd infra/relay && vp exec alchemy state read T3CodeRelay/prod/output`). Store it as a GitHub Actions secret (for OTA updates) and as an EAS `production`-only secret (never `preview`, which runs PR code).
- **Mobile alerts ([`infra/relay/src/mobileTelemetry/monitoring.ts`](../../infra/relay/src/mobileTelemetry/monitoring.ts)):** Crash spikes right after a release usually indicate a bad OTA—roll back in EAS. Android OS-kill spikes lag releases and point to memory leaks or main-thread freezes.
