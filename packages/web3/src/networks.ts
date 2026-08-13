/**
 * Dependency-free metadata for networks the preview wallet can use without
 * configuration. Kept apart from `./chain` so renderer controls can list the
 * same catalog without pulling the HTTP client into the web bundle.
 *
 * @module Web3Networks
 */
import type { Web3CustomNetwork, Web3NativeCurrency } from "./schema.ts";

/** MetaMask-compatible wallets conventionally start on Ethereum Mainnet. */
export const DEFAULT_PUBLIC_CHAIN_ID = 1;

const ETHER: Web3NativeCurrency = { name: "Ether", symbol: "ETH", decimals: 18 };

export interface Web3DefaultNetwork {
  readonly chainId: number;
  readonly name: string;
  readonly rpcUrl: string;
  readonly nativeCurrency: Web3NativeCurrency;
}

/** Keyless, rate-limited endpoints intended for development and previews. */
export const DEFAULT_WEB3_NETWORKS: ReadonlyArray<Web3DefaultNetwork> = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    nativeCurrency: ETHER,
  },
  {
    chainId: 10,
    name: "OP Mainnet",
    rpcUrl: "https://mainnet.optimism.io",
    nativeCurrency: ETHER,
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  {
    chainId: 137,
    name: "Polygon",
    rpcUrl: "https://polygon.drpc.org",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  },
  {
    chainId: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    nativeCurrency: ETHER,
  },
  {
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    nativeCurrency: ETHER,
  },
  {
    chainId: 43114,
    name: "Avalanche C-Chain",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
];

export function getDefaultNetwork(chainId: number): Web3DefaultNetwork | null {
  return DEFAULT_WEB3_NETWORKS.find((network) => network.chainId === chainId) ?? null;
}

export function isBuiltInChainId(chainId: number): boolean {
  return getDefaultNetwork(chainId) !== null;
}

export function isBuiltInNetworkEnabled(
  chainId: number,
  disabledBuiltInChainIds: readonly number[],
): boolean {
  return isBuiltInChainId(chainId) && !disabledBuiltInChainIds.includes(chainId);
}

export function enabledBuiltInNetworks(
  disabledBuiltInChainIds: readonly number[],
): ReadonlyArray<Web3DefaultNetwork> {
  const disabled = new Set(disabledBuiltInChainIds);
  return DEFAULT_WEB3_NETWORKS.filter((network) => !disabled.has(network.chainId));
}

export function findCustomNetwork(
  customNetworks: readonly Web3CustomNetwork[],
  chainId: number,
): Web3CustomNetwork | null {
  return customNetworks.find((network) => network.chainId === chainId) ?? null;
}

/**
 * Built-in chain ids to persist after a toggle. Unknown ids are dropped so a
 * stale settings file cannot hide a network we no longer ship.
 */
export function setBuiltInNetworkEnabled(input: {
  readonly chainId: number;
  readonly enabled: boolean;
  readonly disabledBuiltInChainIds: readonly number[];
}): number[] {
  const disabled = new Set(
    input.disabledBuiltInChainIds.filter((chainId) => isBuiltInChainId(chainId)),
  );
  if (input.enabled) disabled.delete(input.chainId);
  else if (isBuiltInChainId(input.chainId)) disabled.add(input.chainId);
  return DEFAULT_WEB3_NETWORKS.filter((network) => disabled.has(network.chainId)).map(
    (network) => network.chainId,
  );
}

export interface WalletChainSelection {
  readonly chainId: number | null;
  readonly rpcUrl: string | null;
}

/**
 * When the active chain is hidden or deleted, move to another listed network
 * rather than leaving the wallet pointed at something the picker no longer
 * shows. `chainId: null` means automatic selection and is left alone.
 */
export function nextChainSelectionAfterCatalogChange(input: {
  readonly chainId: number | null;
  readonly rpcUrl: string | null;
  readonly removedOrDisabledChainId: number;
  readonly disabledBuiltInChainIds: readonly number[];
  readonly customNetworks: readonly Web3CustomNetwork[];
}): WalletChainSelection {
  if (input.chainId !== input.removedOrDisabledChainId) {
    return { chainId: input.chainId, rpcUrl: input.rpcUrl };
  }
  const enabled = enabledBuiltInNetworks(input.disabledBuiltInChainIds);
  const preferred =
    enabled.find((network) => network.chainId === DEFAULT_PUBLIC_CHAIN_ID) ?? enabled[0];
  if (preferred !== undefined) return { chainId: preferred.chainId, rpcUrl: null };
  const custom = input.customNetworks[0];
  if (custom !== undefined) return { chainId: custom.chainId, rpcUrl: custom.rpcUrl };
  return { chainId: null, rpcUrl: null };
}

export function nativeCurrencyFromSymbol(symbol: string): Web3NativeCurrency {
  const trimmed = symbol.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === "ETH") return ETHER;
  return { name: trimmed, symbol: trimmed, decimals: 18 };
}

export function replaceCustomNetwork(
  customNetworks: readonly Web3CustomNetwork[],
  previousChainId: number,
  next: Web3CustomNetwork,
): Web3CustomNetwork[] {
  return customNetworks.map((network) => (network.chainId === previousChainId ? next : network));
}

/**
 * If the edited network was the pinned chain, keep the wallet on it after
 * the chain id or RPC URL changes.
 */
export function nextChainSelectionAfterCustomNetworkEdit(input: {
  readonly chainId: number | null;
  readonly rpcUrl: string | null;
  readonly previousChainId: number;
  readonly next: Web3CustomNetwork;
}): WalletChainSelection {
  if (input.chainId !== input.previousChainId) {
    return { chainId: input.chainId, rpcUrl: input.rpcUrl };
  }
  return { chainId: input.next.chainId, rpcUrl: input.next.rpcUrl };
}
