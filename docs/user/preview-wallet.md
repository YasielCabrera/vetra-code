# Preview wallet (Web3)

The browser preview can carry a built-in Ethereum wallet so dapp flows — connect,
sign a message, sign typed data, send a transaction, switch chains — work without
installing a browser extension. You can drive it by hand, and agents can drive it
through the `preview_wallet_*` tools.

It identifies itself to pages as MetaMask (`window.ethereum.isMetaMask`, and
`io.metamask` over [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963)), so dapps
that gate on MetaMask detection find it.

> [!WARNING]
> **This is a test wallet.** Its keys are generated on your machine and stored
> unencrypted, so the preview can sign without prompting for a password. The
> preview also loads untrusted web content. Never import a mnemonic or private
> key that holds real funds.

## Turning it on

Settings → **Web3** → _Preview wallet_.

The first time you enable it, Vetra generates a throwaway 12-word mnemonic and
derives three accounts from it. They persist across restarts, so balances you
fund on a local test node stay put.

> [!NOTE]
> The `preview_wallet_*` MCP tools are only advertised to agents if the wallet was
> already enabled when the server started. After turning it on, restart the
> server (quit and reopen the desktop app, or restart `pnpm dev`) before agents
> can see them. Turning it _off_ takes effect immediately.

## Approvals

_Wallet approvals_ decides who confirms a signature or transaction request:

| Mode                             | Behaviour                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approve for agents** (default) | Approves silently while an agent is driving the tab; asks you otherwise. Automated tests do not stall, and a page cannot get a signature on its own. |
| **Always ask**                   | Every request waits for you. Use this to test rejection paths deterministically.                                                                     |
| **Approve everything**           | Approves without asking — except the _first_ request from a non-localhost origin, which still waits once.                                            |

Pending requests appear on the wallet chip in the preview toolbar, with a decoded
summary of what approving would do. You can approve, or reject with a specific
EIP-1193 code (`4001` user rejected, `4100` unauthorized, `4900` disconnected,
`4902` unknown chain) to exercise a dapp's error branches.

Signing requests from an origin that never called `eth_requestAccounts` are
refused with `4100` rather than prompting, which is what MetaMask does.

## Networks

Leave _Chain ID_ and _RPC URL_ empty to follow the dapp:

1. If a node is listening on `http://127.0.0.1:8545` (Anvil, Hardhat), the wallet
   adopts it and reports its chain id.
2. `wallet_addEthereumChain` from the page is honoured, including the endpoint it
   supplies.
3. `wallet_switchEthereumChain` is honoured when the wallet has an endpoint that
   actually serves that chain; otherwise it answers `4902` rather than claiming a
   chain it cannot read.

Fill either field to pin the wallet instead. When the configured endpoint does
not answer, the Web3 page and the toolbar chip both say so — a silently dead RPC
is the most confusing way for this to fail.

Any JSON-RPC method the wallet does not implement is forwarded to the active
chain, so test-node cheat codes (`anvil_setBalance`, `evm_mine`) work through
`window.ethereum` unchanged.

## Accounts and connected sites

The Web3 page lists accounts, lets you copy an address, add another generated
account, and choose which one `eth_accounts` returns first.

_Connected sites_ lists origins you have granted account access. **Forget all**
clears them, so the next `eth_requestAccounts` prompts again.

## Driving it from an agent

Five tools, available when the wallet is enabled:

| Tool                       | Use                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `preview_wallet_status`    | Accounts, active account, chain, whether the RPC answers, approval mode, pending count, connected origins |
| `preview_wallet_configure` | Change approval mode, active account, chain/RPC; add a generated account; clear connect grants            |
| `preview_wallet_requests`  | List parked requests with decoded summaries                                                               |
| `preview_wallet_approve`   | Approve one by id                                                                                         |
| `preview_wallet_reject`    | Reject one by id, with a chosen EIP-1193 code                                                             |

A typical rejection-path test:

```
preview_wallet_configure { approval: "always-ask" }
preview_click        <the dapp's sign button>
preview_wallet_requests
preview_wallet_reject { requestId: "…", code: 4001 }
preview_snapshot     <assert the dapp showed its rejection state>
```

Importing a private key is deliberately **not** available to agents — only
through Settings → Web3, where the warning is visible. Agents can generate
throwaway accounts, which is all an automated test needs.

## Where the keys live

`<state dir>/preview-wallets/shared.json`, mode `0600`, with the warning written
into the file. Deleting it makes the wallet generate a fresh mnemonic next time
it is enabled.
