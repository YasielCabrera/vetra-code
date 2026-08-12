# Preview wallet architecture

The preview wallet is an EIP-1193 provider injected into the browser preview,
backed by a signer in the Electron main process. User-facing behaviour is in
[docs/user/preview-wallet.md](../user/preview-wallet.md).

## Why not the real MetaMask extension

The preview is an Electron `<webview>` guest, not a Playwright browser, so the
extension route means loading a Chrome extension into Electron. Electron's native
extension API supports a small subset of `chrome.*`; MetaMask's MV3 manifest needs
`alarms`, `notifications`, `offscreen`, `identity`, `sidePanel`, `cookies`, a
service-worker background and a `world: "MAIN"` content script, and Electron
closed [#49984](https://github.com/electron/electron/issues/49984) as _not
planned_. The gap-filler,
[`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions),
is dual-licensed GPL-3.0 or a paid Patron license and hard-fails without one; it
also does not implement `chrome.offscreen`. On top of that, MetaMask's own license
is non-commercial / ≤10k MAU, so it can never be bundled.

It is feasible — [Polypane](https://polypane.app/docs/browser-extensions/) is a
`<webview>` Electron app that runs MetaMask — but the licensing and the missing
`chrome.offscreen` (no hardware wallets) make it a separate, gated decision. This
implementation is the deterministic, agent-friendly half.

## Layout

`@vetra-code/web3` (`packages/web3`) holds all the web3 domain logic and is a
**leaf**: it must not import `@vetra-code/contracts` or `@vetra-code/shared`,
because `contracts` depends on _it_.

| Subpath      | Contents                                                  | Dependencies     |
| ------------ | --------------------------------------------------------- | ---------------- |
| `./schema`   | Wire schemas and tagged errors                            | `effect`         |
| `./inpage`   | The EIP-1193 provider + EIP-6963 announce                 | **none**         |
| `./rpc`      | Method classification, hex helpers, request summarisation | **none**         |
| `./chain`    | Chain resolution, JSON-RPC transport, endpoint probing    | `effect`         |
| `./signer`   | Account derivation, signing, transaction filling          | `viem`, `effect` |
| `./keystore` | Mode-0600 keystore read/write                             | `effect`         |

`./inpage` and `./rpc` are dependency-free **on purpose**: `./inpage` is bundled
into `preview-pick-preload.cjs`, a sandboxed Electron preload, and Electron cannot
resolve package imports from inside a packaged ASAR. `apps/desktop/vite.config.ts`
therefore lists `@vetra-code/` in that pack entry's `deps.alwaysBundle`; dropping
that inlines nothing and the packaged app fails at runtime, not at build time.

Electron-specific plumbing lives in `apps/desktop/src/preview/Wallet.ts`, which is
deliberately thin.

## Request path

```
page: window.ethereum.request({...})
  → apps/desktop/src/preview/WalletPreload.ts        (in the guest, main world)
  → ipcRenderer.invoke(PREVIEW_WALLET_REQUEST_CHANNEL)
  → apps/desktop/src/preview/Wallet.ts               (ipcMain, sender validated)
      classify (web3/rpc) → gate → grants → execute
      ├─ local        answered from wallet state
      ├─ connect      grant the origin, return accounts
      ├─ signature    web3/signer, then broadcast for eth_sendTransaction
      ├─ chain        web3/chain, adopt or refuse with 4902
      └─ passthrough  forwarded to the active chain's RPC
  → PreviewWalletReply envelope
  → preload rebuilds a ProviderRpcError with its `code`
```

Two details worth knowing before changing this:

**Replies are an envelope, not a rejected promise.** `ipcRenderer.invoke`
rejections reach the guest as a bare `Error` with an Electron-reworded message and
every own property stripped — including `code`. Dapps branch on
`error.code === 4001` to tell "user rejected" from "something broke", so throwing
across IPC would make every rejection look like a crash. `PreviewWalletReply` in
`GuestProtocol.ts` carries `{ ok, code, message }` and the preload reconstructs the
error.

**Injection is via the preload, not CDP.** `Page.addScriptToEvaluateOnNewDocument`
would have worked, except the CDP control session is detached whenever DevTools
opens (`Manager.ts` `openDevTools` / `restoreControlSession`) — so
`window.ethereum` would vanish exactly when a web3 developer is debugging. The
preload is unconditional and runs at document start. `contextIsolation` is off for
preview guests (`WebviewPreferences.ts`), so assigning `window.ethereum` lands in
the page's own world with no bridge.

## Two IPC surfaces, two trust boundaries

- **Guest** (`GuestProtocol.ts`, handlers in `Wallet.ts`): reached by the preload
  on behalf of arbitrary web content. Registered directly against `ipcMain` so the
  handler can see `event.sender` and reject anything that is not a `<webview>`
  guest of our own window — the same checks
  `PreviewManager.registerWebviewUnlocked` makes. The typed `DesktopIpc` helpers
  discard the event, so they cannot be used here.
- **Renderer** (`ipc/methods/preview.ts` `walletMethods`): our own UI and the MCP
  automation path, through the usual typed helpers.

The bootstrap read is `sendSync`, because a dapp can read `window.ethereum` in its
first inline script and an async handshake loses that race on every page load.

## The approval gate

`auto-for-agents` needs to know whether a tab is agent-driven.
`PreviewTabState.controller` decays to `"none"` 750 ms after the last agent
action, which is far too short — a dapp can raise a transaction request seconds
after the click that triggered it. So `PreviewManager.withControlSession` calls
`wallet.noteAgentActivity(wc.id)` on every automation action, and the wallet keeps
its own 30-second grace window per `webContents` id.

`always-auto` still parks the first request from a non-loopback origin. "Approve
everything" is meant to remove friction from local development, not to hand a
signing oracle to any page the preview happens to load.

## Settings

`ServerSettings.web3Wallet` (`packages/contracts/src/settings.ts`), not
`ClientSettings` — the MCP layer has to read `enabled` to decide whether to
advertise the tools, and chain targeting belongs to the environment being
developed against.

The main process reads it two ways:

- At startup, straight off disk via `parsePersistedWeb3WalletSettings`
  (`packages/shared/src/serverSettings.ts`), the same pattern
  `DesktopObservability` and `DesktopBackendConfiguration` already use for
  observability config. An unreadable or undecodable file yields a **disabled**
  wallet: something that can sign fails closed.
- Live, pushed from `ElectronBrowserHost.tsx` whenever the setting changes, since
  nothing notifies main when the server rewrites `settings.json`.

## MCP gating

`apps/server/src/mcp/toolkits/web3/` holds the toolkit; `McpHttpServer.ts` wraps
its registration in a `Layer.unwrap` that reads `web3Wallet.enabled` and yields
`Layer.empty` when off. `McpServer` registers toolkits at layer construction and
exposes no removal path, so this is decided once at boot — turning the wallet
**on** needs a server restart before the tools appear in `tools/list`. Turning it
off mid-session is covered by the call-time check in the handlers, which fails with
`PreviewWalletDisabledError` and a message naming Settings → Web3.

Desktop-side wallet failures (no chain, unknown request id, a reverted send) reach
agents through the broker as `PreviewAutomationExecutionError` carrying the
original tag and message — the broker's `classifyResponseError` default branch. Only
`PreviewWalletDisabledError` is raised server-side.

## Keystore

`<state dir>/preview-wallets/shared.json`, mode `0600`, written tmp-then-rename.
Plaintext and labelled as a test wallet inside the file: these keys sign for a
preview that loads untrusted content and can auto-approve, so the honest move is
to make the blast radius obvious rather than dress it up as a vault. A missing
file is an empty wallet; a file that exists but cannot be decoded is surfaced as
an error rather than silently replaced, because that would be data loss for an
imported key.
