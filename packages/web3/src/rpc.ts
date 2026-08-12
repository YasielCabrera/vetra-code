/**
 * Method classification and request summarisation for the preview wallet.
 *
 * Dependency-free on purpose: the renderer imports the summariser to label
 * pending approvals, the main process imports the classifier to route, and the
 * unit tests import both without a runtime. Anything needing `effect` or
 * `viem` belongs in `./chain` or `./signer`.
 *
 * @module Web3Rpc
 */

/**
 * - `local` — answered from wallet state, no approval, no network.
 * - `connect` — grants an origin access to accounts.
 * - `signature` — produces a signature or broadcasts a transaction.
 * - `chain` — changes which chain the wallet reports.
 * - `asset` — asks the wallet to track a token.
 * - `passthrough` — forwarded verbatim to the active chain's JSON-RPC endpoint.
 */
export type Web3MethodKind = "local" | "connect" | "signature" | "chain" | "asset" | "passthrough";

const LOCAL_METHODS: ReadonlySet<string> = new Set([
  "eth_accounts",
  "eth_chainId",
  "eth_coinbase",
  "net_version",
  "wallet_getPermissions",
  "wallet_revokePermissions",
  "web3_clientVersion",
]);

const CONNECT_METHODS: ReadonlySet<string> = new Set([
  "eth_requestAccounts",
  "wallet_requestPermissions",
]);

const SIGNATURE_METHODS: ReadonlySet<string> = new Set([
  "eth_sendTransaction",
  "eth_sign",
  "eth_signTransaction",
  "eth_signTypedData",
  "eth_signTypedData_v1",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
]);

const CHAIN_METHODS: ReadonlySet<string> = new Set([
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
]);

const ASSET_METHODS: ReadonlySet<string> = new Set(["wallet_watchAsset"]);

export function classifyWeb3Method(method: string): Web3MethodKind {
  if (LOCAL_METHODS.has(method)) return "local";
  if (CONNECT_METHODS.has(method)) return "connect";
  if (SIGNATURE_METHODS.has(method)) return "signature";
  if (CHAIN_METHODS.has(method)) return "chain";
  if (ASSET_METHODS.has(method)) return "asset";
  return "passthrough";
}

/** Kinds that park for approval when the approval gate says to ask. */
export function web3MethodRequiresApproval(kind: Web3MethodKind): boolean {
  return kind === "connect" || kind === "signature" || kind === "chain" || kind === "asset";
}

/**
 * Methods that must never reach an origin without an account grant, even
 * though they are cheap to answer. `eth_accounts` returns `[]` rather than
 * failing for un-granted origins, matching MetaMask.
 */
export function web3MethodNeedsAccountGrant(method: string): boolean {
  return SIGNATURE_METHODS.has(method);
}

// ── Hex helpers ──────────────────────────────────────────────────────

export function toQuantityHex(value: bigint | number): string {
  const big = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  return `0x${big.toString(16)}`;
}

export function fromQuantityHex(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "bigint") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return /^[0-9]+$/.test(trimmed) ? BigInt(trimmed) : null;
  }
  return BigInt(trimmed);
}

export function chainIdToHex(chainId: number): string {
  return toQuantityHex(chainId);
}

/** Returns `null` rather than throwing so a malformed page request stays a 4902. */
export function parseChainId(value: unknown): number | null {
  const parsed = fromQuantityHex(value);
  if (parsed === null || parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(parsed);
}

/**
 * Decode a `personal_sign` payload for display. Pages send either hex or (in
 * violation of the spec, but common) a plain string, and hex that is not valid
 * UTF-8 must stay hex rather than render as replacement characters.
 */
export function decodeSignableMessage(value: unknown): string {
  if (typeof value !== "string") return String(value);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) return value;
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded.includes("�") ? value : decoded;
  } catch {
    return value;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatWei(value: unknown): string {
  const wei = fromQuantityHex(value);
  if (wei === null) return "0";
  if (wei === 0n) return "0";
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function paramAt(params: unknown, index: number): unknown {
  return Array.isArray(params) ? params[index] : undefined;
}

/**
 * One-line, human-checkable rendering of a request. This is what a user reads
 * before approving and what an agent reads out of `preview_wallet_requests`,
 * so it has to name the consequence, not just the method.
 */
export function summarizeWeb3Request(input: {
  readonly method: string;
  readonly params: unknown;
  readonly origin: string;
}): string {
  const { method, params, origin } = input;
  switch (method) {
    case "eth_requestAccounts":
    case "wallet_requestPermissions":
      return `Connect wallet accounts to ${origin}.`;

    case "personal_sign": {
      // personal_sign is [message, address]; eth_sign reverses them.
      const message = decodeSignableMessage(paramAt(params, 0));
      return `Sign message from ${origin}: "${truncate(message, 600)}"`;
    }

    case "eth_sign": {
      const message = decodeSignableMessage(paramAt(params, 1));
      return `Sign message (eth_sign) from ${origin}: "${truncate(message, 600)}"`;
    }

    case "eth_signTypedData":
    case "eth_signTypedData_v1":
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4": {
      // v3/v4 put the address first and a JSON string second; v1 sends an array.
      const raw = paramAt(params, 1) ?? paramAt(params, 0);
      let parsed: unknown = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
      const record = asRecord(parsed);
      const domain = asRecord(record?.domain);
      const domainName = typeof domain?.name === "string" ? domain.name : "unknown domain";
      const primaryType = typeof record?.primaryType === "string" ? record.primaryType : "unknown";
      return `Sign typed data (${primaryType}) for ${domainName} from ${origin}.`;
    }

    case "eth_sendTransaction":
    case "eth_signTransaction": {
      const tx = asRecord(paramAt(params, 0));
      const to = typeof tx?.to === "string" ? tx.to : null;
      const value = formatWei(tx?.value);
      const data = typeof tx?.data === "string" ? tx.data : "0x";
      const calldata =
        data.length > 2 ? ` calling ${truncate(data, 12)} (${(data.length - 2) / 2} bytes)` : "";
      const verb = method === "eth_signTransaction" ? "Sign" : "Send";
      const target = to === null ? "a new contract" : to;
      return `${verb} transaction from ${origin}: ${value} native to ${target}${calldata}.`;
    }

    case "wallet_switchEthereumChain": {
      const chainId = parseChainId(asRecord(paramAt(params, 0))?.chainId);
      return `Switch to chain ${chainId ?? "unknown"} at the request of ${origin}.`;
    }

    case "wallet_addEthereumChain": {
      const chain = asRecord(paramAt(params, 0));
      const chainId = parseChainId(chain?.chainId);
      const name = typeof chain?.chainName === "string" ? chain.chainName : `chain ${chainId}`;
      const rpc = Array.isArray(chain?.rpcUrls) ? chain.rpcUrls[0] : undefined;
      const via = typeof rpc === "string" ? ` via ${rpc}` : "";
      return `Add chain ${name} (${chainId ?? "unknown"})${via}, requested by ${origin}.`;
    }

    case "wallet_watchAsset": {
      const record = asRecord(params) ?? asRecord(paramAt(params, 0));
      const options = asRecord(record?.options);
      const symbol = typeof options?.symbol === "string" ? options.symbol : "token";
      const address = typeof options?.address === "string" ? options.address : "unknown address";
      return `Track ${symbol} (${address}) requested by ${origin}.`;
    }

    default:
      return `${method} from ${origin}.`;
  }
}
