/**
 * Handlers for the preview wallet tools.
 *
 * Every tab of this environment signs with one wallet, so `tabId` does not pick
 * a wallet: it narrows which requests the agent sees and may resolve. Without
 * it, an agent works with the requests of every preview tab its provider
 * session owns in its thread, never another session's.
 *
 * The toolkit is only registered while the wallet is on; a wallet turned off
 * since answers `PreviewWalletDisabledError` from the service.
 */
import * as Effect from "effect/Effect";

import * as ServerPreviewWallet from "../../../web3/ServerPreviewWallet.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { hostAssignmentKey } from "../../PreviewAutomationBroker.ts";
import { PreviewWalletToolkit } from "./tools.ts";

const callerAgent = Effect.fn("PreviewWalletToolkit.callerAgent")(function* (
  tabId: string | undefined,
) {
  const scope = yield* McpInvocationContext.requireThreadMcpCapability("preview");
  return {
    threadId: scope.thread.threadId,
    agentSessionId: hostAssignmentKey(scope),
    tabId,
  } satisfies ServerPreviewWallet.WalletAgent;
});

const withWallet = <A, E, R>(
  use: (
    wallet: ServerPreviewWallet.ServerPreviewWallet["Service"],
    agent: ServerPreviewWallet.WalletAgent,
  ) => Effect.Effect<A, E, R>,
  tabId: string | undefined,
) =>
  Effect.gen(function* () {
    const agent = yield* callerAgent(tabId);
    const wallet = yield* ServerPreviewWallet.ServerPreviewWallet;
    return yield* use(wallet, agent);
  });

export const PreviewWalletToolkitHandlersLive = McpToolAccess.toLayer(PreviewWalletToolkit, {
  preview_wallet_status: McpToolAccess.readsAsCaller(({ tabId }) =>
    withWallet((wallet, agent) => wallet.statusFor(agent), tabId),
  ),
  preview_wallet_configure: McpToolAccess.actsAsCaller(({ tabId, ...input }) =>
    withWallet((wallet, agent) => wallet.configure(input, agent), tabId),
  ),
  preview_wallet_requests: McpToolAccess.readsAsCaller(({ tabId }) =>
    withWallet(
      (wallet, agent) =>
        wallet
          .statusFor(agent)
          .pipe(Effect.map((status) => ({ requests: status.pendingRequests }))),
      tabId,
    ),
  ),
  preview_wallet_approve: McpToolAccess.actsAsCaller(({ tabId, requestId }) =>
    withWallet((wallet, agent) => wallet.approve(requestId, agent), tabId),
  ),
  preview_wallet_reject: McpToolAccess.actsAsCaller(({ tabId, requestId, code }) =>
    withWallet((wallet, agent) => wallet.reject(requestId, code, agent), tabId),
  ),
});
