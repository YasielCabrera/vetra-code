/**
 * Chain resolution and raw JSON-RPC transport for the preview wallet.
 *
 * "Follow the dapp" lives here: the wallet does not ship a curated chain list
 * with baked-in third-party RPC endpoints. It adopts what the page asks for via
 * `wallet_addEthereumChain` (which hands us an endpoint), what the user typed in
 * Settings > Web3, or a local node it can actually see. Anything else is
 * reported as unreachable rather than silently pointed at someone's public RPC.
 *
 * @module Web3Chain
 */
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { parseChainId } from "./rpc.ts";
import {
  PreviewWalletRpcError,
  type Web3Chain,
  type Web3NativeCurrency,
  type Web3RpcUrl,
} from "./schema.ts";

/** Anvil and Hardhat both default here; probing it is how zero-config works. */
export const DEFAULT_LOCAL_RPC_URL = "http://127.0.0.1:8545";

const ETHER: Web3NativeCurrency = { name: "Ether", symbol: "ETH", decimals: 18 };

/**
 * Names only — no RPC URLs. Naming a chain is cosmetic and safe; supplying an
 * endpoint we invented is not.
 */
const KNOWN_CHAIN_NAMES: Readonly<Record<number, { name: string; currency: Web3NativeCurrency }>> =
  {
    1: { name: "Ethereum Mainnet", currency: ETHER },
    10: { name: "OP Mainnet", currency: ETHER },
    137: { name: "Polygon", currency: { name: "POL", symbol: "POL", decimals: 18 } },
    1337: { name: "Localhost 1337", currency: ETHER },
    8453: { name: "Base", currency: ETHER },
    31337: { name: "Anvil / Hardhat", currency: ETHER },
    42161: { name: "Arbitrum One", currency: ETHER },
    11155111: { name: "Sepolia", currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 } },
  };

export function describeChain(chainId: number, rpcUrl: string | null): Web3Chain {
  const known = KNOWN_CHAIN_NAMES[chainId];
  return {
    chainId,
    name: known?.name ?? `Chain ${chainId}`,
    rpcUrl: rpcUrl as Web3RpcUrl | null,
    nativeCurrency: known?.currency ?? ETHER,
  };
}

function firstHttpUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (typeof entry === "string" && /^https?:\/\//i.test(entry.trim())) return entry.trim();
  }
  return null;
}

/**
 * Decode an `wallet_addEthereumChain` param into a chain we can adopt.
 * Returns `null` for anything malformed so the caller can answer 4902 rather
 * than adopting a half-formed chain.
 */
export function parseAddEthereumChain(params: unknown): Web3Chain | null {
  const raw = Array.isArray(params) ? params[0] : params;
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const chainId = parseChainId(record.chainId);
  if (chainId === null) return null;

  const rpcUrl = firstHttpUrl(record.rpcUrls);
  const fallback = describeChain(chainId, rpcUrl);
  const currency =
    typeof record.nativeCurrency === "object" && record.nativeCurrency !== null
      ? (record.nativeCurrency as Record<string, unknown>)
      : null;

  return {
    chainId,
    name:
      typeof record.chainName === "string" && record.chainName.trim().length > 0
        ? record.chainName.trim()
        : fallback.name,
    rpcUrl: rpcUrl as Web3RpcUrl | null,
    nativeCurrency:
      currency &&
      typeof currency.name === "string" &&
      typeof currency.symbol === "string" &&
      typeof currency.decimals === "number"
        ? {
            name: currency.name,
            symbol: currency.symbol,
            decimals: currency.decimals,
          }
        : fallback.nativeCurrency,
  };
}

interface JsonRpcEnvelope {
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

/**
 * One JSON-RPC round trip. JSON-RPC signals failure with a 200 body, so a
 * `result`/`error` check has to follow the status check.
 */
export const web3RpcRequest = Effect.fn("Web3Chain.rpcRequest")(function* (input: {
  readonly rpcUrl: string;
  readonly method: string;
  readonly params?: unknown;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.post(input.rpcUrl).pipe(
    HttpClientRequest.bodyJsonUnsafe({
      id: 1,
      jsonrpc: "2.0",
      method: input.method,
      params: input.params ?? [],
    }),
  );

  const failure = (detail: string, code?: number) =>
    new PreviewWalletRpcError({
      method: input.method,
      rpcUrl: input.rpcUrl,
      detail,
      ...(code === undefined ? {} : { code }),
    });

  const response = yield* httpClient.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.mapError((cause) => failure(String(cause))),
  );
  const body = yield* response.json.pipe(
    Effect.mapError(() => failure("Response body was not valid JSON.")),
  );

  const envelope = body as JsonRpcEnvelope;
  if (envelope?.error) {
    const code = typeof envelope.error.code === "number" ? envelope.error.code : undefined;
    const message =
      typeof envelope.error.message === "string" ? envelope.error.message : "Unknown RPC error.";
    return yield* failure(message, code);
  }
  return envelope?.result ?? null;
});

/**
 * `eth_chainId` against a candidate endpoint. Never fails — an unreachable or
 * non-Ethereum endpoint is a `null`, which callers report as `rpcReachable:
 * false` instead of surfacing a stack trace to the user.
 *
 * `catchCause` rather than `option`: a probe whose whole question is "is
 * anything listening?" must also absorb defects, or a transport that throws
 * instead of failing takes down wallet startup.
 */
export const probeChainId = Effect.fn("Web3Chain.probeChainId")(function* (rpcUrl: string) {
  const result = yield* web3RpcRequest({ rpcUrl, method: "eth_chainId" }).pipe(
    Effect.timeout("2 seconds"),
    Effect.catchCause(() => Effect.succeed(null)),
  );
  return result === null ? null : parseChainId(result);
});

/**
 * Precedence: an explicit setting wins; otherwise adopt a local node if one is
 * actually listening; otherwise no chain, and the page gets a clear error until
 * it calls `wallet_addEthereumChain` or the user configures one.
 */
export const resolveInitialChain = Effect.fn("Web3Chain.resolveInitialChain")(function* (input: {
  readonly settingsChainId: number | null;
  readonly settingsRpcUrl: string | null;
}) {
  if (input.settingsChainId !== null) {
    return describeChain(input.settingsChainId, input.settingsRpcUrl);
  }
  if (input.settingsRpcUrl !== null) {
    const probed = yield* probeChainId(input.settingsRpcUrl);
    return probed === null ? null : describeChain(probed, input.settingsRpcUrl);
  }
  const local = yield* probeChainId(DEFAULT_LOCAL_RPC_URL);
  return local === null ? null : describeChain(local, DEFAULT_LOCAL_RPC_URL);
});
