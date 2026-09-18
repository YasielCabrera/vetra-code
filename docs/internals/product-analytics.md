# Product analytics

> For maintainers. Using Vetra Code? See [docs/user](../user/).

This fork ships product analytics **off**: `VETRA_TELEMETRY_ENABLED` defaults to
false and `VETRA_POSTHOG_KEY` has no default, so an unconfigured install sends
nothing. The schema below describes what the server would emit once Vetra owns a
PostHog project. See [Syncing upstream Vetra Code](./upstream-sync.md) for why those
defaults must survive every sync.

Vetra Code sends anonymous product events from the server to PostHog. The server
uses the first available hashed Codex account ID, hashed Claude user ID, or
installation-scoped anonymous ID as the distinct ID. It also keeps the
telemetry opt-out, event buffer, and batch delivery. Clients do not load the
PostHog browser SDK.

## Attribution boundaries

Client dimensions belong to the event's WebSocket connection. A server-global
"current client" would misattribute simultaneous web, desktop, and mobile use.
Provider execution has its own events because a turn can outlive the requesting
connection.

Keep client and server dimensions separate. A desktop host can serve a phone or a
remote browser, and a direct connection can cross a network. Older clients omit
metadata. Missing client values must stay unknown rather than being backfilled
from server properties. The legacy `clientType` property describes how the server
runs; use `surface` for the connected client.

## Interpreting events

Use `client.turn.requested` for active-use reports. `client.connected` counts
reconnects, so network behavior can inflate it. One identity can appear in several
client groups during a period; adding those groups double-counts users.

Provider send and completion counts need not match. Providers can emit synthetic
turns without a send request. Collection is best effort, with no scan or backfill
of provider history.

| Property               | Values and meaning                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface`              | Product client: `web`, `desktop`, or `mobile`.                                                                                                                                                  |
| `webDeployment`        | Web delivery: `hosted` for the hosted app or `server` for web files served by a Vetra server. Web only. This does not describe connection distance.                                             |
| `clientOs`             | `macOS`, `Windows`, `Linux`, `iOS`, `Android`, `ChromeOS`, `other`, or `unknown`.                                                                                                               |
| `clientDeviceType`     | `desktop`, `phone`, `tablet`, or `unknown`. This is separate from `surface`.                                                                                                                    |
| `clientBrowser`        | Normalized browser family. Web only. Browser detection is best effort.                                                                                                                          |
| `clientAppVersion`     | Version of the connected client.                                                                                                                                                                |
| `clientOsMajorVersion` | Client OS major version when the native client reports it. Initially mobile only.                                                                                                               |
| `clientDeviceModel`    | Hardware model when the native client reports it. Initially mobile only. This is not a user-assigned device name.                                                                               |
| `connectionMethod`     | `direct`, `ssh`, `relay`, or `unknown`. `direct` means that the client connected to the server endpoint without an SSH or relay connection. It does not mean both processes run on one machine. |

Unknown counts stay absent. Partial usage contains valid observed counts but
cannot establish a whole-turn total. Keep these distinctions when changing token
normalization or building reports.

| Property           | Values and meaning                                             |
| ------------------ | -------------------------------------------------------------- |
| `serverOs`         | Server process OS, normalized to the same names as `clientOs`. |
| `serverArch`       | Server process architecture.                                   |
| `serverWslDistro`  | WSL distribution from `WSL_DISTRO_NAME`, when present.         |
| `serverAppVersion` | Vetra server version.                                          |
| `serverMode`       | Server runtime mode: `desktop` or `web`.                       |

## Legacy properties

Existing property meanings do not change:

- `clientType` describes how the server runs. It is `desktop-app` for a desktop
  server and `cli-web-client` for a CLI web server. It does not describe the
  connected client. Use `surface` and `webDeployment` for new reports.
- `platform`, `arch`, `wsl`, and `t3CodeVersion` describe the server. Use the
  new `server*` names for new reports.
- `appVersion` describes the connected client. Use `clientAppVersion` for new
  reports.
- Mobile connection events keep `os`, `osMajorVersion`, and `deviceModel`.
  Use the new `client*` names for new reports.

## PostHog dashboard

Create one saved dashboard named `Client and platform usage`. Set
`client.turn.requested` as the event for active-use reports. A user can appear
in several client groups during one period, so do not add breakdown values to
calculate a total.

Save these insights:

| Insight                         | Configuration                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active users, daily             | Trends, `client.turn.requested`, unique users, daily interval.                                                                                                                                                                                                                          |
| Active users, weekly            | Trends, `client.turn.requested`, unique users, weekly interval.                                                                                                                                                                                                                         |
| Active users, monthly           | Trends, `client.turn.requested`, unique users, monthly interval.                                                                                                                                                                                                                        |
| Client usage                    | Trends, `client.turn.requested`, unique users. Save four filtered series: `surface = desktop`, `surface = mobile`, `surface = web` and `webDeployment = hosted`, and `surface = web` and `webDeployment = server`. Name them Desktop, Native mobile, Hosted web, and Server-served web. |
| Client OS, active users         | Trends, `client.turn.requested`, unique users, breakdown by `clientOs`.                                                                                                                                                                                                                 |
| Client OS, turns                | Trends, `client.turn.requested`, total events, breakdown by `clientOs`.                                                                                                                                                                                                                 |
| Client versus server OS         | Table, `client.turn.requested`, breakdown by `clientOs` and `serverOs`.                                                                                                                                                                                                                 |
| Connection method, active users | Trends, `client.turn.requested`, unique users, breakdown by `connectionMethod`.                                                                                                                                                                                                         |
| Connection method, turns        | Trends, `client.turn.requested`, total events, breakdown by `connectionMethod`.                                                                                                                                                                                                         |
| Mobile devices                  | Table, `client.turn.requested`, filter `surface = mobile`, breakdown by `clientOs`, `clientOsMajorVersion`, and `clientDeviceType`.                                                                                                                                                     |
| Client version adoption         | Trends, `client.turn.requested`, unique users, breakdown by `clientAppVersion`.                                                                                                                                                                                                         |
| Server version adoption         | Trends, `client.turn.requested`, unique users, breakdown by `serverAppVersion`.                                                                                                                                                                                                         |
| Missing metadata                | Table or SQL insight that shows the percentage of `client.turn.requested` events where each of `surface`, `clientOs`, `clientDeviceType`, `clientAppVersion`, and `connectionMethod` is absent. Track `webDeployment` and `clientBrowser` only within `surface = web`.                  |

In PostHog Data management, use the event and property descriptions from this
document. Mark the recommended properties as verified. Keep `clientType`
visible with its legacy description so old reports remain understandable.

## Collection and release boundary

Client values are best effort. Invalid values are ignored and never reject a
connection. Browser clients use user-agent data for broad OS, browser, phone,
and tablet groups. They do not infer CPU architecture or an exact OS version
from `navigator.platform`.

This change does not collect URLs, tokens, prompts, IP addresses, or
user-assigned device names. It measures authenticated product use. It does not
measure a person who visits the hosted app without connecting to a server.

The new fields start with the first client and server release that contains
this metadata path. Historical events cannot reliably identify the client OS,
hosted web use, device type, or connection method when the old client did not
send those fields. Reports must treat missing values as pre-release or older
client data instead of backfilling them from server fields.
