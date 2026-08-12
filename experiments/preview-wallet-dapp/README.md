# Preview wallet fixture

A single static page that exercises every flow the preview wallet implements, with
each result written into the DOM so `preview_snapshot` can assert on it.

## Run it

```sh
npx serve experiments/preview-wallet-dapp
# or
python3 -m http.server 4321 --directory experiments/preview-wallet-dapp
```

Then enable Settings → Web3 → _Preview wallet_, restart the server so the
`preview_wallet_*` tools are advertised, and open the page in the preview.

For real transactions, run a local node first:

```sh
anvil   # chain 31337 on 127.0.0.1:8545, which the wallet adopts with no config
```

Without a node, signing still works and `preview_wallet_status` reports
`rpcReachable: false`.

## Agent walkthrough

```
preview_open
preview_navigate       { url: "localhost:4321" }
preview_wallet_status                              # enabled, one account, chain resolved
preview_click          { locator: "text=eth_requestAccounts" }   # auto-approves
preview_snapshot                                   # accounts rendered

preview_wallet_configure { approval: "always-ask" }
preview_click          { locator: "text=personal_sign" }
preview_wallet_requests                            # parked, with a decoded summary
preview_wallet_approve { requestId: "…" }
preview_snapshot                                   # signature rendered

preview_click          { locator: "text=eth_signTypedData_v4" }
preview_wallet_reject  { requestId: "…", code: 4001 }
preview_snapshot                                   # "REJECTED code=4001"

preview_evaluate       { expression: "window.ethereum.isMetaMask" }   # true
```

## Regression check

With the wallet disabled, the page's discovery line should read
`auto: NO PROVIDER` and `window.ethereum` should be `undefined`.
