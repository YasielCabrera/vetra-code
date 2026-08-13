import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { parseTransaction, recoverMessageAddress, recoverTypedDataAddress } from "viem";

import { EMPTY_KEYSTORE } from "./keystore.ts";
import { makeJsonRpcClientLayer, toJsonString, type RecordedJsonRpcCall } from "./testJsonRpc.ts";
import { toQuantityHex } from "./rpc.ts";
import type { Web3Account, Web3Address, Web3Hex, Web3KeystoreFile } from "./schema.ts";
import {
  deriveMnemonicAccounts,
  describeImportedPrivateKey,
  dropAccountFromKeystore,
  generateWalletMnemonic,
  nextMnemonicDerivationIndex,
  normalizePrivateKey,
  resolveSigner,
  sendTransaction,
  signPersonalMessage,
  signTransaction,
  signTypedData,
} from "./signer.ts";

/** The Anvil / Hardhat default mnemonic — published, and a stable test vector. */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ACCOUNT_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ACCOUNT_0_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** Unrelated key, so imported-account resolution cannot pass by coincidence. */
const IMPORTED_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const IMPORTED_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const keystoreWith = (input: {
  readonly accounts: ReadonlyArray<Web3Account>;
  readonly mnemonic?: string | null;
  readonly privateKeys?: ReadonlyArray<Web3Hex>;
}): Web3KeystoreFile => ({
  ...EMPTY_KEYSTORE,
  mnemonic: input.mnemonic ?? null,
  privateKeys: input.privateKeys ?? [],
  accounts: input.accounts,
});

const derivedAccount = (index: number, address: string): Web3Account => ({
  address: address as Web3Address,
  label: `Preview account ${index + 1}`,
  source: "generated",
  derivationIndex: index,
});

const RPC_URL = "http://127.0.0.1:8545";

describe("generateWalletMnemonic", () => {
  it("produces a distinct 12-word BIP-39 phrase each time", () => {
    const first = generateWalletMnemonic();
    const second = generateWalletMnemonic();
    expect(first.split(" ")).toHaveLength(12);
    expect(first).not.toBe(second);
  });
});

describe("normalizePrivateKey", () => {
  it("accepts keys with and without the 0x prefix", () => {
    expect(normalizePrivateKey(ACCOUNT_0_PRIVATE_KEY)).toBe(ACCOUNT_0_PRIVATE_KEY);
    expect(normalizePrivateKey(ACCOUNT_0_PRIVATE_KEY.slice(2))).toBe(ACCOUNT_0_PRIVATE_KEY);
    expect(normalizePrivateKey(`  ${ACCOUNT_0_PRIVATE_KEY}  `)).toBe(ACCOUNT_0_PRIVATE_KEY);
  });

  it("rejects anything that is not a 32-byte key", () => {
    expect(normalizePrivateKey("0xdeadbeef")).toBeNull();
    expect(normalizePrivateKey("not a key")).toBeNull();
    expect(normalizePrivateKey("")).toBeNull();
  });
});

describe("deriveMnemonicAccounts", () => {
  it.effect("derives the published BIP-44 addresses for a known mnemonic", () =>
    Effect.gen(function* () {
      const accounts = yield* deriveMnemonicAccounts(TEST_MNEMONIC, 2);
      expect(accounts.map((account) => account.address)).toEqual([ACCOUNT_0, ACCOUNT_1]);
      expect(accounts.map((account) => account.derivationIndex)).toEqual([0, 1]);
      expect(accounts[0]?.source).toBe("generated");
      expect(accounts[0]?.label).toBe("Preview account 1");
    }),
  );

  it.effect("returns nothing for a non-positive count instead of throwing", () =>
    Effect.gen(function* () {
      expect(yield* deriveMnemonicAccounts(TEST_MNEMONIC, 0)).toEqual([]);
      expect(yield* deriveMnemonicAccounts(TEST_MNEMONIC, -3)).toEqual([]);
    }),
  );

  it.effect("fails with a keystore error on a bad mnemonic", () =>
    Effect.gen(function* () {
      const result = yield* deriveMnemonicAccounts("not a real mnemonic", 1).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("PreviewWalletKeystoreError");
        expect(result.failure.operation).toBe("derive");
      }
    }),
  );
});

describe("nextMnemonicDerivationIndex", () => {
  it("starts at zero when nothing has been derived yet", () => {
    expect(nextMnemonicDerivationIndex([])).toBe(0);
    expect(
      nextMnemonicDerivationIndex([
        {
          address: IMPORTED_ADDRESS as Web3Address,
          label: "Imported",
          source: "imported",
          derivationIndex: null,
        },
      ]),
    ).toBe(0);
  });

  it("uses max+1 so a hole in the middle is not filled with a duplicate", () => {
    expect(
      nextMnemonicDerivationIndex([derivedAccount(0, ACCOUNT_0), derivedAccount(2, ACCOUNT_1)]),
    ).toBe(3);
  });
});

describe("dropAccountFromKeystore", () => {
  const generated = keystoreWith({
    mnemonic: TEST_MNEMONIC,
    accounts: [derivedAccount(0, ACCOUNT_0), derivedAccount(1, ACCOUNT_1)],
  });

  it("drops a generated account and moves the selection when it was active", () => {
    const next = dropAccountFromKeystore(
      { ...generated, selectedAddress: ACCOUNT_0 as Web3Address },
      ACCOUNT_0,
    );
    expect(next?.accounts.map((account) => account.address)).toEqual([ACCOUNT_1]);
    expect(next?.selectedAddress).toBe(ACCOUNT_1);
    expect(next?.mnemonic).toBe(TEST_MNEMONIC);
  });

  it("leaves the selection alone when a different account is removed", () => {
    const next = dropAccountFromKeystore(
      { ...generated, selectedAddress: ACCOUNT_0 as Web3Address },
      ACCOUNT_1,
    );
    expect(next?.selectedAddress).toBe(ACCOUNT_0);
    expect(next?.accounts).toHaveLength(1);
  });

  it("drops the matching imported private key with the account", () => {
    const next = dropAccountFromKeystore(
      keystoreWith({
        privateKeys: [IMPORTED_PRIVATE_KEY as Web3Hex],
        accounts: [
          {
            address: IMPORTED_ADDRESS as Web3Address,
            label: "Imported",
            source: "imported",
            derivationIndex: null,
          },
        ],
      }),
      IMPORTED_ADDRESS,
    );
    expect(next?.accounts).toEqual([]);
    expect(next?.privateKeys).toEqual([]);
    expect(next?.selectedAddress).toBeNull();
  });

  it("returns null for an address the wallet does not hold", () => {
    expect(
      dropAccountFromKeystore(generated, "0x0000000000000000000000000000000000000001"),
    ).toBeNull();
  });
});

describe("describeImportedPrivateKey", () => {
  it.effect("labels an imported key and records it as having no derivation index", () =>
    Effect.gen(function* () {
      const account = yield* describeImportedPrivateKey(IMPORTED_PRIVATE_KEY, "Treasury");
      expect(account.address).toBe(IMPORTED_ADDRESS);
      expect(account.source).toBe("imported");
      expect(account.derivationIndex).toBeNull();
      expect(account.label).toBe("Treasury");
    }),
  );

  it.effect("fails with an import error for malformed hex", () =>
    Effect.gen(function* () {
      const result = yield* describeImportedPrivateKey("0xnope", "x").pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.operation).toBe("import");
      }
    }),
  );
});

describe("resolveSigner", () => {
  it.effect("re-derives a mnemonic account from its stored index", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(1, ACCOUNT_1)] }),
        ACCOUNT_1,
      );
      expect(account.address).toBe(ACCOUNT_1);
    }),
  );

  it.effect("matches case-insensitively, since pages send lowercase addresses", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0.toLowerCase(),
      );
      expect(account.address).toBe(ACCOUNT_0);
    }),
  );

  it.effect("finds an imported account by re-deriving each stored private key", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({
          privateKeys: [IMPORTED_PRIVATE_KEY as Web3Hex],
          accounts: [
            {
              address: IMPORTED_ADDRESS as Web3Address,
              label: "Imported",
              source: "imported",
              derivationIndex: null,
            },
          ],
        }),
        IMPORTED_ADDRESS,
      );
      expect(account.address).toBe(IMPORTED_ADDRESS);
    }),
  );

  it.effect("fails with no-account for an address the wallet does not hold", () =>
    Effect.gen(function* () {
      const result = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        "0x0000000000000000000000000000000000000001",
      ).pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("PreviewWalletNoAccountError");
      }
    }),
  );

  it.effect("fails clearly when a derived account has lost its mnemonic", () =>
    Effect.gen(function* () {
      const result = yield* resolveSigner(
        keystoreWith({ mnemonic: null, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      ).pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("PreviewWalletKeystoreError");
      }
    }),
  );
});

describe("signPersonalMessage", () => {
  it.effect("signs hex payloads as raw bytes, not as their textual form", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      );
      const signature = yield* signPersonalMessage({ account, message: "0x68656c6c6f" });

      // The whole point: a dapp verifying "hello" must recover our address.
      const recovered = yield* Effect.promise(() =>
        recoverMessageAddress({ message: { raw: "0x68656c6c6f" }, signature }),
      );
      expect(recovered).toBe(ACCOUNT_0);

      // And signing the literal string "0x68656c6c6f" must NOT match, which is
      // the bug this branch exists to avoid.
      const wrong = yield* Effect.promise(() =>
        recoverMessageAddress({ message: "0x68656c6c6f", signature }),
      );
      expect(wrong).not.toBe(ACCOUNT_0);
    }),
  );

  it.effect("signs a plain string as text, which pages send despite the spec", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      );
      const message = "Sign in to Example";
      const signature = yield* signPersonalMessage({ account, message });

      const recovered = yield* Effect.promise(() => recoverMessageAddress({ message, signature }));
      expect(recovered).toBe(ACCOUNT_0);
    }),
  );
});

describe("signTypedData", () => {
  const typedData = {
    domain: { name: "Example", version: "1", chainId: 31337 },
    types: {
      Message: [
        { name: "from", type: "address" },
        { name: "contents", type: "string" },
      ],
    },
    primaryType: "Message",
    message: { from: ACCOUNT_0, contents: "hello" },
  } as const;

  it.effect("signs a typed-data object", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      );
      const signature = yield* signTypedData({ account, typedData });

      const recovered = yield* Effect.promise(() =>
        recoverTypedDataAddress({ ...typedData, signature } as never),
      );
      expect(recovered).toBe(ACCOUNT_0);
    }),
  );

  it.effect("signs the JSON string form that eth_signTypedData_v4 actually sends", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      );
      const signature = yield* signTypedData({
        account,
        typedData: toJsonString(typedData),
      });

      const recovered = yield* Effect.promise(() =>
        recoverTypedDataAddress({ ...typedData, signature } as never),
      );
      expect(recovered).toBe(ACCOUNT_0);
    }),
  );

  it.effect("fails with a signing error when the payload is not valid JSON", () =>
    Effect.gen(function* () {
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      );
      const result = yield* signTypedData({ account, typedData: "{not json" }).pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("PreviewWalletSigningError");
      }
    }),
  );
});

describe("signTransaction", () => {
  const signerFor = (address: string) =>
    resolveSigner(
      keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, address)] }),
      address,
    );

  it.effect("fills nonce and gas from the chain and produces an EIP-1559 transaction", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedJsonRpcCall> = [];
      const account = yield* signerFor(ACCOUNT_0);
      const raw = yield* signTransaction({
        account,
        chainId: 31337,
        rpcUrl: RPC_URL,
        request: { to: ACCOUNT_1, value: toQuantityHex(10n ** 18n) },
      }).pipe(
        Effect.provide(
          makeJsonRpcClientLayer(
            {
              eth_getTransactionCount: "0x5",
              eth_estimateGas: "0x5208",
              eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" },
              eth_maxPriorityFeePerGas: "0x3b9aca00",
            },
            calls,
          ),
        ),
      );

      const parsed = parseTransaction(raw);
      expect(parsed.type).toBe("eip1559");
      expect(parsed.chainId).toBe(31337);
      expect(parsed.nonce).toBe(5);
      expect(parsed.gas).toBe(21_000n);
      expect(parsed.value).toBe(10n ** 18n);
      expect(parsed.to?.toLowerCase()).toBe(ACCOUNT_1.toLowerCase());
      // maxFee = baseFee * 2 + priority
      expect(parsed.maxFeePerGas).toBe(0x3b9aca00n * 2n + 0x3b9aca00n);
      expect(calls.map((call) => call.method)).toContain("eth_getTransactionCount");
      expect(calls.map((call) => call.method)).toContain("eth_estimateGas");
    }),
  );

  it.effect("falls back to a legacy transaction when the chain reports no base fee", () =>
    Effect.gen(function* () {
      const account = yield* signerFor(ACCOUNT_0);
      const raw = yield* signTransaction({
        account,
        chainId: 1337,
        rpcUrl: RPC_URL,
        request: { to: ACCOUNT_1 },
      }).pipe(
        Effect.provide(
          makeJsonRpcClientLayer({
            eth_getTransactionCount: "0x0",
            eth_estimateGas: "0x5208",
            // A legacy chain: no baseFeePerGas on the latest block.
            eth_getBlockByNumber: {},
            eth_gasPrice: "0x77359400",
          }),
        ),
      );

      const parsed = parseTransaction(raw);
      expect(parsed.type).toBe("legacy");
      expect(parsed.gasPrice).toBe(0x77359400n);
    }),
  );

  it.effect("respects fields the page supplied instead of re-querying them", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedJsonRpcCall> = [];
      const account = yield* signerFor(ACCOUNT_0);
      const raw = yield* signTransaction({
        account,
        chainId: 31337,
        rpcUrl: RPC_URL,
        request: {
          to: ACCOUNT_1,
          nonce: "0x9",
          gas: "0xf4240",
          maxFeePerGas: "0x9502f900",
          maxPriorityFeePerGas: "0x3b9aca00",
        },
      }).pipe(
        Effect.provide(
          makeJsonRpcClientLayer({ eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" } }, calls),
        ),
      );

      const parsed = parseTransaction(raw);
      expect(parsed.nonce).toBe(9);
      expect(parsed.gas).toBe(0xf4240n);
      expect(parsed.maxFeePerGas).toBe(0x9502f900n);
      expect(calls.map((call) => call.method)).not.toContain("eth_getTransactionCount");
      expect(calls.map((call) => call.method)).not.toContain("eth_estimateGas");
    }),
  );

  it.effect("still signs when the node has no eth_maxPriorityFeePerGas", () =>
    Effect.gen(function* () {
      const account = yield* signerFor(ACCOUNT_0);
      const raw = yield* signTransaction({
        account,
        chainId: 31337,
        rpcUrl: RPC_URL,
        request: { to: ACCOUNT_1 },
      }).pipe(
        Effect.provide(
          makeJsonRpcClientLayer({
            eth_getTransactionCount: "0x0",
            eth_estimateGas: "0x5208",
            eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" },
            // eth_maxPriorityFeePerGas deliberately absent.
          }),
        ),
      );

      const parsed = parseTransaction(raw);
      expect(parsed.type).toBe("eip1559");
      expect(parsed.maxPriorityFeePerGas).toBe(1_000_000_000n);
    }),
  );

  it.effect("signs a contract deployment with no recipient", () =>
    Effect.gen(function* () {
      const account = yield* signerFor(ACCOUNT_0);
      const raw = yield* signTransaction({
        account,
        chainId: 31337,
        rpcUrl: RPC_URL,
        request: { data: "0x6080604052" },
      }).pipe(
        Effect.provide(
          makeJsonRpcClientLayer({
            eth_getTransactionCount: "0x0",
            eth_estimateGas: "0x186a0",
            eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" },
            eth_maxPriorityFeePerGas: "0x3b9aca00",
          }),
        ),
      );

      const parsed = parseTransaction(raw);
      expect(parsed.to ?? null).toBeNull();
      expect(parsed.data).toBe("0x6080604052");
    }),
  );
});

describe("sendTransaction", () => {
  it.effect("signs then broadcasts, returning the hash the page expects", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedJsonRpcCall> = [];
      const account = yield* resolveSigner(
        keystoreWith({ mnemonic: TEST_MNEMONIC, accounts: [derivedAccount(0, ACCOUNT_0)] }),
        ACCOUNT_0,
      );
      const hash = yield* sendTransaction({
        account,
        chainId: 31337,
        rpcUrl: RPC_URL,
        request: { to: ACCOUNT_1 },
      }).pipe(
        Effect.provide(
          makeJsonRpcClientLayer(
            {
              eth_getTransactionCount: "0x0",
              eth_estimateGas: "0x5208",
              eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" },
              eth_maxPriorityFeePerGas: "0x3b9aca00",
              eth_sendRawTransaction: "0xdeadbeef",
            },
            calls,
          ),
        ),
      );

      expect(hash).toBe("0xdeadbeef");
      expect(calls.at(-1)?.method).toBe("eth_sendRawTransaction");
    }),
  );
});
