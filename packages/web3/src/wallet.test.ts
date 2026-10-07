import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import { recoverMessageAddress } from "viem";

import { getDefaultChain } from "./chain.ts";
import { EMPTY_KEYSTORE } from "./keystore.ts";
import { toQuantityHex } from "./rpc.ts";
import {
  PreviewWalletKeystoreError,
  WEB3_PENDING_PER_GUEST,
  Web3WalletSettings,
  type Web3GuestReply,
  type Web3KeystoreFile,
} from "./schema.ts";
import * as Wallet from "./wallet.ts";

const LOCAL_ORIGIN = "http://localhost:5173";
const REMOTE_ORIGIN = "https://app.example.test";
const GUEST = "thread-1\u0000tab-1";
const DOCUMENT = "document-1";

const decodeJsonRpcCall = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ method: Schema.String })),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const DEFAULT_SETTINGS = Schema.decodeSync(Web3WalletSettings)({});
const settingsWith = (patch: Partial<Web3WalletSettings>): Web3WalletSettings => ({
  ...DEFAULT_SETTINGS,
  enabled: true,
  ...patch,
});

const readBody = (body: HttpBody.HttpBody): string =>
  body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "{}";

const rpcLayer = (
  responders: Record<string, unknown>,
  calls: Array<string>,
  respondersByUrl: Readonly<Record<string, Record<string, unknown>>>,
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const call = decodeJsonRpcCall(readBody(request.body));
        calls.push(call.method);
        const requestResponders = respondersByUrl[request.url] ?? responders;
        const body =
          call.method in requestResponders
            ? { jsonrpc: "2.0", id: 1, result: requestResponders[call.method] }
            : { jsonrpc: "2.0", id: 1, error: { code: -32601, message: call.method } };
        return HttpClientResponse.fromWeb(request, new Response(encodeJson(body)));
      }),
    ),
  );

/** A live node on 8545 reporting chain 31337, which is what zero-config expects. */
const ANVIL_RESPONDERS = {
  eth_chainId: "0x7a69",
  eth_getTransactionCount: "0x0",
  eth_estimateGas: "0x5208",
  eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" },
  eth_maxPriorityFeePerGas: "0x3b9aca00",
  eth_sendRawTransaction: "0xtxhash",
  eth_getBalance: "0xde0b6b3a7640000",
};

/** Keys in memory, as a host's secret store would keep them. */
const memoryStore = (initial: Option.Option<Web3KeystoreFile> = Option.none()) => {
  let stored = initial;
  let saves = 0;
  const store = Wallet.WalletStore.of({
    loadOrCreate: (create) =>
      Effect.suspend(() =>
        Option.isSome(stored)
          ? Effect.succeed(stored.value)
          : create.pipe(
              Effect.tap((created) =>
                Effect.sync(() => {
                  stored = Option.some(created);
                  saves += 1;
                }),
              ),
            ),
      ),
    save: (keystore) =>
      Effect.sync(() => {
        stored = Option.some(keystore);
        saves += 1;
      }),
  });
  return { store, stored: () => stored, saves: () => saves };
};

interface Harness {
  readonly settings?: Partial<Web3WalletSettings>;
  readonly responders?: Record<string, unknown>;
  readonly respondersByUrl?: Readonly<Record<string, Record<string, unknown>>>;
  readonly calls?: Array<string>;
  readonly store?: Wallet.WalletStore["Service"];
}

const engineLayer = (input: Harness) =>
  Wallet.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Wallet.WalletStore, input.store ?? memoryStore().store),
        rpcLayer(
          input.responders ?? ANVIL_RESPONDERS,
          input.calls ?? [],
          input.respondersByUrl ?? {},
        ),
      ),
    ),
  );

/** A wallet that already applied its environment's settings, as the server starts one. */
const startWallet = (input: Harness) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(engineLayer(input));
    const wallet = Context.get(context, Wallet.PreviewWalletEngine);
    yield* wallet.applySettings(settingsWith(input.settings ?? {}));
    return wallet;
  });

const withWallet = <A, E>(
  input: Harness,
  use: (wallet: Wallet.PreviewWalletEngine["Service"]) => Effect.Effect<A, E>,
) =>
  startWallet(input).pipe(Effect.flatMap(use), Effect.scoped, Effect.provide(NodeServices.layer));

/** What the page sees: the result, or its EIP-1193 error. */
const settle = (reply: Web3GuestReply) =>
  reply.ok
    ? Effect.succeed(reply.result)
    : Effect.fail({ code: reply.code, message: reply.message });

const request = (
  wallet: Wallet.PreviewWalletEngine["Service"],
  method: string,
  params: unknown = [],
  origin = LOCAL_ORIGIN,
  guest: { readonly guestId: string; readonly documentId: string } = {
    guestId: GUEST,
    documentId: DOCUMENT,
  },
) => wallet.request({ ...guest, origin, method, params }).pipe(Effect.flatMap(settle));

const connect = (wallet: Wallet.PreviewWalletEngine["Service"], origin = LOCAL_ORIGIN) =>
  request(wallet, "eth_requestAccounts", [], origin);

const status = (wallet: Wallet.PreviewWalletEngine["Service"]) =>
  wallet.view.pipe(Effect.map((view) => view.status));

/** The EIP-1193 code the page received, or null when it got a result. */
const codeOf = <R>(effect: Effect.Effect<unknown, { readonly code: number }, R>) =>
  Effect.match(effect, { onFailure: (error) => error.code, onSuccess: () => null });

/** The wallet makes fresh keys per store, so tests read the address back. */
const activeAddress = (wallet: Wallet.PreviewWalletEngine["Service"]) =>
  status(wallet).pipe(Effect.map((current) => current.selectedAddress ?? ""));

/** Resolves once `count` requests are parked; `changes` starts from the current view. */
const parked = (wallet: Wallet.PreviewWalletEngine["Service"], count: number) =>
  wallet.changes.pipe(
    Stream.filter((view) => view.pending.length >= count),
    Stream.runHead,
    Effect.map((view) => Option.getOrThrow(view).pending),
  );

const signHello = (
  wallet: Wallet.PreviewWalletEngine["Service"],
  origin = LOCAL_ORIGIN,
  guest?: { readonly guestId: string; readonly documentId: string },
) =>
  Effect.flatMap(activeAddress(wallet), (address) =>
    request(wallet, "personal_sign", ["0x68656c6c6f", address], origin, guest),
  );

describe("startup", () => {
  it.effect("generates a test wallet and adopts a local node the first time it is enabled", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const current = yield* status(wallet);
        expect(current.enabled).toBe(true);
        expect(current.accounts.length).toBe(3);
        expect(current.selectedAddress).toBe(current.accounts[0]?.address);
        expect(current.chain?.chainId).toBe(31337);
        expect(current.rpcReachable).toBe(true);
        expect(current.connectedOrigins).toEqual([]);
      }),
    ),
  );

  it.effect("stays empty and closed when the wallet is disabled", () => {
    const keys = memoryStore();
    return withWallet({ settings: { enabled: false }, store: keys.store }, (wallet) =>
      Effect.gen(function* () {
        expect((yield* status(wallet)).accounts).toEqual([]);
        expect(keys.saves()).toBe(0);
        expect(yield* request(wallet, "eth_accounts").pipe(codeOf)).toBe(4900);
      }),
    );
  });

  it.effect("falls back to Ethereum Mainnet when no local node is reachable", () => {
    const mainnet = getDefaultChain(1)!;
    return withWallet(
      { responders: {}, respondersByUrl: { [mainnet.rpcUrl!]: { eth_chainId: "0x1" } } },
      (wallet) =>
        Effect.gen(function* () {
          const current = yield* status(wallet);
          expect(current.chain).toEqual(mainnet);
          expect(current.rpcReachable).toBe(true);
        }),
    );
  });

  it.effect("keeps the default network visible when its public RPC is unreachable", () =>
    withWallet({ responders: {} }, (wallet) =>
      Effect.gen(function* () {
        const current = yield* status(wallet);
        expect(current.chain?.chainId).toBe(1);
        expect(current.rpcReachable).toBe(false);
      }),
    ),
  );

  it.effect("leaves a stored keystore it cannot read untouched instead of replacing it", () => {
    let saves = 0;
    const unreadable = Wallet.WalletStore.of({
      loadOrCreate: () =>
        Effect.fail(new PreviewWalletKeystoreError({ operation: "read", detail: "corrupt" })),
      save: () =>
        Effect.sync(() => {
          saves += 1;
        }),
    });
    return withWallet({ store: unreadable }, (wallet) =>
      Effect.gen(function* () {
        expect((yield* status(wallet)).accounts).toEqual([]);
        const failure = yield* wallet.configure({ generateAccount: true }).pipe(Effect.flip);
        expect(failure._tag).toBe("PreviewWalletKeystoreError");
        expect(saves).toBe(0);
      }),
    );
  });

  it.effect(
    "keeps keys and grants across a restart, but no parked request or agent activity",
    () => {
      const keys = memoryStore();
      return Effect.gen(function* () {
        const first = yield* startWallet({
          store: keys.store,
          settings: { approvalMode: "always-ask", autoConnectLoopback: true },
        });
        yield* connect(first);
        yield* first.noteAgentActivity(GUEST);
        yield* Effect.forkChild(signHello(first));
        yield* parked(first, 1);
        const before = yield* status(first);

        const second = yield* startWallet({
          store: keys.store,
          settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true },
        });
        const after = yield* status(second);
        expect(after.accounts).toEqual(before.accounts);
        expect(after.connectedOrigins).toEqual([LOCAL_ORIGIN]);
        expect(after.pendingRequests).toEqual([]);
        // Activity from the old process does not approve anything here.
        yield* Effect.forkChild(signHello(second));
        expect(yield* parked(second, 1)).toHaveLength(1);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
    },
  );
});

describe("pages", () => {
  it.effect("returns no accounts to an origin that has not connected", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        expect(yield* request(wallet, "eth_accounts")).toEqual([]);
        expect(yield* request(wallet, "wallet_getPermissions")).toEqual([]);
      }),
    ),
  );

  it.effect("answers chain id and net version from resolved state", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        expect(yield* request(wallet, "eth_chainId")).toBe(toQuantityHex(31337));
        expect(yield* request(wallet, "net_version")).toBe("31337");
      }),
    ),
  );

  it.effect("refuses pages without a web origin", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        expect(yield* request(wallet, "eth_chainId", [], "about:blank").pipe(codeOf)).toBe(4100);
        expect(yield* request(wallet, "eth_chainId", [], "file://").pipe(codeOf)).toBe(4100);
      }),
    ),
  );

  it.effect("refuses oversized params before they can queue", () =>
    withWallet({ settings: { approvalMode: "always-ask" } }, (wallet) =>
      Effect.gen(function* () {
        const failure = yield* request(wallet, "personal_sign", ["x".repeat(300 * 1024)]).pipe(
          codeOf,
        );
        expect(failure).toBe(-32602);
        expect((yield* wallet.view).pending).toEqual([]);
      }),
    ),
  );

  it.effect("publishes page state with accounts only for granted origins and never keys", () => {
    const keys = memoryStore();
    return withWallet({ store: keys.store, settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const view = yield* wallet.view;
        expect(view.page).toMatchObject({
          enabled: true,
          chainId: "0x7a69",
          accounts: view.status.accounts.map((account) => account.address),
          connectedOrigins: [LOCAL_ORIGIN],
        });
        const stored = Option.getOrThrow(keys.stored());
        expect(JSON.stringify(view)).not.toContain(stored.mnemonic!);

        yield* wallet.applySettings(settingsWith({ enabled: false, autoConnectLoopback: true }));
        expect((yield* wallet.view).page).toMatchObject({
          enabled: false,
          chainId: null,
          accounts: [],
          connectedOrigins: [],
        });
      }),
    );
  });
});

describe("connect grants", () => {
  it.effect("auto-connects a loopback origin when that is switched on", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        const expected = yield* activeAddress(wallet);
        const accounts = (yield* connect(wallet)) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(expected);
        expect((yield* status(wallet)).connectedOrigins).toEqual([LOCAL_ORIGIN]);
        expect(yield* request(wallet, "eth_accounts")).toEqual(accounts);
      }),
    ),
  );

  it.effect("parks a remote origin's connect even in approve-everything mode", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(connect(wallet, REMOTE_ORIGIN));
        const [pending] = yield* parked(wallet, 1);
        expect(pending?.request.method).toBe("eth_requestAccounts");
        expect(pending?.request.origin).toBe(REMOTE_ORIGIN);
        expect(pending?.request.summary).toContain(REMOTE_ORIGIN);
        expect(pending?.guestId).toBe(GUEST);

        yield* wallet.approve(pending!.request.requestId);
        const accounts = (yield* Fiber.join(fiber)) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(yield* activeAddress(wallet));
        expect((yield* status(wallet)).connectedOrigins).toEqual([REMOTE_ORIGIN]);
      }),
    ),
  );

  it.effect("auto-approves a loopback origin once it is granted, without asking again", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        expect((yield* wallet.view).pending).toEqual([]);
        const signature = (yield* signHello(wallet)) as `0x${string}`;
        const signer = yield* Effect.promise(() =>
          recoverMessageAddress({ message: "hello", signature }),
        );
        expect(signer).toBe(yield* activeAddress(wallet));
      }),
    ),
  );

  it.effect("does not grant an origin when its first signature prompt is rejected", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(signHello(wallet, REMOTE_ORIGIN).pipe(codeOf));
        const [pending] = yield* parked(wallet, 1);
        expect(pending?.request.summary).toContain("Approving also connects this site");

        yield* wallet.reject(pending!.request.requestId, 4001);
        expect(yield* Fiber.join(fiber)).toBe(4001);
        expect((yield* status(wallet)).connectedOrigins).toEqual([]);
        expect((yield* wallet.view).pending).toEqual([]);
      }),
    ),
  );

  it.effect("revokes a page's grant when it asks to", () =>
    withWallet({ settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        yield* request(wallet, "wallet_revokePermissions", [{ eth_accounts: {} }]);
        expect((yield* status(wallet)).connectedOrigins).toEqual([]);
        expect(yield* request(wallet, "eth_accounts")).toEqual([]);
      }),
    ),
  );
});

describe("the approval gate", () => {
  it.effect("parks every signature in always-ask mode and signs once approved", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(signHello(wallet));
        const [pending] = yield* parked(wallet, 1);
        expect(pending?.request.summary).toContain("hello");

        const resolution = yield* wallet.approve(pending!.request.requestId);
        expect(resolution).toMatchObject({ outcome: "approved", failure: null });
        const signature = (yield* Fiber.join(fiber)) as `0x${string}`;
        expect(resolution.result).toBe(signature);
        expect(
          yield* Effect.promise(() => recoverMessageAddress({ message: "hello", signature })),
        ).toBe(yield* activeAddress(wallet));
        expect((yield* wallet.view).pending).toEqual([]);
      }),
    ),
  );

  it.effect("prompts for and signs Renown's VerifiableCredential typed data", () =>
    withWallet({ settings: { approvalMode: "always-ask" } }, (wallet) =>
      Effect.gen(function* () {
        const address = yield* activeAddress(wallet);
        const typedData = {
          domain: { version: "1", chainId: 1 },
          primaryType: "VerifiableCredential",
          types: {
            EIP712Domain: [
              { name: "version", type: "string" },
              { name: "chainId", type: "uint256" },
            ],
            VerifiableCredential: [
              { name: "@context", type: "string[]" },
              { name: "type", type: "string[]" },
              { name: "id", type: "string" },
              { name: "issuer", type: "Issuer" },
              { name: "credentialSubject", type: "CredentialSubject" },
              { name: "credentialSchema", type: "CredentialSchema" },
              { name: "issuanceDate", type: "string" },
              { name: "expirationDate", type: "string" },
            ],
            Issuer: [
              { name: "id", type: "string" },
              { name: "ethereumAddress", type: "string" },
            ],
            CredentialSubject: [
              { name: "id", type: "string" },
              { name: "app", type: "string" },
            ],
            CredentialSchema: [
              { name: "id", type: "string" },
              { name: "type", type: "string" },
            ],
          },
          message: {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["VerifiableCredential", "RenownCredential"],
            id: "urn:uuid:6d0fe97e-77dc-4d72-a012-a37ec2f15e3d",
            issuer: {
              id: `did:pkh:eip155:1:${address.toLowerCase()}`,
              ethereumAddress: address,
            },
            credentialSubject: {
              id: "did:key:zDnaed7MPwsg3pTxC1gPqVvxfxbqDcTuPqjZdACkSF1wWMvKE",
              app: "renown-app",
            },
            credentialSchema: {
              id: "https://renown.id/schemas/renown-credential/v1",
              type: "JsonSchemaValidator2018",
            },
            issuanceDate: "2026-08-12T12:00:00.000Z",
            expirationDate: "2026-08-19T12:00:00.000Z",
          },
        };
        const signFiber = yield* Effect.forkChild(
          request(wallet, "eth_signTypedData_v4", [address, encodeJson(typedData)], REMOTE_ORIGIN),
        );
        const [pending] = yield* parked(wallet, 1);
        expect(pending?.request.method).toBe("eth_signTypedData_v4");
        expect(pending?.request.summary).toContain("VerifiableCredential");
        expect(pending?.request.summary).toContain("chain 1");
        expect(pending?.request.summary).toContain("Approving also connects this site");

        expect((yield* wallet.approve(pending!.request.requestId)).failure).toBeNull();
        expect(String(yield* Fiber.join(signFiber))).toMatch(/^0x[0-9a-f]{130}$/i);
        expect((yield* status(wallet)).connectedOrigins).toEqual([REMOTE_ORIGIN]);
      }),
    ),
  );

  it.effect("gives the page the chosen EIP-1193 code on rejection", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(signHello(wallet).pipe(codeOf));
        const [pending] = yield* parked(wallet, 1);
        expect((yield* wallet.reject(pending!.request.requestId, 4100)).outcome).toBe("rejected");
        expect(yield* Fiber.join(fiber)).toBe(4100);
      }),
    ),
  );

  it.effect("approves for an agent only within 30 seconds of its last action on that tab", () =>
    withWallet(
      { settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          yield* wallet.noteAgentActivity(GUEST);
          yield* TestClock.adjust("30 seconds");
          expect(String(yield* signHello(wallet))).toMatch(/^0x/);

          // Another tab is not agent-driven.
          yield* Effect.forkChild(
            signHello(wallet, LOCAL_ORIGIN, { guestId: "thread-1\u0000tab-2", documentId: "d" }),
          );
          expect((yield* parked(wallet, 1))[0]?.guestId).toBe("thread-1\u0000tab-2");

          yield* TestClock.adjust("1 millis");
          yield* Effect.forkChild(signHello(wallet));
          expect(yield* parked(wallet, 2)).toHaveLength(2);
        }),
    ),
  );

  it.effect("stops approving for an agent once a person takes the tab", () =>
    withWallet(
      { settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          yield* wallet.noteAgentActivity(GUEST);
          yield* wallet.clearAgentActivity(GUEST);
          yield* Effect.forkChild(signHello(wallet));
          expect(yield* parked(wallet, 1)).toHaveLength(1);
        }),
    ),
  );

  it.effect("answers a request nobody resolves after five minutes", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(signHello(wallet).pipe(codeOf));
        yield* parked(wallet, 1);
        yield* TestClock.adjust("5 minutes");
        expect(yield* Fiber.join(fiber)).toBe(4001);
        expect((yield* wallet.view).pending).toEqual([]);
      }),
    ),
  );

  it.effect("signs a request once when two approvers race, and the other learns it is gone", () => {
    const calls: Array<string> = [];
    return withWallet(
      { calls, settings: { approvalMode: "always-ask", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          const send = yield* Effect.forkChild(
            Effect.flatMap(activeAddress(wallet), (from) =>
              request(wallet, "eth_sendTransaction", [
                { from, to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", value: "0x1" },
              ]),
            ),
          );
          const [pending] = yield* parked(wallet, 1);
          const requestId = pending!.request.requestId;
          const [first, second] = yield* Effect.all(
            [
              wallet.approve(requestId).pipe(Effect.result),
              wallet.approve(requestId).pipe(Effect.result),
            ],
            { concurrency: "unbounded" },
          );
          const outcomes = [first, second].map((result) =>
            result._tag === "Success" ? "approved" : result.failure._tag,
          );
          expect(outcomes.toSorted()).toEqual(["PreviewWalletRequestNotFoundError", "approved"]);
          expect(yield* Fiber.join(send)).toBe("0xtxhash");
          expect(calls.filter((method) => method === "eth_sendRawTransaction")).toHaveLength(1);
        }),
    );
  });

  it.effect("lets only one of approve and reject settle a request", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(signHello(wallet).pipe(Effect.result));
        const [pending] = yield* parked(wallet, 1);
        const requestId = pending!.request.requestId;
        yield* wallet.reject(requestId);
        expect((yield* wallet.approve(requestId).pipe(Effect.flip))._tag).toBe(
          "PreviewWalletRequestNotFoundError",
        );
        expect((yield* Fiber.join(fiber))._tag).toBe("Failure");
      }),
    ),
  );

  it.effect("caps how many requests one tab can park", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        for (let index = 0; index < WEB3_PENDING_PER_GUEST; index += 1) {
          yield* Effect.forkChild(signHello(wallet));
        }
        yield* parked(wallet, WEB3_PENDING_PER_GUEST);
        expect(yield* signHello(wallet).pipe(codeOf)).toBe(-32005);
      }),
    ),
  );
});

describe("request lifetimes", () => {
  it.effect("answers a tab's prompts when it loads a new document", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const stale = yield* Effect.forkChild(signHello(wallet).pipe(codeOf));
        yield* parked(wallet, 1);
        yield* wallet.openDocument(GUEST, "document-2");
        expect(yield* Fiber.join(stale)).toBe(4900);
        expect((yield* wallet.view).pending).toEqual([]);
      }),
    ),
  );

  it.effect("answers a closed tab's prompts and forgets its agent activity", () =>
    withWallet(
      { settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          const other = { guestId: "thread-1\u0000tab-2", documentId: "d" };
          const fiber = yield* Effect.forkChild(
            signHello(wallet, LOCAL_ORIGIN, other).pipe(codeOf),
          );
          yield* parked(wallet, 1);
          yield* wallet.noteAgentActivity(GUEST);
          yield* wallet.forgetGuest(other.guestId);
          yield* wallet.forgetGuest(GUEST);
          expect(yield* Fiber.join(fiber)).toBe(4900);
          yield* Effect.forkChild(signHello(wallet));
          expect(yield* parked(wallet, 1)).toHaveLength(1);
        }),
    ),
  );

  it.effect("answers every parked request when the wallet is turned off", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(signHello(wallet).pipe(codeOf));
        yield* parked(wallet, 1);
        yield* wallet.applySettings(settingsWith({ enabled: false }));
        expect(yield* Fiber.join(fiber)).toBe(4900);
        expect((yield* status(wallet)).enabled).toBe(false);
        expect(yield* request(wallet, "eth_chainId").pipe(codeOf)).toBe(4900);
      }),
    ),
  );
});

describe("chain handling", () => {
  it.effect("adopts a chain the page adds, including its endpoint", () =>
    withWallet({ settings: { approvalMode: "always-auto", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        yield* request(wallet, "wallet_addEthereumChain", [
          { chainId: "0x7a69", chainName: "Local Anvil", rpcUrls: ["http://127.0.0.1:8545"] },
        ]);
        const current = yield* status(wallet);
        expect(current.chain?.chainId).toBe(31337);
        expect(current.chain?.name).toBe("Local Anvil");
      }),
    ),
  );

  it.effect("switches to a bundled public network without wallet_addEthereumChain", () => {
    const base = getDefaultChain(8453)!;
    return withWallet(
      {
        settings: { approvalMode: "always-auto", autoConnectLoopback: true },
        respondersByUrl: { [base.rpcUrl!]: { eth_chainId: "0x2105" } },
      },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          expect(
            yield* request(wallet, "wallet_switchEthereumChain", [{ chainId: "0x2105" }]),
          ).toBeNull();
          const current = yield* status(wallet);
          expect(current.chain).toEqual(base);
          expect(current.rpcReachable).toBe(true);
          expect((yield* wallet.view).page.chainId).toBe("0x2105");
        }),
    );
  });

  it.effect("refuses to switch to a chain it has no endpoint for", () =>
    withWallet({ settings: { approvalMode: "always-auto", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const failure = yield* request(wallet, "wallet_switchEthereumChain", [
          { chainId: "0x67932" },
        ]).pipe(codeOf);
        // Claiming a chain the wallet cannot read would be worse than refusing.
        expect(failure).toBe(4902);
        expect((yield* status(wallet)).chain?.chainId).toBe(31337);
      }),
    ),
  );

  it.effect("switches to a custom network from settings without wallet_addEthereumChain", () =>
    withWallet(
      {
        settings: {
          approvalMode: "always-auto",
          autoConnectLoopback: true,
          customNetworks: [
            {
              chainId: 4242,
              name: "Preview Chain",
              rpcUrl: "https://preview.example.test",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            },
          ],
        },
        respondersByUrl: { "https://preview.example.test": { eth_chainId: "0x1092" } },
      },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          expect(
            yield* request(wallet, "wallet_switchEthereumChain", [{ chainId: "0x1092" }]),
          ).toBeNull();
          const current = yield* status(wallet);
          expect(current.chain?.chainId).toBe(4242);
          expect(current.chain?.name).toBe("Preview Chain");
          expect(current.rpcReachable).toBe(true);
        }),
    ),
  );

  it.effect("refuses to switch to a disabled built-in network", () => {
    const base = getDefaultChain(8453)!;
    return withWallet(
      {
        settings: {
          approvalMode: "always-auto",
          autoConnectLoopback: true,
          disabledBuiltInChainIds: [8453],
        },
        respondersByUrl: { [base.rpcUrl!]: { eth_chainId: "0x2105" } },
      },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          const failure = yield* request(wallet, "wallet_switchEthereumChain", [
            { chainId: "0x2105" },
          ]).pipe(codeOf);
          expect(failure).toBe(4902);
          expect((yield* status(wallet)).chain?.chainId).toBe(31337);
        }),
    );
  });

  it.effect("lets an explicit chain setting win over the local node", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        yield* wallet.applySettings(
          settingsWith({ chainId: 11155111, rpcUrl: "https://sepolia.example.test" }),
        );
        const current = yield* status(wallet);
        expect(current.chain?.chainId).toBe(11155111);
        expect(current.chain?.rpcUrl).toBe("https://sepolia.example.test");
        expect(current.rpcReachable).toBe(false);
      }),
    ),
  );
});

describe("passthrough and transactions", () => {
  it.effect(
    "forwards unrecognised methods to the chain, which is what makes cheat codes work",
    () =>
      withWallet({ responders: { ...ANVIL_RESPONDERS, anvil_setBalance: true } }, (wallet) =>
        Effect.gen(function* () {
          expect(
            yield* request(wallet, "eth_getBalance", [
              "0x0000000000000000000000000000000000000001",
              "latest",
            ]),
          ).toBe("0xde0b6b3a7640000");
          expect(
            yield* request(wallet, "anvil_setBalance", [
              "0x0000000000000000000000000000000000000001",
              "0x1",
            ]),
          ).toBe(true);
        }),
      ),
  );

  it.effect("signs and broadcasts, returning the hash to the page", () =>
    withWallet({ settings: { approvalMode: "always-auto", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const hash = yield* request(wallet, "eth_sendTransaction", [
          {
            from: yield* activeAddress(wallet),
            to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            value: toQuantityHex(10n ** 15n),
          },
        ]);
        expect(hash).toBe("0xtxhash");
      }),
    ),
  );
});

describe("configure", () => {
  it.effect("refuses to change a wallet that is turned off", () =>
    withWallet({ settings: { enabled: false } }, (wallet) =>
      Effect.gen(function* () {
        const failure = yield* wallet.configure({ generateAccount: true }).pipe(Effect.flip);
        expect(failure._tag).toBe("PreviewWalletDisabledError");
      }),
    ),
  );

  it.effect("keeps a test override until the stored settings change", () =>
    withWallet({ settings: { approvalMode: "auto-for-agents" } }, (wallet) =>
      Effect.gen(function* () {
        expect((yield* wallet.configure({ approvalMode: "always-ask" })).approvalMode).toBe(
          "always-ask",
        );
        yield* wallet.applySettings(settingsWith({ approvalMode: "auto-for-agents" }));
        expect((yield* status(wallet)).approvalMode).toBe("always-ask");
        yield* wallet.applySettings(
          settingsWith({ approvalMode: "auto-for-agents", autoConnectLoopback: true }),
        );
        expect((yield* status(wallet)).approvalMode).toBe("auto-for-agents");
      }),
    ),
  );

  it.effect("switches to a bundled network without a custom RPC", () => {
    const base = getDefaultChain(8453)!;
    return withWallet(
      { respondersByUrl: { [base.rpcUrl!]: { eth_chainId: "0x2105" } } },
      (wallet) =>
        Effect.gen(function* () {
          const after = yield* wallet.configure({ chainId: 8453, rpcUrl: null });
          expect(after.chain).toEqual(base);
          expect(after.rpcReachable).toBe(true);
        }),
    );
  });

  it.effect("adds a generated account and makes it active, keeping custom labels", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const before = yield* status(wallet);
        yield* wallet.configure({
          accountLabel: { address: before.accounts[0]!.address, label: "Deployer" },
        });
        const after = yield* wallet.configure({ generateAccount: true });
        expect(after.accounts).toHaveLength(before.accounts.length + 1);
        expect(after.selectedAddress).toBe(after.accounts.at(-1)?.address);
        expect(after.accounts[0]?.label).toBe("Deployer");
        expect(after.accounts.at(-1)?.label).toBe(`Preview account ${after.accounts.length}`);
      }),
    ),
  );

  it.effect("switches the active account and reorders eth_accounts", () =>
    withWallet({ settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        const second = (yield* status(wallet)).accounts[1]!.address;
        yield* wallet.configure({ selectedAddress: second });
        yield* connect(wallet);
        const accounts = (yield* request(wallet, "eth_accounts")) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(second);
      }),
    ),
  );

  it.effect("removes an account and makes another active when it was selected", () =>
    withWallet({ settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        const before = yield* status(wallet);
        const removed = before.accounts[0]!;
        const after = yield* wallet.configure({ removeAccount: removed.address });
        yield* connect(wallet);
        expect(after.accounts.map((account) => account.address)).not.toContain(removed.address);
        expect(after.selectedAddress).toBe(before.accounts[1]!.address);
        const accounts = (yield* request(wallet, "eth_accounts")) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(before.accounts[1]!.address);
        expect(accounts).not.toContain(removed.address);
      }),
    ),
  );

  it.effect("does not recreate a removed middle account on the next generate", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const middle = (yield* status(wallet)).accounts[1]!;
        yield* wallet.configure({ removeAccount: middle.address });
        const after = yield* wallet.configure({ generateAccount: true });
        const addresses = after.accounts.map((account) => account.address);
        expect(addresses).not.toContain(middle.address);
        expect(new Set(addresses).size).toBe(addresses.length);
      }),
    ),
  );

  it.effect("refuses accounts the wallet does not hold", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const ghost = "0x0000000000000000000000000000000000000001";
        for (const input of [
          { removeAccount: ghost },
          { selectedAddress: ghost },
          { accountLabel: { address: ghost, label: "Ghost" } },
        ]) {
          expect((yield* wallet.configure(input).pipe(Effect.flip))._tag).toBe(
            "PreviewWalletNoAccountError",
          );
        }
      }),
    ),
  );

  it.effect("renames an account without changing which one is active, across a restart", () => {
    const keys = memoryStore();
    return Effect.gen(function* () {
      const first = yield* startWallet({ store: keys.store });
      const before = yield* status(first);
      const second = before.accounts[1]!;
      const after = yield* first.configure({
        accountLabel: { address: second.address, label: "Treasury" },
      });
      expect(after.selectedAddress).toBe(before.selectedAddress);
      expect(after.accounts[1]?.label).toBe("Treasury");

      const restarted = yield* status(yield* startWallet({ store: keys.store }));
      expect(restarted.accounts[1]?.label).toBe("Treasury");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
  });

  it.effect("clears connect grants so the next request prompts again", () =>
    withWallet({ settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        expect((yield* status(wallet)).connectedOrigins).toEqual([LOCAL_ORIGIN]);
        expect((yield* wallet.configure({ clearConnectedOrigins: true })).connectedOrigins).toEqual(
          [],
        );
        expect(yield* request(wallet, "eth_accounts")).toEqual([]);
      }),
    ),
  );

  it.effect("gives an empty stored wallet its first accounts", () => {
    const keys = memoryStore(Option.some({ ...EMPTY_KEYSTORE }));
    return withWallet({ store: keys.store }, (wallet) =>
      Effect.gen(function* () {
        expect((yield* status(wallet)).accounts).toHaveLength(3);
        expect(keys.saves()).toBe(1);
      }),
    );
  });
});
