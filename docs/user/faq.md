# FAQ

## Is Vetra Code a harness?

No. A harness turns an LLM into an agent (tools, execution loop, and results)—like Claude Code's Agent SDK or Codex App Server. Vetra Code drives those harnesses through one fast interface; it does not work without at least one installed agent.

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, Kiro, Pi, Muse Code, fx, or any [ACP agent](./providers-acp.md). See [Provider setup](./install.md#providers). (Longer read: [What is a harness?](https://t3.gg/blog/post/what-is-a-harness))

## Why use Vetra Code instead of Claude Code or the Codex app?

- **Bring your own subscription**: Use Claude, Codex, and every other agent you already have installed in one place.
- **Remote-first**: Run `vetra up` on any box and drive it from anywhere.
- **Open source (MIT)**: Fork the source code under your own branding if you ever want something different.

## Can I use Vetra Code with my Claude Code subscription?

Yes.

## How much does Vetra Code cost?

Nothing. You pay your own model/agent providers. Vetra Connect is free for up to 3 connected host machines per account (phones and browsers don't count). You can also self-host or use LAN/Tailscale.

## Can I fork or redistribute Vetra Code?

Yes, for the source code. The [MIT License](../../LICENSE) covers source code only—not Vetra Code's trademarks, name, wordmark, logos, or icons. Any public fork or build must use its own branding and clearly state that it is unofficial and not affiliated with T3 Tools, Inc.

## Can I connect more than 3 machines with Vetra Connect?

Yes. Link a paid Vetra Chat account from your account menu → **Vetra Chat → Link Vetra Chat**: Vetra Chat Pro raises the limit to 10 machines, and Premier raises it to 100. See [More machines with Vetra Chat](./remote-access.md#more-machines-with-vetra-chat).

## Why is my Claude 5-hour limit draining so fast?

Since v0.1.7, Claude in Vetra Code drains your 5-hour limit at the same rate as Claude Code directly (an earlier Anthropic Agent SDK discrepancy has been resolved). If you still see it, [update Vetra Code](./updating.md) on the machine running your agents.

## How do I use Vetra Code remotely?

Your agents run wherever the Vetra Code server runs (desktop, server, or VPS). Run `vetra up` on that machine and connect via Vetra Connect, LAN, or Tailscale. See [Remote access](./remote-access.md).

## How do I use Vetra Code on my phone?

Open the web app from your phone's browser over [remote access](./remote-access.md). Vetra Code ships no phone app; your host computer runs the agents and must stay on.

## Why does Vetra Connect keep disconnecting?

Open **Settings → Environments**, select the machine, and choose **Details**—the first failed check identifies the cause. See [Vetra Connect troubleshooting](./t3-connect-troubleshooting.md). Tailscale also works great as a direct fallback.

## Will I get banned for using my subscription?

No. Vetra Code stays within the TOS of Claude Code, Codex, Google Antigravity, Grok Build, Cursor, and official ACP bindings.

## Can I add a bunch of accounts for one provider?

Vetra Code intentionally does not include an automatic multi-account switcher to avoid risking provider TOS bans. Adding a separate work/personal account is supported ([Codex](./providers-codex.md#use-multiple-accounts), [Claude](./providers-claude.md#multiple-accounts-and-presets)). For larger pools managed externally (e.g. via [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)), Vetra Code can display pooled limits under Usage ([Connect a hub](./usage.md#connect-a-cliproxyapi-hub)).

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in **Settings → Providers** with its own environment variables and endpoint (your subscription setup stays untouched). See [OpenRouter for Claude](./providers-claude.md#openrouter-and-local-routers) and [Providers](./install.md#providers).

## Does Vetra Code support local models?

No. Vetra Code focuses on frontier coding agents.

## Does my code go to Vetra Code servers?

No. Code and prompts go directly from your machine to your chosen provider. With Vetra Connect, traffic travels over a Cloudflare tunnel (`cloudflared` on your machine); T3's relay coordinates the link without proxying your HTTP/WebSocket sessions.

Vetra Code sends basic product usage events (provider, model, token totals—no prompts or file contents). Disable with `VETRA_TELEMETRY_ENABLED=false` or `DO_NOT_TRACK=1`. See [Product usage data](./telemetry.md).

## Worktrees are eating my disk. How do I clean them up?

Enable automatic cleanup or run **Delete now** in **Settings → Worktrees → Cleanup**. See [Storage cleanup](./project-settings.md#storage-cleanup).

## Is there voice input?

Yes—on-device speech on macOS 26+ desktop, or via a paired environment. See [Voice input](./voice-input.md).

## Does it work on Windows, Mac, and Linux?

Yes, all three (desktop app and CLI). Note: there is no standalone `vetra` binary for Intel Macs (use the desktop app there), and Windows users can also run agents inside WSL. See [Install](./install.md).

## Why is my provider not showing up?

Usually the provider CLI is not installed, not signed in, or not on the `PATH` of the **server machine** (especially with version managers). Authenticate on the server machine first (e.g. `codex login` or `claude auth login`) and set **Binary path** in **Settings → Providers** if needed.
