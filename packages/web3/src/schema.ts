/**
 * Wire schemas for the preview wallet.
 *
 * This package is a leaf: it must not import `@vetra-code/contracts` or
 * `@vetra-code/shared`, because `@vetra-code/contracts` depends on *it*.
 * The few string primitives it needs are therefore redefined here rather
 * than borrowed from `contracts/baseSchemas.ts`.
 *
 * @module Web3Schema
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const Trimmed = Schema.String.check(Schema.isTrimmed());
const TrimmedNonEmpty = Trimmed.check(Schema.isNonEmpty());

/**
 * EIP-55 mixed-case addresses are accepted as-is; the wallet lowercases
 * internally and checksums only when rendering, so both forms decode.
 */
export const Web3Address = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/));
export type Web3Address = typeof Web3Address.Type;

/** `0x`-prefixed hex of any even length, including the empty `0x`. */
export const Web3Hex = Schema.String.check(Schema.isPattern(/^0x(?:[0-9a-fA-F]{2})*$/));
export type Web3Hex = typeof Web3Hex.Type;

/**
 * Chain ids cross the wire as decimal numbers. The EIP-1193 surface speaks
 * hex (`eth_chainId`, `wallet_switchEthereumChain`), so conversion happens at
 * the provider boundary in `./rpc`, not here — settings and tool inputs stay
 * readable.
 */
export const Web3ChainId = Schema.Int.check(Schema.isGreaterThan(0));
export type Web3ChainId = typeof Web3ChainId.Type;

export const Web3RpcUrl = TrimmedNonEmpty.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(/^https?:\/\//i),
);
export type Web3RpcUrl = typeof Web3RpcUrl.Type;

export const WEB3_ACCOUNT_SOURCES = ["generated", "imported"] as const;
export const Web3AccountSource = Schema.Literals(WEB3_ACCOUNT_SOURCES);
export type Web3AccountSource = typeof Web3AccountSource.Type;

/** Display names in the wallet UI; long enough for a sentence, short enough for a chip. */
export const WEB3_ACCOUNT_LABEL_MAX_LENGTH = 120;

export const Web3Account = Schema.Struct({
  address: Web3Address.annotate({ description: "Checksummed 0x-prefixed account address." }),
  label: Trimmed.check(Schema.isMaxLength(WEB3_ACCOUNT_LABEL_MAX_LENGTH)).annotate({
    description: "Human-readable label shown in the wallet UI.",
  }),
  source: Web3AccountSource.annotate({
    description:
      "generated = derived from the wallet's own test mnemonic; imported = supplied by the user.",
  }),
  /** Index within the wallet mnemonic. `null` for raw imported private keys. */
  derivationIndex: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "BIP-44 index within the wallet mnemonic, or null for imported private keys.",
  }),
});
export type Web3Account = typeof Web3Account.Type;

export const Web3NativeCurrency = Schema.Struct({
  name: TrimmedNonEmpty.check(Schema.isMaxLength(60)).annotate({
    description: "Native currency name, for example Ether.",
  }),
  symbol: TrimmedNonEmpty.check(Schema.isMaxLength(12)).annotate({
    description: "Native currency symbol, for example ETH.",
  }),
  decimals: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 36 })).annotate({
    description: "Native currency decimals, normally 18.",
  }),
});
export type Web3NativeCurrency = typeof Web3NativeCurrency.Type;

export const Web3Chain = Schema.Struct({
  chainId: Web3ChainId.annotate({ description: "Decimal EIP-155 chain id." }),
  name: TrimmedNonEmpty.check(Schema.isMaxLength(120)).annotate({
    description: "Display name for the chain.",
  }),
  rpcUrl: Schema.NullOr(Web3RpcUrl).annotate({
    description: "HTTP JSON-RPC endpoint, or null when no endpoint is known for this chain.",
  }),
  nativeCurrency: Web3NativeCurrency.annotate({ description: "Native currency metadata." }),
});
export type Web3Chain = typeof Web3Chain.Type;

/**
 * A user-authored network, stored in Settings. Distinct from the bundled
 * catalog: these survive restarts and show up in the picker the same way
 * MetaMask custom networks do.
 */
export const Web3CustomNetwork = Schema.Struct({
  chainId: Web3ChainId.annotate({ description: "Decimal EIP-155 chain id." }),
  name: TrimmedNonEmpty.check(Schema.isMaxLength(120)).annotate({
    description: "Display name for the custom network.",
  }),
  rpcUrl: Web3RpcUrl.annotate({
    description: "HTTP JSON-RPC endpoint for reads and broadcasts.",
  }),
  nativeCurrency: Web3NativeCurrency.annotate({ description: "Native currency metadata." }),
});
export type Web3CustomNetwork = typeof Web3CustomNetwork.Type;

export const WEB3_APPROVAL_MODES = ["auto-for-agents", "always-ask", "always-auto"] as const;
export const Web3ApprovalMode = Schema.Literals(WEB3_APPROVAL_MODES);
export type Web3ApprovalMode = typeof Web3ApprovalMode.Type;

export const DEFAULT_WEB3_APPROVAL_MODE: Web3ApprovalMode = "auto-for-agents";

export const Web3RequestId = TrimmedNonEmpty.check(Schema.isMaxLength(128));
export type Web3RequestId = typeof Web3RequestId.Type;

export const Web3PendingRequest = Schema.Struct({
  requestId: Web3RequestId.annotate({
    description: "Opaque id to pass to preview_wallet_approve or preview_wallet_reject.",
  }),
  origin: Trimmed.check(Schema.isMaxLength(2048)).annotate({
    description: "Origin of the page that made the request.",
  }),
  method: TrimmedNonEmpty.check(Schema.isMaxLength(120)).annotate({
    description: "EIP-1193 method name, for example personal_sign.",
  }),
  params: Schema.Unknown.annotate({ description: "Raw JSON-RPC params as sent by the page." }),
  summary: Schema.String.check(Schema.isMaxLength(4000)).annotate({
    description: "Human-readable decoding of the request for review before approving.",
  }),
  createdAt: TrimmedNonEmpty.annotate({ description: "ISO-8601 timestamp the request arrived." }),
});
export type Web3PendingRequest = typeof Web3PendingRequest.Type;

/**
 * EIP-1193 / EIP-1474 provider error codes the wallet can return. Exposed as a
 * closed set so rejection paths are testable rather than a free-form number.
 */
export const WEB3_REJECT_CODES = [4001, 4100, 4900, 4902] as const;
export const Web3RejectCode = Schema.Literals(WEB3_REJECT_CODES);
export type Web3RejectCode = typeof Web3RejectCode.Type;

export const DEFAULT_WEB3_REJECT_CODE: Web3RejectCode = 4001;

export const WEB3_REJECT_MESSAGES: Readonly<Record<Web3RejectCode, string>> = {
  4001: "User rejected the request.",
  4100: "The requested account or method has not been authorized by the user.",
  4900: "The provider is disconnected from all chains.",
  4902: "The provider is not connected to the requested chain.",
};

export const Web3WalletStatus = Schema.Struct({
  enabled: Schema.Boolean.annotate({
    description: "Whether the preview wallet is turned on in Settings > Web3.",
  }),
  accounts: Schema.Array(Web3Account).annotate({ description: "All accounts held by the wallet." }),
  selectedAddress: Schema.NullOr(Web3Address).annotate({
    description: "Account returned first from eth_accounts, or null when the wallet has no keys.",
  }),
  chain: Schema.NullOr(Web3Chain).annotate({
    description: "Chain the wallet currently reports to pages, or null when none is resolved.",
  }),
  rpcReachable: Schema.Boolean.annotate({
    description:
      "Whether the active chain's JSON-RPC endpoint answered eth_chainId. False means reads and transactions will fail.",
  }),
  approvalMode: Web3ApprovalMode.annotate({
    description:
      "auto-for-agents approves silently for agent-driven tabs; always-ask parks every request; always-auto approves everything.",
  }),
  pendingRequests: Schema.Array(Web3PendingRequest).annotate({
    description: "Requests parked awaiting approval, oldest first.",
  }),
  connectedOrigins: Schema.Array(Trimmed.check(Schema.isMaxLength(2048))).annotate({
    description: "Origins that have been granted account access.",
  }),
});
export type Web3WalletStatus = typeof Web3WalletStatus.Type;

// ── Persisted keystore ───────────────────────────────────────────────

/**
 * On-disk shape of a preview wallet. Deliberately plaintext and deliberately
 * loud about it: this holds throwaway test keys for a browser preview that
 * renders untrusted web content, and presenting it as secure storage would
 * invite someone to put real funds behind it.
 */
export const WEB3_KEYSTORE_WARNING =
  "TEST WALLET ONLY. These keys sign for the Vetra Code browser preview and are stored in plaintext. Never import a mnemonic or private key that holds real funds.";

export const Web3KeystoreFile = Schema.Struct({
  schemaVersion: Schema.Literal(1).pipe(Schema.withDecodingDefault(Effect.succeed(1 as const))),
  warning: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(WEB3_KEYSTORE_WARNING))),
  mnemonic: Schema.NullOr(TrimmedNonEmpty).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Raw imported private keys, kept apart from mnemonic-derived accounts. */
  privateKeys: Schema.Array(Web3Hex).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  accounts: Schema.Array(Web3Account).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  selectedAddress: Schema.NullOr(Web3Address).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  connectedOrigins: Schema.Array(Trimmed).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type Web3KeystoreFile = typeof Web3KeystoreFile.Type;

// ── Errors ───────────────────────────────────────────────────────────

export class PreviewWalletDisabledError extends Schema.TaggedError<PreviewWalletDisabledError>()(
  "PreviewWalletDisabledError",
  {},
) {
  override get message(): string {
    return "The preview wallet is disabled. Turn it on in Settings > Web3 (the preview_wallet_* tools require a server restart to appear).";
  }
}

export class PreviewWalletRequestNotFoundError extends Schema.TaggedError<PreviewWalletRequestNotFoundError>()(
  "PreviewWalletRequestNotFoundError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return `No pending preview wallet request with id ${this.requestId}. It may have already been approved, rejected, or timed out.`;
  }
}

export class PreviewWalletNoChainError extends Schema.TaggedError<PreviewWalletNoChainError>()(
  "PreviewWalletNoChainError",
  {},
) {
  override get message(): string {
    return "No chain is resolved for the preview wallet. Enable a built-in network in Settings > Web3, add a custom network, run a local node on 127.0.0.1:8545, or let the page call wallet_addEthereumChain.";
  }
}

export class PreviewWalletNoAccountError extends Schema.TaggedError<PreviewWalletNoAccountError>()(
  "PreviewWalletNoAccountError",
  {},
) {
  override get message(): string {
    return "The preview wallet holds no accounts. Generate or import one in Settings > Web3.";
  }
}

export class PreviewWalletRpcError extends Schema.TaggedError<PreviewWalletRpcError>()(
  "PreviewWalletRpcError",
  {
    method: Schema.String,
    rpcUrl: Schema.String,
    code: Schema.optional(Schema.Number),
    detail: Schema.String,
  },
) {
  override get message(): string {
    const code = this.code === undefined ? "" : ` (code ${this.code})`;
    return `JSON-RPC ${this.method} failed against ${this.rpcUrl}${code}: ${this.detail}`;
  }
}

export class PreviewWalletSigningError extends Schema.TaggedError<PreviewWalletSigningError>()(
  "PreviewWalletSigningError",
  {
    method: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Preview wallet could not sign ${this.method}: ${this.detail}`;
  }
}

export class PreviewWalletKeystoreError extends Schema.TaggedError<PreviewWalletKeystoreError>()(
  "PreviewWalletKeystoreError",
  {
    operation: Schema.Literals(["read", "write", "derive", "import"]),
    path: Schema.optional(Schema.String),
    detail: Schema.String,
  },
) {
  override get message(): string {
    const at = this.path === undefined ? "" : ` at ${this.path}`;
    return `Preview wallet keystore ${this.operation} failed${at}: ${this.detail}`;
  }
}

export const PreviewWalletError = Schema.Union([
  PreviewWalletDisabledError,
  PreviewWalletRequestNotFoundError,
  PreviewWalletNoChainError,
  PreviewWalletNoAccountError,
  PreviewWalletRpcError,
  PreviewWalletSigningError,
  PreviewWalletKeystoreError,
]);
export type PreviewWalletError = typeof PreviewWalletError.Type;
export const isPreviewWalletError = Schema.is(PreviewWalletError);
