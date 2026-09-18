/**
 * MCP tools for the preview wallet.
 *
 * Kept in a toolkit of their own rather than added to the preview toolkit
 * because registration is conditional: a server whose `web3Wallet.enabled` is
 * false never advertises these at all (see `McpHttpServer.ts`).
 */
import {
  PreviewAutomationError,
  PreviewAutomationTabTargetInput,
  PreviewAutomationWalletApproveInput,
  PreviewAutomationWalletConfigureInput,
  PreviewAutomationWalletRejectInput,
  PreviewAutomationWalletRequestList,
  PreviewAutomationWalletResolution,
} from "@t3tools/contracts";
import { PreviewWalletDisabledError, Web3WalletStatus } from "@t3tools/web3/schema";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import * as ServerSettings from "../../../serverSettings.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  PreviewAutomationBroker.PreviewAutomationBroker,
  ServerSettings.ServerSettingsService,
];

/**
 * `PreviewWalletDisabledError` is the only wallet error raised server-side, by
 * the call-time gate. Desktop-side wallet failures (no chain, unknown request,
 * a reverted send) come back through the broker as
 * `PreviewAutomationExecutionError` carrying the original tag and message.
 */
const walletFailure = Schema.Union([PreviewAutomationError, PreviewWalletDisabledError]);

const walletTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, false) as T;

const readonlyWalletTool = <T extends Tool.Any>(tool: T): T =>
  walletTool(tool).annotate(Tool.Readonly, true).annotate(Tool.Idempotent, true) as T;

export const PreviewWalletStatusTool = readonlyWalletTool(
  Tool.make("preview_wallet_status", {
    description:
      "Report the preview wallet's state: whether it is enabled, its accounts and active account, the chain and whether that chain's RPC is reachable, the approval mode, any requests waiting for approval, and which origins have been granted account access.",
    parameters: PreviewAutomationTabTargetInput,
    success: Web3WalletStatus,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Get preview wallet status"),
);

export const PreviewWalletConfigureTool = walletTool(
  Tool.make("preview_wallet_configure", {
    description:
      "Configure the preview wallet before or during a test. Set approvalMode to always-ask to make signing requests park so they can be approved or rejected deterministically, switch the active account, rename an account, override the chain id and RPC URL, add a generated test account, remove an account, or clear per-origin connect grants. Custom networks and built-in enable/disable live in Settings > Web3.",
    parameters: PreviewAutomationWalletConfigureInput,
    success: Web3WalletStatus,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Configure preview wallet"),
);

export const PreviewWalletRequestsTool = readonlyWalletTool(
  Tool.make("preview_wallet_requests", {
    description:
      "List the preview wallet requests waiting for approval, oldest first, each with the requesting origin, the EIP-1193 method, the raw params, and a decoded human-readable summary of what approving it would do.",
    parameters: PreviewAutomationTabTargetInput,
    success: PreviewAutomationWalletRequestList,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "List pending wallet requests"),
);

export const PreviewWalletApproveTool = walletTool(
  Tool.make("preview_wallet_approve", {
    description:
      "Approve one pending preview wallet request by id, letting the page receive the signature, transaction hash, or accounts it asked for. Use preview_wallet_requests first to see what is waiting.",
    parameters: PreviewAutomationWalletApproveInput,
    success: PreviewAutomationWalletResolution,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Approve wallet request"),
);

export const PreviewWalletRejectTool = walletTool(
  Tool.make("preview_wallet_reject", {
    description:
      "Reject one pending preview wallet request by id so the page receives an EIP-1193 error. Defaults to code 4001 (user rejected), which is what dapp rejection branches check for.",
    parameters: PreviewAutomationWalletRejectInput,
    success: PreviewAutomationWalletResolution,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Reject wallet request"),
);

export const PreviewWalletToolkit = Toolkit.make(
  PreviewWalletStatusTool,
  PreviewWalletConfigureTool,
  PreviewWalletRequestsTool,
  PreviewWalletApproveTool,
  PreviewWalletRejectTool,
);
