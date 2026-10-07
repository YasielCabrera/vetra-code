# Preview wallet architecture

The preview wallet is an EIP-1193 provider injected into preview pages, backed by
one signer per environment: that environment's server. User-facing behaviour is in
[docs/user/preview-wallet.md](../user/preview-wallet.md).

## Why not the real MetaMask extension

The desktop preview is an Electron `<webview>` guest, so the extension route means
loading a Chrome extension into Electron. Electron's native extension API supports
a small subset of `chrome.*`; MetaMask's MV3 manifest needs `alarms`,
`notifications`, `offscreen`, `identity`, `sidePanel`, `cookies`, a service-worker
background and a `world: "MAIN"` content script, and Electron closed
[#49984](https://github.com/electron/electron/issues/49984) as _not planned_. The
gap-filler,
[`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions),
is dual-licensed GPL-3.0 or a paid Patron license and hard-fails without one; it
also does not implement `chrome.offscreen`. On top of that, MetaMask's own license
is non-commercial / ≤10k MAU, so it can never be bundled. This implementation is
the deterministic, agent-friendly half.

## One signer per environment

A preview tab runs in one of two places. The desktop app renders the tabs of the
server it launched in a `<webview>`; every other tab (the web client, a remote
environment viewed from the desktop) runs in that server's headless Chromium and
is streamed. Both kinds belong to the server's `ServerBrowser`, so the server is
the only process that sees every tab of an environment and knows which ones an
agent is driving. The wallet therefore lives there
([`ServerPreviewWallet.ts`](../../apps/server/src/web3/ServerPreviewWallet.ts)),
and every tab of the environment signs with the same accounts.

A desktop signer for its own tabs plus a server signer for the rest would give one
environment two account sets, two grant lists and two nonce sequences against the
same node. Sharing one writable keystore between two signers would need ownership
transfer and nonce coordination. One signer avoids both, and keys never leave the
server: pages, clients, the desktop and MCP results only ever see addresses.

## Layout

`@t3tools/web3` (`packages/web3`) holds the wallet itself and is a **leaf**: it must
not import `@t3tools/contracts` or `@t3tools/shared`, because `contracts` depends
on _it_.

| Subpath      | Contents                                                       | Dependencies     |
| ------------ | -------------------------------------------------------------- | ---------------- |
| `./schema`   | Wire schemas, settings, tagged errors                          | `effect`         |
| `./wallet`   | The engine: state, approval gate, queue, grants, signing       | `effect`, `viem` |
| `./page`     | What one page may see, and the events that move it there       | **none**         |
| `./inpage`   | The EIP-1193 provider, EIP-6963 announce, server page script   | **none**         |
| `./rpc`      | Method classification, hex helpers, request summarisation      | **none**         |
| `./networks` | Bundled public network metadata                                | **none**         |
| `./chain`    | Chain resolution, JSON-RPC transport, endpoint probing         | `effect`         |
| `./signer`   | Account derivation, signing, transaction filling               | `viem`, `effect` |
| `./keystore` | Keystore schema helpers; reads the desktop's pre-server wallet | `effect`         |

`./inpage` is dependency-free **on purpose**, for two hosts. It is bundled into
`preview-pick-preload.cjs`, a sandboxed Electron preload, and Electron cannot
resolve package imports from inside a packaged ASAR; `apps/desktop/vite.config.ts`
lists `@t3tools/` in that entry's `deps.alwaysBundle`, and dropping that fails at
runtime, not at build time. And the server's headless tabs run the same provider
from an init script built with `Function.prototype.toString` of
`web3InpageRuntime`: nothing inside that function may refer to a binding outside
it. `inpage.test.ts` runs the generated script in a fresh `vm` realm, which turns
such a reference into a failure.

## Request paths

```
headless tab: window.ethereum.request(...)
  → context binding (ServerBrowserWallet)   identity from Playwright's page + frame
desktop tab:  window.ethereum.request(...)
  → WalletPreload → ipcMain (desktop Wallet.ts)   identity from event.sender
  → DesktopBrowserHost → walletRequest over the bootstrap fds
both → ServerPreviewWallet → engine: classify → gate → grants → execute
     → Web3GuestReply envelope → the host rebuilds a ProviderRpcError with its code
```

Identity never comes from the payload. Only the top frame of a page registered to a
preview tab may use the wallet, with the origin of that page's current URL; an
iframe gets `4100`, and cannot borrow its parent's grant. The desktop additionally
requires the sender to be the main frame of a `<webview>` the preview manager
registered for a server tab. A new document gets a fresh `documentId`; the first
request carrying a new one answers the previous document's parked prompts, so a
reload never leaves a stale approval behind.

**Replies are an envelope, not a rejected promise.** Both bridges
(`ipcRenderer.invoke`, Playwright bindings) reword rejections and drop own
properties such as `code`, and dapps branch on `error.code === 4001`.

**Desktop injection is the preload, not CDP.** The server drives desktop tabs over
CDP, but the debugger detaches whenever DevTools opens, so `window.ethereum` would
vanish exactly when a web3 developer is debugging. The preload and its IPC do not
depend on the debugger. The desktop's bootstrap is a synchronous IPC answered from
the last `walletState` the server pushed, because a dapp can read
`window.ethereum` in its first inline script. A tab opened straight to a URL starts
its first document before the renderer's `registerWebview` reaches the main
process, so the reply waits (bounded) for that registration; answering at once
would leave every agent-opened tab without a provider until a reload.

**Headless injection** is a `BrowserContext` binding plus an init script, installed
before the context's first page exists and replaced when the wallet turns on or
off or changes chain. The script carries no accounts: a page asks for its
origin's view over the binding as it starts. A popup runs the script before it
becomes a tab, so its first calls wait for that adoption, or for it to close.

Pages never receive raw wallet state. Each host keeps the last view it gave a
document and sends only `pageEventsBetween(last, pageViewFor(state, origin))`
(`./page`), so `accountsChanged` is per origin and an unchanged chain sends no
`chainChanged`; dapps that reload on `chainChanged` would otherwise loop.

## The approval gate

`auto-for-agents` approves only within 30 seconds of an agent action on the same
tab. `ServerBrowser` marks the tab inside `asAgent`, after the agent holds the tab
and before the action runs, and for a new agent tab before its `opened` event
publishes, since the page's first script can ask before any action. Dialog answers
count; viewer input never does, and a person taking control clears the mark. The
window is wide because a dapp can raise a request seconds after the click that
caused it.

`always-auto` still parks the first request from a non-loopback origin. "Approve
everything" removes friction from local development; it must not hand a signing
oracle to any page the preview happens to load.

A parked request waits five minutes. Approve and reject first claim the request
out of the queue, so two approvers can never both sign it; one that finds it gone
gets `PreviewWalletRequestNotFoundError`. An expiry that loses that race leaves
the page the approver's answer rather than a false rejection. Turning the wallet
off answers every parked request with `4900`. Each tab may park 32 requests and
the wallet 256, and params over 256 KiB are refused before they queue.

## People and agents

People reach the wallet through the fork-owned `previewWallet.*` RPC group
([`previewWallet.ts`](../../packages/contracts/src/previewWallet.ts)). One
subscription per environment feeds Settings and every tab's chip; a chip shows only
its own tab's requests and opens itself for a new one, with no polling. Watching
needs `orchestration:read`; approving, rejecting and account changes need
`preview:operate`; persistent preferences go through server settings and
`settings:write`.

The chip is renderer HTML. Over a native `<webview>` (the desktop's own tabs),
clicks also reach the page underneath, so while it is open the webview's
`pointer-events` are off until the current pointer gesture ends. A streamed tab is
plain HTML and takes no lock.

Agents use the five `preview_wallet_*` MCP tools. They see and resolve only
requests from tabs their provider session owns in their thread (the
`automationOwner` the server browser records), never another session's; `tabId`
narrows to one tab. `preview_wallet_configure` approval-mode and chain overrides
last until the environment's wallet settings change or the server restarts.

`McpServer` registers toolkits at layer construction and exposes no removal path,
so `McpHttpServer.ts` decides once at boot whether to advertise the wallet tools:
turning the wallet **on** needs a server restart before they appear in
`tools/list`. A wallet turned off since answers `PreviewWalletDisabledError`,
naming Settings → Web3.

## Settings and keys

`ServerSettings.web3Wallet` is the only settings authority. The server subscribes
to settings changes before reading its first snapshot, so no change between the
two is lost.

The whole keystore (mnemonic, accounts and labels, origin grants) is one secret,
`preview-wallet-v1`, in the environment's secret store: plaintext JSON at mode
`0600`, labelled as a test wallet inside. These keys sign for previews that load
untrusted content and can auto-approve, so the honest move is to make the blast
radius obvious rather than dress it up as a vault. The secret is created on first
enable and never regenerated: a stored value that cannot be read is left alone and
the wallet stays keyless, because replacing it would lose test state.

Before the server held the wallet, the desktop kept its own at
`<desktop state>/preview-wallets/shared.json`. At the start of each run of its
local server, the desktop offers that file over the private fd channel; a server
with no wallet of its own adopts it and the desktop renames the file to
`shared.json.migrated`. A desktop-launched server waits up to ten seconds for that
offer before generating keys. Remote environments never receive the fds, so desktop
keys never reach them.
