# Review usage

The Usage page separates two different views of provider activity into **Subscriptions** and **API
equivalent** tabs:

- **Subscription limits** are live allowance windows reported by Codex, Claude, Cursor, Grok, and
  OpenCode Go. These are the limits attached to your provider subscription, such as a 5-hour,
  weekly, or monthly allowance.
- **API-equivalent activity** reads local Codex, Claude Code, and Grok Build session history and
  estimates what those tokens would cost at full API rates. It also shows processed tokens, cache
  savings, provider shares, and model breakdowns. This estimate does not reduce or predict your
  subscription allowance.

The chat composer’s context-window popover continues to show the API-equivalent cost for the current
thread.

On wider thread views, a small ring in the bottom-left corner shows the remaining subscription
allowance for the exact provider instance selected in the composer. The ring uses the account's
primary window (the current session window when one is available); hover, focus, or click it to open
the same complete card used on the Subscriptions tab. Switching models within one provider instance
keeps the same account limits, while switching provider instances changes the card. Narrow thread
columns hide the ring so it does not overlap the composer.

## Subscription limits

Limits are grouped first by environment and then by provider instance. Vetra Code does not combine
accounts across devices, even when two cards show the same email address, because it cannot safely
prove that the quota source is identical on both environments.

Each available card uses the same compact, remaining-first layout: account and plan in the header,
provider-colored allowance bars, reset countdowns, and pace guidance when the provider reports a
window duration. Account labels are blurred by default; click a label to reveal it and click again
to hide it. A provider may report different windows than another provider; Vetra Code displays
those windows as reported instead of inventing a common schedule.

Cursor cards use the same Total, Auto, and API lanes as Cursor's dashboard. When Cursor's dashboard
reports a window duration, the card compares current use with elapsed time and shows whether the
account is in reserve or deficit and whether its current pace should last until reset. When Cursor's
dashboard event history is available, the card also shows Cursor-metered spend, API-rate cost and
token totals, a 30-day daily-cost chart, the top model, and on-demand credit usage. The cost history
is account-wide and can include Cursor activity from other devices; it is separate from the local
API-equivalent activity tab and may differ from an invoice.

Claude and Codex cards add a 30-day cost, token, model, and daily-history summary from that
environment's local Claude Code or Codex transcripts. These figures use API rates and are not a
subscription bill. The card says when model pricing is partial or unavailable. A custom provider
instance only receives this summary when its resolved transcript directory matches the scanned
source, so one instance never inherits another account's local history.

Provider-specific information stays in clearly labeled sections: Claude shows Extra usage and its
monthly cap plus model-scoped or Daily Routines lanes when the installed CLI reports them, Codex
shows credits, reset credits, and spending controls, Grok shows included and on-demand allowance,
and OpenCode Go shows its Zen balance. Missing sections mean the provider did not report that
information; Vetra Code does not invent values.

A **Stale** card contains the last successful reading after a temporary network, rate-limit, or
provider-server failure. Its original refresh time remains visible. Authentication failures and
account changes do not reuse old data. Unsupported and authentication states do not affect the
separate API-equivalent history.

The thread ring uses a dashed neutral state while limits are loading or when the selected provider
is offline, unsupported, missing authentication, unavailable, or has no percentage window. Opening
it explains the state without combining limits from another environment.

## Credentials

Codex, Claude, and Grok use the authentication already owned by their configured provider CLI.
Cursor first checks the signed-in Cursor desktop session on that environment. You can save an
instance-specific Cursor Cookie header in **Settings → Providers** as an explicit override; clearing
it restores desktop-session discovery.

OpenCode subscription reporting supports OpenCode Go and requires an instance-specific
`opencode.ai` Cookie header. If automatic workspace selection is not the workspace you expect, set
the optional OpenCode Go workspace ID on that provider instance. Generic OpenCode billing is not
shown as real subscription usage.

Saved Cookie headers stay in the selected environment's secret store. They are not copied to other
environments, returned to the client, or added to the provider's normal runtime configuration.

## Refreshing and alerts

The Subscriptions tab loads when the app connects to an environment. **Refresh now** asks every
connected environment for a fresh subscription reading.

Polling and alerts are configured in **Settings → Providers → Subscription usage**, and apply to
the device you set them on. **Subscription usage refresh** can poll every 5, 15, 30, or 60 minutes,
or use **On load only** to stop background polling.

With **Subscription limit alerts** enabled, connected clients show an in-app alert when a fresh
window first has 5% or less remaining in its reset cycle. A second alert appears when a window
previously observed at 0% becomes available again. Stale readings and failures never advance alert
state. After showing an alert for a provider instance, the client waits at least 10 minutes before
showing another alert for that instance. Alerts are not OS notifications and are not queued while
the client is offline.

## API-equivalent activity

Grok Build totals come from persisted session updates, so interactive turns that never wrote a
completed-turn record do not appear.

The **Limits** view shows how much of each subscription window you have used on Codex and Claude
Code, per connected environment: the session and weekly windows, plus a per-model weekly window
such as Fable when your plan has one. Each window is a bar from the moment it opened to its reset,
filled by the share of quota spent; a thin line marks how far into the window you are, which is
also where even spending would have put the fill, and the icon beside the label says whether you
are ahead of, on, or under that pace. Hover a bar for the exact reset time. Limits refresh on the
provider health-check interval and update live while a turn runs. API-key accounts have no
subscription windows and say so; that includes a Claude Code that reaches Anthropic through a proxy
via `ANTHROPIC_AUTH_TOKEN`, since the CLI then treats itself as an API-key client.

If you pool accounts behind a CLIProxyAPI hub, open **Settings → Providers → Usage providers**
and choose **Add hub**. Select the device that should connect to the hub; its accounts appear on
the Limits view. Remove hubs from the same settings section. Each limits row shows its provider
and instance name, or a small _CLI Proxy_ label for
hub accounts. When a connected provider reports limits for the same provider and email, its row
replaces the hub copy, keeping details such as banked reset credits. The hub copy remains visible
if the connected provider cannot report limits. Enter the hub's URL and management key; the key
is stored on the server and never sent back to a client. Emails are blurred until clicked, as in
provider settings.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart. Refreshing rescans every connected environment and refetches model pricing on
each of them, so a newly released model that showed $0.00 gets a price without waiting for the daily
pricing update.
