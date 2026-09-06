# Usage and limits

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

Totals depend on the history available on each server. Grok turns without a saved completed-turn
record are missing from the totals.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

**Usage → Limits** pools every subscription account it can see per provider, so with several Codex
or Claude accounts across your environments and hubs you read one number per window rather than a
list. Each window card shows how much of the pool is left and a bar with one segment per account,
ordered by which resets soonest; when the provider reports reset times, the card also says when
the next reset lands and how much it hands back. The hatched
part of a segment is what that reset restores. Tap a segment or account row for the account's plan,
where it is signed in, and its reset time. On web, you can hover too. Codex accounts with banked
reset credits show a ticket count and the **Use reset** action in the account details. On narrow screens, numbered rows below
the bar show each account's quota, countdown, and credits. Tap a row to open its details.

The same account signed in on more than one environment, or reported by a hub as well, counts once.
Filter with the environment dropdown to see what a single machine has.

If a window looks stale, refresh Limits to re-check every provider and hub.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
closes when you dismiss it or send your next message. It uses the same snapshot as **Usage → Limits**, so it does not run the agent or refresh
anything. The command is offered only for providers that appear under **Usage → Limits**.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.
