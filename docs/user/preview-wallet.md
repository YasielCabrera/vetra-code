# Preview wallet (Web3)

The browser preview can carry a built-in Ethereum wallet so dapp flows — connect,
sign a message, sign typed data, send a transaction, switch chains — work without
installing a browser extension. You can drive it by hand, and agents can drive it
through the `preview_wallet_*` tools.

It identifies itself to pages as MetaMask (`window.ethereum.isMetaMask`, and
`io.metamask` over [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963)), so dapps
that gate on MetaMask detection find it.

> [!WARNING]
> **This is a test wallet.** Keys are unencrypted, and agents can use, create, or
> delete wallets without notice. Never import a mnemonic or private key that
> holds real funds.

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

When a page asks for approval, the wallet popover opens from the preview toolbar
with a decoded summary of what approving would do. Approve or reject closes it.
Reject tells the page the user declined (`4001`). Agents can still reject with other EIP-1193 codes
(`4100` unauthorized, `4900` disconnected, `4902` unknown chain) through
`preview_wallet_reject` to exercise a dapp's error branches. If the wallet
cannot complete an approved request, it shows the failure instead of leaving
the page behind an unexplained spinner.

Some connector libraries restore their own connected state without calling
`eth_requestAccounts` again. If such a page asks to sign after its preview-wallet
grant was cleared, the wallet opens the normal approval prompt. Approving both
signs and reconnects that site; rejecting leaves it disconnected.

## Networks

Built-in networks start **enabled**. Disable one in Settings → **Web3** to hide it
from the preview wallet picker and from `wallet_switchEthereumChain`. Enable it
again to put it back. A reset control on that list turns every built-in back on.

Automatic selection when no network is pinned:

1. If a node is listening on `http://127.0.0.1:8545` (Anvil, Hardhat), the wallet
   adopts it and reports its chain id.
2. Otherwise the wallet starts on the first enabled built-in network, preferring
   Ethereum Mainnet.
3. If every built-in is disabled, it uses the first custom network, or stays
   unset until you add one.
4. `wallet_addEthereumChain` from the page is honoured for the session, including
   the endpoint it supplies.
5. `wallet_switchEthereumChain` can select an enabled built-in or a custom
   network you added. Other chains answer `4902` unless the page adds them first.

**Add custom network** stores a name, RPC URL, chain ID, and currency symbol —
the same shape MetaMask uses — so a local node or any other EVM chain can sit
next to the built-in list. Edit a custom network from the pencil next to it.
Removing one that is currently selected moves the wallet to another enabled
network.

Bundled endpoints are public and rate-limited. They are suitable for previews and
development, not production traffic; add a custom network to use a dedicated or
self-hosted RPC.

Open the wallet chip in the preview toolbar to switch directly between enabled
built-in networks and your custom networks. The wallet emits `chainChanged`, so
the open page sees the new network without reloading.

| Network           | Chain ID | Default RPC                                   |
| ----------------- | -------: | --------------------------------------------- |
| Ethereum Mainnet  |        1 | `https://ethereum-rpc.publicnode.com`         |
| OP Mainnet        |       10 | `https://mainnet.optimism.io`                 |
| BNB Smart Chain   |       56 | `https://bsc-dataseed.bnbchain.org`           |
| Polygon           |      137 | `https://polygon.drpc.org`                    |
| Base              |     8453 | `https://mainnet.base.org`                    |
| Arbitrum One      |    42161 | `https://arb1.arbitrum.io/rpc`                |
| Avalanche C-Chain |    43114 | `https://api.avax.network/ext/bc/C/rpc`       |
| Ethereum Sepolia  | 11155111 | `https://ethereum-sepolia-rpc.publicnode.com` |

When the active endpoint does not answer, the Web3 page and the toolbar chip
both say so — a silently dead RPC is the most confusing way for this to fail.

Any JSON-RPC method the wallet does not implement is forwarded to the active
chain, so test-node cheat codes (`anvil_setBalance`, `evm_mine`) work through
`window.ethereum` unchanged.

## Accounts and connected sites

The wallet chip and the Web3 settings page both let you choose which account
`eth_accounts` returns first. The popover shows the active account, a copyable
address, and the current network. Rename it from the account options menu — new
accounts start as **Preview account 1**, **Preview account 2**, and so on. Use
**New account** to derive another throwaway account and make it active immediately.
Settings lists every account so you can click a name to rename it, copy its
address, or remove it (you'll be asked to confirm). The preview popover keeps
rename and remove behind the account options menu, not as primary actions.

_Connected sites_ lists origins you have granted account access. **Forget all**
clears them, so the next `eth_requestAccounts` prompts again.

## Driving it from an agent

Five tools, available when the wallet is enabled:

| Tool                       | Use                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `preview_wallet_status`    | Accounts, active account, chain, whether the RPC answers, approval mode, pending count, connected origins      |
| `preview_wallet_configure` | Change approval mode, active account, account label, chain/RPC; add or remove an account; clear connect grants |
| `preview_wallet_requests`  | List parked requests with decoded summaries                                                                    |
| `preview_wallet_approve`   | Approve one by id                                                                                              |
| `preview_wallet_reject`    | Reject one by id, with a chosen EIP-1193 code                                                                  |

A typical rejection-path test:

```
preview_wallet_configure { approval: "always-ask" }
preview_click        <the dapp's sign button>
preview_wallet_requests
preview_wallet_reject { requestId: "…", code: 4001 }
preview_snapshot     <assert the dapp showed its rejection state>
```

Importing a private key is deliberately **not** available to agents — only
through Settings → Web3, where the warning is visible. Agents can generate or
remove throwaway accounts, which is all an automated test needs.

## Where the keys live

`<state dir>/preview-wallets/shared.json`, mode `0600`, with the warning written
into the file. Deleting it makes the wallet generate a fresh mnemonic next time
it is enabled.
