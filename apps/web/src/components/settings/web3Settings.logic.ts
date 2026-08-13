/**
 * Pure helpers for Web3 wallet UI (settings and the preview popover), split
 * out so they can be unit tested without rendering.
 */
import {
  findCustomNetwork,
  isBuiltInChainId,
  nativeCurrencyFromSymbol,
} from "@vetra-code/web3/networks";
import {
  WEB3_ACCOUNT_LABEL_MAX_LENGTH,
  type Web3ApprovalMode,
  type Web3CustomNetwork,
  type Web3WalletStatus,
} from "@vetra-code/web3/schema";

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

/** Confirm-dialog copy for dropping one preview-wallet account. */
export function removeAccountConfirmationMessage(account: {
  readonly label: string;
  readonly address: string;
}): string {
  return [
    `Remove ${account.label}?`,
    `${shortenAddress(account.address)} will be dropped from this test wallet. You can add another account later.`,
  ].join("\n");
}

/**
 * Click-to-edit commit rule for account names: trim, reject empty, skip when
 * nothing changed. The input's maxLength is the UX cap; this still guards a
 * paste that somehow overshoots.
 */
export function resolveAccountLabelCommit(input: {
  readonly label: string;
  readonly originalLabel: string;
}):
  | { readonly action: "commit"; readonly label: string }
  | { readonly action: "reject-empty" }
  | { readonly action: "reject-too-long" }
  | { readonly action: "noop" } {
  const trimmed = input.label.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed.length > WEB3_ACCOUNT_LABEL_MAX_LENGTH) return { action: "reject-too-long" };
  if (trimmed === input.originalLabel) return { action: "noop" };
  return { action: "commit", label: trimmed };
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
    return "No chain resolved yet: enable a built-in network, add a custom one, start a local node, or let the page add one.";
  }
  const target = status.chain.rpcUrl ?? "no endpoint";
  return status.rpcReachable
    ? `Currently on ${status.chain.name} (${status.chain.chainId}) via ${target}.`
    : `Currently on ${status.chain.name} (${status.chain.chainId}), but ${target} did not answer — reads and transactions will fail.`;
}

/** Empty is invalid here: adding a network requires an endpoint. */
export function parseRequiredRpcUrlInput(raw: string): ParsedSetting<string> {
  const parsed = parseRpcUrlInput(raw);
  if (!parsed.valid || parsed.value === null) return { valid: false };
  return { valid: true, value: parsed.value };
}

const CUSTOM_NETWORK_NAME_MAX_LENGTH = 120;
const CUSTOM_NETWORK_SYMBOL_MAX_LENGTH = 12;

export type CustomNetworkDraft = {
  readonly name: string;
  readonly chainId: string;
  readonly rpcUrl: string;
  readonly currencySymbol: string;
};

export type ParsedCustomNetwork =
  | { readonly valid: true; readonly network: Web3CustomNetwork }
  | { readonly valid: false; readonly error: string };

export function parseCustomNetworkDraft(
  draft: CustomNetworkDraft,
  customNetworks: readonly Web3CustomNetwork[],
  editingChainId: number | null = null,
): ParsedCustomNetwork {
  const name = draft.name.trim();
  if (name.length === 0) return { valid: false, error: "Enter a network name." };
  if (name.length > CUSTOM_NETWORK_NAME_MAX_LENGTH) {
    return { valid: false, error: "Network name is too long." };
  }

  const chainId = parseChainIdInput(draft.chainId);
  if (!chainId.valid || chainId.value === null) {
    return { valid: false, error: "Enter a positive chain ID." };
  }
  if (isBuiltInChainId(chainId.value)) {
    return {
      valid: false,
      error: "That chain ID is already a built-in network. Enable it in the list above.",
    };
  }
  if (
    findCustomNetwork(customNetworks, chainId.value) !== null &&
    chainId.value !== editingChainId
  ) {
    return { valid: false, error: "A custom network with that chain ID already exists." };
  }

  const rpcUrl = parseRequiredRpcUrlInput(draft.rpcUrl);
  if (!rpcUrl.valid) {
    return { valid: false, error: "Enter an http(s) RPC URL." };
  }

  const symbol = draft.currencySymbol.trim();
  if (symbol.length > CUSTOM_NETWORK_SYMBOL_MAX_LENGTH) {
    return { valid: false, error: "Currency symbol is too long." };
  }

  return {
    valid: true,
    network: {
      chainId: chainId.value,
      name,
      rpcUrl: rpcUrl.value,
      nativeCurrency: nativeCurrencyFromSymbol(symbol),
    },
  };
}

export function removeCustomNetworkConfirmationMessage(network: {
  readonly name: string;
  readonly chainId: number;
}): string {
  return [
    `Remove ${network.name}?`,
    `Chain ${network.chainId} will be dropped from this test wallet. You can add it again later.`,
  ].join("\n");
}

/** Compact label for the preview toolbar chip. */
export function formatWalletChip(status: Web3WalletStatus | null): string | null {
  if (!status?.enabled) return null;
  const account =
    status.selectedAddress === null ? "No account" : shortenAddress(status.selectedAddress);
  const chain = status.chain === null ? "No network" : status.chain.name;
  return `${chain} · ${account}`;
}

/**
 * Filled cells of a 5x5 mirrored identicon. Same address always yields the
 * same cells and hue, so the preview chip, popover, and settings list agree.
 */
export type IdenticonCell = {
  readonly x: number;
  readonly y: number;
};

export type IdenticonPattern = {
  readonly hue: number;
  readonly cells: readonly IdenticonCell[];
};

export function identiconPattern(address: string): IdenticonPattern {
  const rand = mulberry32(fnv1a(address.toLowerCase()));
  const hue = Math.floor(rand() * 360);
  const cells: IdenticonCell[] = [];
  for (let y = 0; y < 5; y += 1) {
    const left = rand() >= 0.5;
    const inner = rand() >= 0.5;
    const center = rand() >= 0.5;
    if (left) {
      cells.push({ x: 0, y }, { x: 4, y });
    }
    if (inner) {
      cells.push({ x: 1, y }, { x: 3, y });
    }
    if (center) {
      cells.push({ x: 2, y });
    }
  }
  return { hue, cells };
}

/** Tailwind background class for the network color dot. */
export function networkSwatchClass(chainId: number): string {
  switch (chainId) {
    case 1:
      return "bg-indigo-500";
    case 10:
      return "bg-red-500";
    case 56:
      return "bg-amber-400";
    case 137:
      return "bg-violet-500";
    case 8453:
      return "bg-blue-600";
    case 42161:
      return "bg-sky-500";
    case 43114:
      return "bg-rose-500";
    case 11155111:
      return "bg-purple-400";
    case 1337:
    case 31337:
      return "bg-emerald-500";
    default:
      return "bg-muted-foreground";
  }
}

/** Short title for a parked request, shown above the decoded summary. */
export function pendingRequestTitle(method: string): string {
  switch (method) {
    case "eth_requestAccounts":
    case "wallet_requestPermissions":
      return "Connection request";
    case "personal_sign":
    case "eth_sign":
      return "Signature request";
    case "eth_signTypedData":
    case "eth_signTypedData_v1":
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4":
      return "Typed data signature";
    case "eth_sendTransaction":
      return "Transaction request";
    case "eth_signTransaction":
      return "Sign transaction";
    case "wallet_switchEthereumChain":
      return "Switch network";
    case "wallet_addEthereumChain":
      return "Add network";
    case "wallet_watchAsset":
      return "Add token";
    default:
      return method;
  }
}

/** Hostname for the origin badge; falls back to the raw string if it is not a URL. */
export function originHostname(origin: string): string {
  try {
    const host = new URL(origin).host;
    return host.length > 0 ? host : origin;
  } catch {
    return origin;
  }
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
