# Provider subscription usage

> For maintainers. User-facing behavior is documented in [Review usage](../user/usage.md).

Provider subscription usage is a live, instance-scoped capability. It is intentionally separate
from transcript usage: transcript usage estimates API-equivalent activity from local history, while
this subsystem reads provider-owned subscription allowances.

## Boundary and report model

The capability is attached to each materialized `ProviderInstance`. A driver captures the exact
binary, home, environment, settings, and authentication source used by that instance. The central
service enumerates the instance registry and never looks up quota by provider kind alone. This keeps
two accounts of the same provider isolated and preserves environment boundaries on remote clients.

The versioned wire report contains one result for every enabled instance, including unavailable
instances. Ready results have a fresh or stale marker, a provider-read timestamp, stable percentage
windows, optional detail rows, and optional cost/token history with explicit provider-account or
local-environment scope. Raw provider percentages are non-negative but not capped; only the
rendered meter is clamped. Non-ready results use explicit `needs-auth`, `unsupported`, or `error`
states.

## Provider adapters

| Driver   | Quota source                          | Notes                                                                                                                                                                                                                                                |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | Configured Codex app-server           | Calls `account/read` without token refresh, then `account/rateLimits/read`. ChatGPT accounts only. Matching local Codex transcripts add scoped API-rate history.                                                                                     |
| Claude   | Installed Agent SDK control method    | Runs a zero-prompt scoped probe. Missing experimental usage control support is an update-required unsupported state. Known forwarded scoped-model and Daily Routines fields are parsed defensively. Matching local transcripts add API-rate history. |
| Cursor   | Cursor desktop state or manual Cookie | Reads only Cursor's app-state SQLite database; it does not inspect browser cookies or prompt for keychain access. Fixed Cursor HTTPS endpoints provide plan limits plus account-wide 30-day dashboard cost events.                                   |
| Grok     | Configured Grok ACP process           | Initializes an ACP control connection and requests `x.ai/billing` without creating a session or sending a prompt.                                                                                                                                    |
| OpenCode | OpenCode Go site with manual Cookie   | Uses the private `_server` response and Go workspace pages. The private parser is isolated here because no public usage API exists. Local database estimates and generic OpenCode billing are not accepted as subscription usage.                    |

When a quota surface and runtime both expose an account identity, the service rejects mismatches
instead of displaying a possibly unrelated account's limits.

## Cache and concurrency

Cache keys combine the provider instance ID with a one-way fingerprint of every configuration and
credential input that affects the probe. Healthy results live for five minutes; unavailable and
error results retry after one minute. Force refresh bypasses the TTL, but callers with the same
instance and fingerprint join an existing read. Different fingerprints never join, even when an
instance is rebuilt under the same ID. Report-level probe concurrency is capped at three and every
instance settles independently.

Cursor's dashboard event history is substantially heavier than its allowance summary, so the
Cursor capability caches that optional enrichment for one hour by credential fingerprint. A failed
history refresh may retain the last value only for the same fingerprint; it never crosses account
or credential changes. Allowance refreshes continue independently when history is unavailable.

Claude and Codex reuse `UsageService`'s one-hour, 30-day local summary. The two cards join the same
cached scan instead of walking transcripts twice. Enrichment is attached only when the summary's
provider and resolved transcript root match the materialized instance. Missing, failed, or
mismatched sources leave quota data intact and omit history. Pricing coverage is carried as
complete, partial, or unavailable so the client can label estimates honestly.

All ready providers use the shared rich card renderer. The adapter keeps raw provider data simple;
the client groups detail IDs into Claude Extra usage, Codex Credits and Spending, Grok On-demand,
and OpenCode Credits sections. This keeps layout policy in one place without moving provider
parsing into the UI.

The Usage page and thread subscription popover both render that same card. The thread control keys
the client report by the active environment and exact composer-selected provider instance, then
summarizes the first provider-ordered window and fills its ring with the remaining percentage. It
never infers a model-to-window mapping or merges accounts. Missing values and environment-level
failures use a static neutral ring; the control consumes the existing client refresh monitor and
does not issue reads on hover.

Only network, timeout, rate-limit, and provider-server failures may reuse last-good data. Adapters
return a probe envelope rather than a bare result, and its `transient` flag is the only thing that
opens the last-good path; the shared helper sets it exclusively on `error` results, so auth
failures, account mismatches, and unsupported accounts cannot reach it even by adapter mistake.
Stale data keeps its original provider-read timestamp and retries after one minute. Configuration
changes, parser drift, and untrusted responses also remove the last-good path. Deleting an instance
clears both its cache and its subscription credential.

## Client-local alert state

Limit alerts are a device concern, not an environment one. The transition memory that keeps an
alert from repeating within a reset cycle lives in `ClientSettings` and never crosses the wire, so
it is stored in one browser `localStorage` key alongside every other client setting. An unbounded
record there would eventually fail that write and silently stop _all_ client settings from
persisting, so it is pruned on both axes: evaluating an environment retires markers for provider
instances its report no longer lists, and the monitor retires markers for environments the client
no longer knows. Prune by instance presence rather than window presence — an unavailable instance
reports zero windows, and dropping its markers there would re-alert as soon as it recovers.

The same markers store the last toast time. A provider instance has a device-wide 10-minute
cooldown across environments, so rapid report transitions cannot stack several usage alerts.

## Credential and HTTP safety

Manual quota credentials exist only for Cursor fallback and OpenCode Go. They are stored by provider
instance in `ServerSecretStore`; RPC responses contain only a boolean configured status. Credential
reads use the normal orchestration read scope and writes use the operate scope. Do not add quota
secrets to provider settings, subprocess environments, logs, telemetry, or errors.

Direct HTTP probes accept only their adapter's fixed HTTPS origin. Response bodies are capped at
1 MiB, reads time out after 15 seconds, and client-visible failures do not include response bodies.
Provider-configured API endpoints must never influence quota URLs.

Redirects are followed by the runtime's `fetch`, which strips `Cookie` and `Authorization` before a
cross-origin hop, so a redirected probe cannot carry a quota credential to another host; a redirect
response that does reach the client is rejected. The origin allowlist is enforced on the requested
URL, not on the final URL, so an adapter must not treat a redirected body as proof of origin.
Cursor dashboard history uses the same resolved Cookie header and a matching `Origin`, reconciles
only proven page-boundary overlap against Cursor's reported total, and rejects incomplete totals
instead of displaying partial spend.

## Maintenance

Keep provider response parsing and control-protocol handling inside the corresponding usage adapter.
Changes to Claude's experimental SDK method or OpenCode's private server payload should begin with a
fixture update and produce an honest unsupported or sanitized error state when compatibility cannot
be retained. Do not restore direct OAuth-file mutation, browser-cookie import, or keychain prompts.
Local transcript history may enrich a ready card, but it must never stand in for a missing
provider-owned allowance or cross instance boundaries.
