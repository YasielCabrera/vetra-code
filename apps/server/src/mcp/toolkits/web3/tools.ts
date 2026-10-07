/**
 * MCP tools for the preview wallet.
 *
 * Kept in a toolkit of their own rather than added to the preview toolkit
 * because registration is conditional: a server whose `web3Wallet.enabled` is
 * false never advertises these at all (see `McpHttpServer.ts`).
 */
import {
  OrchestratorMcpFailure,
  PreviewAutomationUnavailableError,
  PreviewAutomationWalletApproveInput,
  PreviewAutomationWalletConfigureInput,
  PreviewAutomationWalletRejectInput,
  PreviewAutomationWalletRequestList,
  PreviewAutomationWalletResolution,
  PreviewAutomationWalletTargetInput,
  PreviewWalletStatus,
} from "@t3tools/contracts";
import { PreviewWalletError } from "@t3tools/web3/schema";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerPreviewWallet from "../../../web3/ServerPreviewWallet.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ServerPreviewWallet.ServerPreviewWallet,
];

/**
 * `PreviewWalletError` covers the wallet itself (turned off, no chain, a
 * request that is gone or another session's, a reverted send);
 * `OrchestratorMcpFailure` and `PreviewAutomationUnavailableError` are the
 * access and capability gates.
 */
const walletFailure = Schema.Union([
  PreviewWalletError,
  PreviewAutomationUnavailableError,
  OrchestratorMcpFailure,
]);

const walletTool = <T extends Tool.Any>(tool: T): T =>
  tool.annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, false) as T;

const readonlyWalletTool = <T extends Tool.Any>(tool: T): T =>
  walletTool(tool).annotate(Tool.Readonly, true).annotate(Tool.Idempotent, true) as T;

export const PreviewWalletStatusTool = readonlyWalletTool(
  Tool.make("preview_wallet_status", {
    description:
      "Report the preview wallet's state: whether it is enabled, its accounts and active account, the chain and whether that chain's RPC is reachable, the approval mode, the requests waiting for approval from your preview tabs (each with its tabId), and which origins have been granted account access. Every preview tab of this environment signs with this one wallet.",
    parameters: PreviewAutomationWalletTargetInput,
    success: PreviewWalletStatus,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Get preview wallet status"),
);

export const PreviewWalletConfigureTool = walletTool(
  Tool.make("preview_wallet_configure", {
    description:
      "Configure the preview wallet before or during a test. Set approvalMode to always-ask to make signing requests park so they can be approved or rejected deterministically, switch the active account, rename an account, override the chain id and RPC URL, add a generated test account, remove an account, or clear per-origin connect grants. Approval mode and chain overrides last until the wallet's settings change or the server restarts. Account changes apply to every preview tab of this environment. Custom networks and built-in enable/disable live in Settings > Web3.",
    parameters: PreviewAutomationWalletConfigureInput,
    success: PreviewWalletStatus,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Configure preview wallet"),
);

export const PreviewWalletRequestsTool = readonlyWalletTool(
  Tool.make("preview_wallet_requests", {
    description:
      "List the preview wallet requests waiting for approval from your preview tabs (or one tab with tabId), oldest first, each with its tabId, the requesting origin, the EIP-1193 method, the raw params, and a decoded human-readable summary of what approving it would do.",
    parameters: PreviewAutomationWalletTargetInput,
    success: PreviewAutomationWalletRequestList,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "List pending wallet requests"),
);

export const PreviewWalletApproveTool = walletTool(
  Tool.make("preview_wallet_approve", {
    description:
      "Approve one pending preview wallet request by id, letting the page receive the signature, transaction hash, or accounts it asked for. Use preview_wallet_requests first to see what is waiting. Only requests from your own preview tabs can be approved; with tabId, the request must come from that tab.",
    parameters: PreviewAutomationWalletApproveInput,
    success: PreviewAutomationWalletResolution,
    failure: walletFailure,
    dependencies,
  }).annotate(Tool.Title, "Approve wallet request"),
);

export const PreviewWalletRejectTool = walletTool(
  Tool.make("preview_wallet_reject", {
    description:
      "Reject one pending preview wallet request by id so the page receives an EIP-1193 error. Defaults to code 4001 (user rejected), which is what dapp rejection branches check for. Only requests from your own preview tabs can be rejected.",
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
