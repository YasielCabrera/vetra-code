/**
 * Signing for the preview wallet.
 *
 * The only module that pulls `viem`. Keys never leave this boundary as raw
 * material: callers hand in a keystore plus an address and get a signature
 * back, so nothing above has to hold a private key to do its job.
 *
 * @module Web3Signer
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Hex, LocalAccount, TransactionSerializable } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { web3RpcRequest } from "./chain.ts";
import { fromQuantityHex, toQuantityHex } from "./rpc.ts";
import {
  PreviewWalletKeystoreError,
  PreviewWalletNoAccountError,
  PreviewWalletSigningError,
  type Web3Account,
  type Web3Address,
  type Web3Hex,
  type Web3KeystoreFile,
} from "./schema.ts";

const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

/** BIP-39 mnemonic for a throwaway preview wallet. */
export function generateWalletMnemonic(): string {
  return generateMnemonic(english);
}

const isHex = (value: string): value is Hex => /^0x[0-9a-fA-F]+$/.test(value);

function localAccountFromMnemonic(mnemonic: string, addressIndex: number): LocalAccount {
  return mnemonicToAccount(mnemonic, { addressIndex });
}

function localAccountFromPrivateKey(privateKey: string): LocalAccount {
  if (!isHex(privateKey)) {
    throw new Error("Private key must be 0x-prefixed hex.");
  }
  return privateKeyToAccount(privateKey);
}

/**
 * Derive `count` accounts from a mnemonic. Addresses come back checksummed
 * because that is what pages and block explorers display.
 */
export const deriveMnemonicAccounts = Effect.fn("Web3Signer.deriveMnemonicAccounts")(function* (
  mnemonic: string,
  count: number,
) {
  return yield* Effect.try({
    try: (): ReadonlyArray<Web3Account> =>
      Array.from({ length: Math.max(0, count) }, (_unused, index) => ({
        address: localAccountFromMnemonic(mnemonic, index).address as Web3Address,
        label: index === 0 ? "Preview account 1" : `Preview account ${index + 1}`,
        source: "generated" as const,
        derivationIndex: index,
      })),
    catch: (cause) =>
      new PreviewWalletKeystoreError({ operation: "derive", detail: String(cause) }),
  });
});

export const describeImportedPrivateKey = Effect.fn("Web3Signer.describeImportedPrivateKey")(
  function* (privateKey: string, label: string) {
    return yield* Effect.try({
      try: (): Web3Account => ({
        address: localAccountFromPrivateKey(privateKey).address as Web3Address,
        label,
        source: "imported" as const,
        derivationIndex: null,
      }),
      catch: (cause) =>
        new PreviewWalletKeystoreError({ operation: "import", detail: String(cause) }),
    });
  },
);

/**
 * Rebuild the signer for `address` from persisted material. Mnemonic-derived
 * accounts are re-derived from their index; imported ones are matched by
 * re-deriving each stored private key's address, which keeps the keystore from
 * having to hold an address→key map that could drift.
 */
export const resolveSigner = Effect.fn("Web3Signer.resolveSigner")(function* (
  keystore: Web3KeystoreFile,
  address: string,
) {
  const wanted = address.toLowerCase();
  const account = keystore.accounts.find((entry) => entry.address.toLowerCase() === wanted);
  if (!account) return yield* new PreviewWalletNoAccountError();

  return yield* Effect.try({
    try: (): LocalAccount => {
      if (account.derivationIndex !== null) {
        if (keystore.mnemonic === null) {
          throw new Error("Keystore has a derived account but no mnemonic.");
        }
        return localAccountFromMnemonic(keystore.mnemonic, account.derivationIndex);
      }
      for (const privateKey of keystore.privateKeys) {
        const candidate = localAccountFromPrivateKey(privateKey);
        if (candidate.address.toLowerCase() === wanted) return candidate;
      }
      throw new Error(`No private key in the keystore matches ${address}.`);
    },
    catch: (cause) =>
      new PreviewWalletKeystoreError({ operation: "derive", detail: String(cause) }),
  });
});

const signingFailure = (method: string) => (cause: unknown) =>
  new PreviewWalletSigningError({ method, detail: String(cause) });

/**
 * EIP-191 `personal_sign`. Pages send hex per spec but plenty send a bare
 * string; hex has to be signed as raw bytes, not as its textual form, or the
 * recovered signer will not match what the dapp verifies.
 */
export const signPersonalMessage = Effect.fn("Web3Signer.signPersonalMessage")(function* (input: {
  readonly account: LocalAccount;
  readonly message: string;
}) {
  const message = /^0x(?:[0-9a-fA-F]{2})*$/.test(input.message)
    ? { raw: input.message as Hex }
    : input.message;
  return yield* Effect.tryPromise({
    try: () => input.account.signMessage({ message }),
    catch: signingFailure("personal_sign"),
  });
});

export const signTypedData = Effect.fn("Web3Signer.signTypedData")(function* (input: {
  readonly account: LocalAccount;
  readonly typedData: unknown;
}) {
  // v3/v4 send the payload as a JSON string; v1-style callers pass an object.
  const parsed =
    typeof input.typedData === "string"
      ? yield* decodeUnknownJson(input.typedData).pipe(
          Effect.mapError(() =>
            signingFailure("eth_signTypedData_v4")("typed data payload was not valid JSON"),
          ),
        )
      : input.typedData;
  return yield* Effect.tryPromise({
    try: () => input.account.signTypedData(parsed as never),
    catch: signingFailure("eth_signTypedData_v4"),
  });
});

export interface Web3TransactionRequest {
  readonly from?: string;
  readonly to?: string;
  readonly value?: unknown;
  readonly data?: string;
  readonly nonce?: unknown;
  readonly gas?: unknown;
  readonly gasPrice?: unknown;
  readonly maxFeePerGas?: unknown;
  readonly maxPriorityFeePerGas?: unknown;
}

const DEFAULT_PRIORITY_FEE = 1_000_000_000n;

/**
 * Fill the fields a page normally omits, then sign.
 *
 * Fee selection follows what the chain actually reports: a `baseFeePerGas` on
 * the latest block means EIP-1559, and its absence means a legacy chain (which
 * plenty of local test nodes still are). Guessing 1559 on a legacy chain
 * produces a transaction the node rejects.
 */
export const signTransaction = Effect.fn("Web3Signer.signTransaction")(function* (input: {
  readonly account: LocalAccount;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly request: Web3TransactionRequest;
}) {
  const { account, chainId, rpcUrl, request } = input;
  const rpc = (method: string, params?: unknown) => web3RpcRequest({ rpcUrl, method, params });

  const nonce =
    fromQuantityHex(request.nonce) ??
    fromQuantityHex(yield* rpc("eth_getTransactionCount", [account.address, "pending"])) ??
    0n;

  const value = fromQuantityHex(request.value) ?? 0n;
  const data =
    typeof request.data === "string" && request.data.length > 2 ? request.data : undefined;

  const gas =
    fromQuantityHex(request.gas) ??
    fromQuantityHex(
      yield* rpc("eth_estimateGas", [
        {
          from: account.address,
          ...(request.to === undefined ? {} : { to: request.to }),
          ...(value === 0n ? {} : { value: toQuantityHex(value) }),
          ...(data === undefined ? {} : { data }),
        },
      ]),
    ) ??
    21_000n;

  const latestBlock = (yield* rpc("eth_getBlockByNumber", ["latest", false])) as {
    readonly baseFeePerGas?: unknown;
  } | null;
  const baseFee = fromQuantityHex(latestBlock?.baseFeePerGas);

  const common = {
    chainId,
    nonce: Number(nonce),
    gas,
    value,
    ...(request.to === undefined ? {} : { to: request.to as Hex }),
    ...(data === undefined ? {} : { data: data as Hex }),
  };

  let serializable: TransactionSerializable;
  if (baseFee === null) {
    const gasPrice =
      fromQuantityHex(request.gasPrice) ?? fromQuantityHex(yield* rpc("eth_gasPrice")) ?? 0n;
    serializable = { ...common, type: "legacy", gasPrice } as TransactionSerializable;
  } else {
    const priorityFromRequest = fromQuantityHex(request.maxPriorityFeePerGas);
    const priority =
      priorityFromRequest ??
      fromQuantityHex(
        yield* rpc("eth_maxPriorityFeePerGas").pipe(Effect.orElseSucceed(() => null)),
      ) ??
      DEFAULT_PRIORITY_FEE;
    const maxFee = fromQuantityHex(request.maxFeePerGas) ?? baseFee * 2n + priority;
    serializable = {
      ...common,
      type: "eip1559",
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
    } as TransactionSerializable;
  }

  return yield* Effect.tryPromise({
    try: () => account.signTransaction(serializable),
    catch: signingFailure("eth_sendTransaction"),
  });
});

/** Sign, then broadcast, returning the transaction hash the page expects. */
export const sendTransaction = Effect.fn("Web3Signer.sendTransaction")(function* (input: {
  readonly account: LocalAccount;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly request: Web3TransactionRequest;
}) {
  const raw = yield* signTransaction(input);
  return yield* web3RpcRequest({
    rpcUrl: input.rpcUrl,
    method: "eth_sendRawTransaction",
    params: [raw],
  });
});

/** Normalises user input for an imported key so the keystore holds one form. */
export function normalizePrivateKey(value: string): Web3Hex | null {
  const trimmed = value.trim();
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[0-9a-fA-F]{64}$/.test(prefixed) ? (prefixed as Web3Hex) : null;
}
