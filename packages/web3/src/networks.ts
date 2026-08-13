/**
 * Dependency-free metadata for networks the preview wallet can use without
 * configuration. Kept apart from `./chain` so renderer controls can list the
 * same catalog without pulling the HTTP client into the web bundle.
 *
 * @module Web3Networks
 */
import type { Web3NativeCurrency } from "./schema.ts";

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
