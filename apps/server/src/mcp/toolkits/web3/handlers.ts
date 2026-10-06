/**
 * Handlers for the preview wallet tools.
 *
 * Each one re-checks `web3Wallet.enabled` before touching the broker. The
 * toolkit is only registered when the wallet is on, so in the common case this
 * is redundant — but the setting can be turned off while an MCP session is
 * live, and an agent that keeps calling should get a `PreviewWalletDisabledError`
 * telling it where the switch is, not a confusing routing failure from the
 * desktop host.
 */
import type {
  PreviewAutomationWalletRequestList,
  PreviewAutomationWalletResolution,
  PreviewTabId,
} from "@t3tools/contracts";
import { PreviewWalletDisabledError, type Web3WalletStatus } from "@t3tools/web3/schema";
import * as Effect from "effect/Effect";

import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import { PreviewWalletToolkit } from "./tools.ts";

/**
 * Fails closed: if the settings service cannot answer, the wallet is treated as
 * disabled rather than assumed available.
 */
const requireWalletEnabled = Effect.fn("PreviewWalletToolkit.requireEnabled")(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const enabled = yield* settings.getSettings.pipe(
    Effect.map((current) => current.web3Wallet.enabled),
    Effect.catchCause(() => Effect.succeed(false)),
  );
  if (!enabled) return yield* new PreviewWalletDisabledError();
});

const invokeWallet = Effect.fn("PreviewWalletToolkit.invoke")(function* <A>(
  operation:
    | "walletStatus"
    | "walletConfigure"
    | "walletRequests"
    | "walletApprove"
    | "walletReject",
  input: { readonly tabId?: PreviewTabId | undefined; readonly [key: string]: unknown },
) {
  yield* requireWalletEnabled();
  const scope = yield* McpInvocationContext.requireThreadMcpCapability("preview");
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const { tabId, ...operationInput } = input;
  return yield* broker.invoke<A>({
    scope,
    operation,
    input: operationInput,
    ...(tabId === undefined ? {} : { tabId }),
  });
});

const handlers = {
  preview_wallet_status: (input) => invokeWallet<Web3WalletStatus>("walletStatus", input ?? {}),
  preview_wallet_configure: (input) => invokeWallet<Web3WalletStatus>("walletConfigure", input),
  preview_wallet_requests: (input) =>
    invokeWallet<PreviewAutomationWalletRequestList>("walletRequests", input ?? {}),
  preview_wallet_approve: (input) =>
    invokeWallet<PreviewAutomationWalletResolution>("walletApprove", input),
  preview_wallet_reject: (input) =>
    invokeWallet<PreviewAutomationWalletResolution>("walletReject", input),
} satisfies Parameters<typeof PreviewWalletToolkit.toLayer>[0];

export const PreviewWalletToolkitHandlersLive = PreviewWalletToolkit.toLayer(handlers);
