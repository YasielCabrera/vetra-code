/**
 * Pure helpers for the Web3 settings panel, split out so they can be unit
 * tested without rendering (the convention `SettingsPanels.logic.ts` follows).
 */
import type { Web3ApprovalMode, Web3WalletStatus } from "@vetra-code/web3/schema";

export const APPROVAL_MODE_OPTIONS: ReadonlyArray<{
  readonly value: Web3ApprovalMode;
  readonly label: string;
}> = [
  { value: "auto-for-agents", label: "Approve for agents" },
  { value: "always-ask", label: "Always ask" },
  { value: "always-auto", label: "Approve everything" },
];

export function shortenAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type ParsedSetting<A> =
  | { readonly valid: true; readonly value: A }
  | { readonly valid: false };

/** Empty clears the override; anything that is not a positive integer is rejected. */
export function parseChainIdInput(raw: string): ParsedSetting<number | null> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { valid: false };
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 && Number.isSafeInteger(parsed)
    ? { valid: true, value: parsed }
    : { valid: false };
}

/** Empty clears the override; the wallet speaks HTTP JSON-RPC, so ws:// is rejected. */
export function parseRpcUrlInput(raw: string): ParsedSetting<string | null> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: true, value: null };
  if (trimmed.length > 2048 || !/^https?:\/\//i.test(trimmed)) return { valid: false };
  try {
    const parsed = new URL(trimmed);
    return parsed.host.length > 0 ? { valid: true, value: trimmed } : { valid: false };
  } catch {
    return { valid: false };
  }
}

/**
 * One sentence describing what the wallet is actually pointed at, including the
 * unreachable case — a silently dead RPC is the most confusing failure here.
 */
export function describeWalletChain(status: Web3WalletStatus | null): string {
  if (!status) return "";
  if (!status.enabled) return "The wallet is off.";
  if (status.chain === null) {
    return "No chain resolved yet: set one here, start a local node, or let the page add one.";
  }
  const target = status.chain.rpcUrl ?? "no endpoint";
  return status.rpcReachable
    ? `Currently on ${status.chain.name} (${status.chain.chainId}) via ${target}.`
    : `Currently on ${status.chain.name} (${status.chain.chainId}), but ${target} did not answer — reads and transactions will fail.`;
}

/** Compact label for the preview toolbar chip. */
export function formatWalletChip(status: Web3WalletStatus | null): string | null {
  if (!status?.enabled) return null;
  const account =
    status.selectedAddress === null ? "No account" : shortenAddress(status.selectedAddress);
  const chain = status.chain === null ? "No network" : status.chain.name;
  return `${chain} · ${account}`;
}
