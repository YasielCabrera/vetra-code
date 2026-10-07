/**
 * The preview wallet as clients and agents reach it. Each environment's server
 * holds one wallet, and every preview tab of that environment signs with it,
 * whether the tab runs in the server's own browser or in the desktop app.
 *
 * Fork-owned, so upstream's RPC files only carry the hooks that merge it in.
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  PreviewWalletError,
  Web3PendingRequest,
  Web3RejectCode,
  Web3RequestId,
  Web3WalletAccountConfigureInput,
  Web3WalletConfigureInput,
  Web3WalletResolution,
  Web3WalletStatus,
} from "@t3tools/web3/schema";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { ThreadId } from "./baseSchemas.ts";
import { PreviewTabId } from "./preview.ts";

const WalletTabFields = {
  tabId: Schema.optional(
    PreviewTabId.annotate({
      description:
        "Preview tab whose requests to show or resolve. Omit for every tab this agent session owns in the thread.",
    }),
  ).annotate({
    description:
      "Preview tab whose requests to show or resolve. Omit for every tab this agent session owns in the thread.",
  }),
};

/** A parked request and the preview tab whose page asked for it. */
export const PreviewWalletPendingRequest = Schema.Struct({
  ...Web3PendingRequest.fields,
  threadId: ThreadId,
  tabId: PreviewTabId,
});
export type PreviewWalletPendingRequest = typeof PreviewWalletPendingRequest.Type;

/** The wallet's effective state, with each parked request tagged by its tab. */
export const PreviewWalletStatus = Schema.Struct({
  ...Web3WalletStatus.fields,
  pendingRequests: Schema.Array(PreviewWalletPendingRequest).annotate({
    description: "Requests parked awaiting approval, oldest first, with the tab that made each.",
  }),
});
export type PreviewWalletStatus = typeof PreviewWalletStatus.Type;

// ── Agent tools ─────────────────────────────────────────────────────

export const PreviewAutomationWalletTargetInput = Schema.Struct(WalletTabFields);
export type PreviewAutomationWalletTargetInput = typeof PreviewAutomationWalletTargetInput.Type;

/**
 * Importing a private key is deliberately not exposed: routing real key
 * material through a tool call would put it in provider transcripts.
 */
export const PreviewAutomationWalletConfigureInput = Schema.Struct({
  ...WalletTabFields,
  ...Web3WalletConfigureInput.fields,
});
export type PreviewAutomationWalletConfigureInput =
  typeof PreviewAutomationWalletConfigureInput.Type;

const RequestIdField = Web3RequestId.annotate({
  description: "Request id from preview_wallet_requests or preview_wallet_status.",
});

const RejectCodeField = Schema.optional(
  Web3RejectCode.annotate({
    description:
      "EIP-1193 error code the page receives. 4001 user rejected, 4100 unauthorized, 4900 disconnected, 4902 unrecognised chain.",
  }),
).annotate({ description: "Rejection code. Defaults to 4001 (user rejected)." });

export const PreviewAutomationWalletApproveInput = Schema.Struct({
  ...WalletTabFields,
  requestId: RequestIdField,
});
export type PreviewAutomationWalletApproveInput = typeof PreviewAutomationWalletApproveInput.Type;

export const PreviewAutomationWalletRejectInput = Schema.Struct({
  ...WalletTabFields,
  requestId: RequestIdField,
  code: RejectCodeField,
});
export type PreviewAutomationWalletRejectInput = typeof PreviewAutomationWalletRejectInput.Type;

export const PreviewAutomationWalletRequestList = Schema.Struct({
  requests: Schema.Array(PreviewWalletPendingRequest),
});
export type PreviewAutomationWalletRequestList = typeof PreviewAutomationWalletRequestList.Type;

export const PreviewAutomationWalletResolution = Web3WalletResolution;
export type PreviewAutomationWalletResolution = typeof PreviewAutomationWalletResolution.Type;

// ── Client RPCs ─────────────────────────────────────────────────────

export const PREVIEW_WALLET_WS_METHODS = {
  previewWalletSubscribe: "previewWallet.subscribe",
  previewWalletConfigure: "previewWallet.configure",
  previewWalletApprove: "previewWallet.approve",
  previewWalletReject: "previewWallet.reject",
} as const;

const PreviewWalletRpcError = Schema.Union([PreviewWalletError, EnvironmentAuthorizationError]);

/**
 * The wallet's state now, then again whenever it changes. Settings and every
 * tab's wallet chip share one subscription per environment.
 */
const WsPreviewWalletSubscribeRpc = Rpc.make(PREVIEW_WALLET_WS_METHODS.previewWalletSubscribe, {
  payload: Schema.Struct({}),
  success: PreviewWalletStatus,
  error: PreviewWalletRpcError,
  stream: true,
});

/** Account changes only; persistent preferences go through server settings. */
const WsPreviewWalletConfigureRpc = Rpc.make(PREVIEW_WALLET_WS_METHODS.previewWalletConfigure, {
  payload: Web3WalletAccountConfigureInput,
  success: PreviewWalletStatus,
  error: PreviewWalletRpcError,
});

const WsPreviewWalletApproveRpc = Rpc.make(PREVIEW_WALLET_WS_METHODS.previewWalletApprove, {
  payload: Schema.Struct({ requestId: Web3RequestId }),
  success: Web3WalletResolution,
  error: PreviewWalletRpcError,
});

const WsPreviewWalletRejectRpc = Rpc.make(PREVIEW_WALLET_WS_METHODS.previewWalletReject, {
  payload: Schema.Struct({ requestId: Web3RequestId, code: Schema.optional(Web3RejectCode) }),
  success: Web3WalletResolution,
  error: PreviewWalletRpcError,
});

export const PreviewWalletRpcGroup = RpcGroup.make(
  WsPreviewWalletSubscribeRpc,
  WsPreviewWalletConfigureRpc,
  WsPreviewWalletApproveRpc,
  WsPreviewWalletRejectRpc,
);
