import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { getDefaultChain } from "@vetra-code/web3/chain";
import { toQuantityHex } from "@vetra-code/web3/rpc";
import type { Web3WalletSettings } from "@vetra-code/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { PREVIEW_WALLET_BOOTSTRAP_CHANNEL } from "./GuestProtocol.ts";
import * as PreviewWallet from "./Wallet.ts";

const electronMock = vi.hoisted(() => ({
  bootstrapListeners: new Map<
    string,
    (event: { sender: unknown; returnValue?: unknown }) => void
  >(),
  contents: [] as Array<{
    getType(): string;
    isDestroyed(): boolean;
    getURL(): string;
    send(channel: string, event: unknown): void;
  }>,
}));

vi.mock("electron", () => ({
  ipcMain: {
    on: vi.fn((channel: string, listener: (event: { sender: unknown }) => void) => {
      electronMock.bootstrapListeners.set(channel, listener);
    }),
    handle: vi.fn(),
    removeAllListeners: vi.fn((channel: string) => {
      electronMock.bootstrapListeners.delete(channel);
    }),
    removeHandler: vi.fn(),
  },
  webContents: { getAllWebContents: () => electronMock.contents },
}));

const LOCAL_ORIGIN = "http://localhost:5173";
const REMOTE_ORIGIN = "https://app.example.test";
const GUEST_ID = 42;

const decodeJsonRpcCall = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ method: Schema.String })),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const readBody = (body: HttpBody.HttpBody): string =>
  body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "{}";

const rpcLayer = (
  responders: Record<string, unknown>,
  calls: Array<string> = [],
  respondersByUrl: Readonly<Record<string, Record<string, unknown>>> = {},
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

const settingsJson = (wallet: Partial<Web3WalletSettings>) =>
  encodeJson({ web3Wallet: { enabled: true, ...wallet } });

/**
 * Builds a wallet over a real temp state directory so the keystore round-trips
 * through the filesystem exactly as it does in the app.
 */
const withWallet = <A, E>(
  input: {
    readonly settings?: Partial<Web3WalletSettings>;
    readonly responders?: Record<string, unknown>;
    readonly respondersByUrl?: Readonly<Record<string, Record<string, unknown>>>;
    readonly calls?: Array<string>;
  },
  use: (
    wallet: PreviewWallet.PreviewWallet["Service"],
  ) => Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-wallet-test-" });
    const serverSettingsPath = path.join(stateDir, "settings.json");
    yield* fileSystem.writeFileString(serverSettingsPath, settingsJson(input.settings ?? {}));

    const environmentLayer = Layer.succeed(
      DesktopEnvironment.DesktopEnvironment,
      DesktopEnvironment.DesktopEnvironment.of({
        serverSettingsPath,
        previewWalletsDir: path.join(stateDir, "preview-wallets"),
        path,
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    );

    const wallet = yield* PreviewWallet.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          environmentLayer,
          rpcLayer(input.responders ?? ANVIL_RESPONDERS, input.calls ?? [], input.respondersByUrl),
        ),
      ),
    );
    return yield* use(wallet);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const request = (
  wallet: PreviewWallet.PreviewWallet["Service"],
  method: string,
  params: unknown = [],
  origin = LOCAL_ORIGIN,
) => wallet.handleRequest({ method, params, origin, webContentsId: GUEST_ID });

const connect = (wallet: PreviewWallet.PreviewWallet["Service"], origin = LOCAL_ORIGIN) =>
  request(wallet, "eth_requestAccounts", [], origin);

/**
 * The wallet generates a fresh mnemonic per state directory, so tests read the
 * address back rather than hardcoding one — asserting a fixed address would be
 * asserting that the wallet is NOT throwaway.
 */
const activeAddress = Effect.fn("Wallet.test.activeAddress")(function* (
  wallet: PreviewWallet.PreviewWallet["Service"],
) {
  const status = yield* wallet.status;
  return status.selectedAddress ?? "";
});

/**
 * Yields until the parked queue reaches `count`. Cooperative rather than
 * time-based: `it.effect` runs on a test clock, so sleeping here would never
 * let the forked request fiber make progress.
 */
const waitForPending = Effect.fn("Wallet.test.waitForPending")(function* (
  wallet: PreviewWallet.PreviewWallet["Service"],
  count: number,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const list = yield* wallet.pendingRequests;
    if (list.requests.length >= count) return list;
    yield* Effect.yieldNow;
  }
  return yield* wallet.pendingRequests;
});

describe("startup", () => {
  it.effect("generates a test wallet and adopts a local node the first time it is enabled", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const status = yield* wallet.status;

        expect(status.enabled).toBe(true);
        expect(status.accounts.length).toBeGreaterThan(0);
        expect(status.selectedAddress).toBe(status.accounts[0]?.address);
        expect(status.chain?.chainId).toBe(31337);
        expect(status.rpcReachable).toBe(true);
        expect(status.connectedOrigins).toEqual([]);
      }),
    ),
  );

  it.effect("stays empty and closed when the wallet is disabled", () =>
    withWallet({ settings: { enabled: false } }, (wallet) =>
      Effect.gen(function* () {
        const status = yield* wallet.status;
        expect(status.enabled).toBe(false);
        expect(status.accounts).toEqual([]);

        const result = yield* request(wallet, "eth_accounts").pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect((result.failure as { code?: number }).code).toBe(4900);
        }
      }),
    ),
  );

  it.effect("falls back to Ethereum Mainnet when no local node is reachable", () => {
    const mainnet = getDefaultChain(1)!;
    return withWallet(
      {
        responders: {},
        respondersByUrl: { [mainnet.rpcUrl!]: { eth_chainId: "0x1" } },
      },
      (wallet) =>
        Effect.gen(function* () {
          const status = yield* wallet.status;
          expect(status.chain).toEqual(mainnet);
          expect(status.rpcReachable).toBe(true);
        }),
    );
  });

  it.effect("keeps the default network visible when its public RPC is unreachable", () =>
    withWallet({ responders: {} }, (wallet) =>
      Effect.gen(function* () {
        const status = yield* wallet.status;
        expect(status.chain?.chainId).toBe(1);
        expect(status.rpcReachable).toBe(false);
      }),
    ),
  );
});

describe("local reads", () => {
  it.effect("returns no accounts to an origin that has not connected", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        // MetaMask's behaviour: an empty list, not an error, so dapp
        // "not connected" branches work.
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
});

describe("connect grants", () => {
  it.effect("broadcasts account changes according to each preview origin's grant", () => {
    const grantedEvents: Array<{ event?: string; payload?: unknown }> = [];
    const ungrantedEvents: Array<{ event?: string; payload?: unknown }> = [];
    const guest = (origin: string, events: Array<{ event?: string; payload?: unknown }>) => ({
      getType: () => "webview",
      isDestroyed: () => false,
      getURL: () => `${origin}/page`,
      send: (_channel: string, event: unknown) => {
        events.push(event as { event?: string; payload?: unknown });
      },
    });
    electronMock.contents.push(
      guest(REMOTE_ORIGIN, grantedEvents),
      guest("https://other.example.test", ungrantedEvents),
    );

    return withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        const connectFiber = yield* Effect.forkChild(connect(wallet, REMOTE_ORIGIN));
        const pending = (yield* waitForPending(wallet, 1)).requests[0]!;
        yield* wallet.approve(pending.requestId);
        yield* Fiber.join(connectFiber);

        expect(grantedEvents.at(-1)?.event).toBe("accountsChanged");
        expect(grantedEvents.at(-1)?.payload).toEqual(
          expect.arrayContaining([yield* activeAddress(wallet)]),
        );
        expect(ungrantedEvents.at(-1)).toEqual({ event: "accountsChanged", payload: [] });
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          electronMock.contents.length = 0;
        }),
      ),
    );
  });

  it.effect("bootstraps account state only for an origin that was granted access", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        const connectFiber = yield* Effect.forkChild(connect(wallet, REMOTE_ORIGIN));
        const pending = (yield* waitForPending(wallet, 1)).requests[0]!;
        yield* wallet.approve(pending.requestId);
        yield* Fiber.join(connectFiber);
        yield* wallet.installGuestBridge;

        const bootstrap = electronMock.bootstrapListeners.get(PREVIEW_WALLET_BOOTSTRAP_CHANNEL)!;
        const eventFor = (origin: string) => {
          const event: { sender: unknown; returnValue?: unknown } = {
            sender: {
              id: GUEST_ID,
              getType: () => "webview",
              isDestroyed: () => false,
              getURL: () => `${origin}/page`,
              hostWebContents: { isDestroyed: () => false },
            },
          };
          bootstrap(event);
          return event.returnValue as PreviewWallet.PreviewWalletBootstrap;
        };

        expect(eventFor(REMOTE_ORIGIN).selectedAddress).toBe(yield* activeAddress(wallet));
        expect(eventFor("https://other.example.test").selectedAddress).toBeNull();
      }),
    ),
  );

  it.effect("auto-connects a loopback origin when that is switched on", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        const expected = yield* activeAddress(wallet);
        const accounts = (yield* connect(wallet)) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(expected);

        const status = yield* wallet.status;
        expect(status.connectedOrigins).toEqual([LOCAL_ORIGIN]);
        // And now eth_accounts answers for that origin.
        expect(yield* request(wallet, "eth_accounts")).toEqual(accounts);
      }),
    ),
  );

  it.effect("parks a remote origin's connect even in approve-everything mode", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        // "Approve everything" is meant to remove friction from local dev, not
        // to hand a signing oracle to any page the preview happens to load.
        const fiber = yield* Effect.forkChild(connect(wallet, REMOTE_ORIGIN));
        const parked = yield* waitForPending(wallet, 1);

        const pending = parked.requests[0];
        expect(pending?.method).toBe("eth_requestAccounts");
        expect(pending?.origin).toBe(REMOTE_ORIGIN);
        expect(pending?.summary).toContain(REMOTE_ORIGIN);

        yield* wallet.approve(pending!.requestId);
        const accounts = (yield* Fiber.join(fiber)) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(yield* activeAddress(wallet));
        expect((yield* wallet.status).connectedOrigins).toEqual([REMOTE_ORIGIN]);
      }),
    ),
  );

  it.effect("auto-approves a loopback origin once it is granted, without asking again", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        expect((yield* wallet.pendingRequests).requests).toEqual([]);

        const signature = yield* request(wallet, "personal_sign", [
          "0x68656c6c6f",
          yield* activeAddress(wallet),
        ]);
        expect(String(signature).startsWith("0x")).toBe(true);
      }),
    ),
  );

  it.effect("does not grant an origin when its first signature prompt is rejected", () =>
    withWallet({ settings: { approvalMode: "always-auto" } }, (wallet) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          request(
            wallet,
            "personal_sign",
            ["0x68656c6c6f", yield* activeAddress(wallet)],
            REMOTE_ORIGIN,
          ).pipe(Effect.result),
        );
        const parked = yield* waitForPending(wallet, 1);

        expect(parked.requests[0]?.summary).toContain("Approving also connects this site");
        yield* wallet.reject(parked.requests[0]!.requestId, 4001);
        const result = yield* Fiber.join(fiber);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect((result.failure as { code?: number }).code).toBe(4001);
        }
        expect((yield* wallet.status).connectedOrigins).toEqual([]);
        expect((yield* wallet.pendingRequests).requests).toEqual([]);
      }),
    ),
  );
});

describe("the approval gate", () => {
  it.effect("publishes parked requests to the preview approval UI", () =>
    withWallet({ settings: { approvalMode: "always-ask" } }, (wallet) =>
      Effect.gen(function* () {
        const publishedPendingCounts: Array<number> = [];
        yield* wallet.subscribeStateChanges((status) =>
          Effect.sync(() => {
            publishedPendingCounts.push(status.pendingRequests.length);
          }),
        );

        const fiber = yield* Effect.forkChild(connect(wallet, REMOTE_ORIGIN).pipe(Effect.result));
        const parked = yield* waitForPending(wallet, 1);

        expect(publishedPendingCounts).toContain(1);
        yield* wallet.reject(parked.requests[0]!.requestId);
        yield* Fiber.join(fiber);
      }),
    ),
  );

  it.effect("parks every signature in always-ask mode", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(
          request(wallet, "personal_sign", ["0x68656c6c6f", yield* activeAddress(wallet)]),
        );
        const parked = yield* waitForPending(wallet, 1);
        expect(parked.requests[0]?.summary).toContain("hello");

        yield* wallet.approve(parked.requests[0]!.requestId);
        expect(String(yield* Fiber.join(fiber)).startsWith("0x")).toBe(true);
        expect((yield* wallet.pendingRequests).requests).toEqual([]);
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
        const signRequest = (yield* waitForPending(wallet, 1)).requests[0]!;

        expect(signRequest.method).toBe("eth_signTypedData_v4");
        expect(signRequest.summary).toContain("VerifiableCredential");
        expect(signRequest.summary).toContain("chain 1");
        expect(signRequest.summary).toContain("Approving also connects this site");

        const resolution = yield* wallet.approve(signRequest.requestId);
        expect(resolution.failure).toBeNull();
        const signature = String(yield* Fiber.join(signFiber));
        expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);
        expect((yield* wallet.status).connectedOrigins).toEqual([REMOTE_ORIGIN]);
        expect((yield* wallet.pendingRequests).requests).toEqual([]);
      }),
    ),
  );

  it.effect("gives the page the chosen EIP-1193 code on rejection", () =>
    withWallet({ settings: { approvalMode: "always-ask", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const fiber = yield* Effect.forkChild(
          request(wallet, "personal_sign", ["0x68656c6c6f", yield* activeAddress(wallet)]).pipe(
            Effect.result,
          ),
        );
        const parked = yield* waitForPending(wallet, 1);

        const resolution = yield* wallet.reject(parked.requests[0]!.requestId, 4001);
        expect(resolution.outcome).toBe("rejected");

        const result = yield* Fiber.join(fiber);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect((result.failure as { code?: number }).code).toBe(4001);
        }
      }),
    ),
  );

  it.effect("does not auto-approve for an idle tab in auto-for-agents mode", () =>
    withWallet(
      { settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          yield* Effect.forkChild(
            request(wallet, "personal_sign", ["0x68656c6c6f", yield* activeAddress(wallet)]),
          );
          const parked = yield* waitForPending(wallet, 1);
          expect(parked.requests).toHaveLength(1);
        }),
    ),
  );

  it.effect("auto-approves once an automation action has touched that tab", () =>
    withWallet(
      { settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          // This is the signal PreviewManager sends from withControlSession.
          yield* wallet.noteAgentActivity(GUEST_ID);

          const signature = yield* request(wallet, "personal_sign", [
            "0x68656c6c6f",
            yield* activeAddress(wallet),
          ]);
          expect(String(signature).startsWith("0x")).toBe(true);
          expect((yield* wallet.pendingRequests).requests).toEqual([]);
        }),
    ),
  );

  it.effect("keeps agent activity scoped to the tab it happened on", () =>
    withWallet(
      { settings: { approvalMode: "auto-for-agents", autoConnectLoopback: true } },
      (wallet) =>
        Effect.gen(function* () {
          yield* connect(wallet);
          yield* wallet.noteAgentActivity(GUEST_ID);

          // A different guest is not agent-driven, so its request still parks.
          yield* Effect.forkChild(
            wallet.handleRequest({
              method: "personal_sign",
              params: ["0x68656c6c6f", yield* activeAddress(wallet)],
              origin: LOCAL_ORIGIN,
              webContentsId: GUEST_ID + 1,
            }),
          );
          const parked = yield* waitForPending(wallet, 1);
          expect(parked.requests).toHaveLength(1);
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
          {
            chainId: "0x7a69",
            chainName: "Local Anvil",
            rpcUrls: ["http://127.0.0.1:8545"],
          },
        ]);

        const status = yield* wallet.status;
        expect(status.chain?.chainId).toBe(31337);
        expect(status.chain?.name).toBe("Local Anvil");
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

          const status = yield* wallet.status;
          expect(status.chain).toEqual(base);
          expect(status.rpcReachable).toBe(true);
        }),
    );
  });

  it.effect("refuses to switch to a chain it has no endpoint for", () =>
    withWallet({ settings: { approvalMode: "always-auto", autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        const result = yield* request(wallet, "wallet_switchEthereumChain", [
          { chainId: "0x67932" },
        ]).pipe(Effect.result);

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          // 4902: claiming a chain we cannot read would be worse than refusing.
          expect((result.failure as { code?: number }).code).toBe(4902);
        }
        expect((yield* wallet.status).chain?.chainId).toBe(31337);
      }),
    ),
  );
});

describe("passthrough", () => {
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
});

describe("transactions", () => {
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

  it.effect("adds a generated account and makes it active", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const before = yield* wallet.status;
        const after = yield* wallet.configure({ generateAccount: true });

        expect(after.accounts).toHaveLength(before.accounts.length + 1);
        expect(after.selectedAddress).toBe(after.accounts.at(-1)?.address);
      }),
    ),
  );

  it.effect("creates a mnemonic and first account when the keystore is still empty", () =>
    withWallet({ settings: { enabled: false } }, (wallet) =>
      Effect.gen(function* () {
        expect((yield* wallet.status).accounts).toHaveLength(0);

        const after = yield* wallet.configure({ generateAccount: true });

        expect(after.accounts).toHaveLength(1);
        expect(after.selectedAddress).toBe(after.accounts[0]?.address);
      }),
    ),
  );

  it.effect("switches the active account and reorders eth_accounts", () =>
    withWallet({ settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        const status = yield* wallet.status;
        const second = status.accounts[1]!.address;
        yield* wallet.configure({ selectedAddress: second });
        yield* connect(wallet);

        const accounts = (yield* request(wallet, "eth_accounts")) as ReadonlyArray<string>;
        expect(accounts[0]).toBe(second);
      }),
    ),
  );

  it.effect("refuses an account the wallet does not hold", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        const result = yield* wallet
          .configure({ selectedAddress: "0x0000000000000000000000000000000000000001" })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure._tag).toBe("PreviewWalletNoAccountError");
        }
      }),
    ),
  );

  it.effect("clears connect grants so the next request prompts again", () =>
    withWallet({ settings: { autoConnectLoopback: true } }, (wallet) =>
      Effect.gen(function* () {
        yield* connect(wallet);
        expect((yield* wallet.status).connectedOrigins).toEqual([LOCAL_ORIGIN]);

        const after = yield* wallet.configure({ clearConnectedOrigins: true });
        expect(after.connectedOrigins).toEqual([]);
        expect(yield* request(wallet, "eth_accounts")).toEqual([]);
      }),
    ),
  );

  it.effect("persists the keystore across a restart", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "vetra-wallet-restart-",
      });
      const serverSettingsPath = path.join(stateDir, "settings.json");
      yield* fileSystem.writeFileString(serverSettingsPath, settingsJson({}));

      const layer = Layer.mergeAll(
        Layer.succeed(
          DesktopEnvironment.DesktopEnvironment,
          DesktopEnvironment.DesktopEnvironment.of({
            serverSettingsPath,
            previewWalletsDir: path.join(stateDir, "preview-wallets"),
            path,
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
        rpcLayer(ANVIL_RESPONDERS),
      );

      const first = yield* PreviewWallet.make.pipe(Effect.provide(layer));
      const firstStatus = yield* first.status;

      // A fresh service over the same state directory is a restart.
      const second = yield* PreviewWallet.make.pipe(Effect.provide(layer));
      const secondStatus = yield* second.status;

      expect(secondStatus.accounts).toEqual(firstStatus.accounts);
      expect(secondStatus.selectedAddress).toBe(firstStatus.selectedAddress);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("applySettings", () => {
  it.effect("turning the wallet off closes it to pages", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        yield* wallet.applySettings({
          enabled: false,
          approvalMode: "auto-for-agents",
          chainId: null,
          rpcUrl: null,
          autoConnectLoopback: false,
        });

        expect((yield* wallet.status).enabled).toBe(false);
        const result = yield* request(wallet, "eth_chainId").pipe(Effect.result);
        expect(result._tag).toBe("Failure");
      }),
    ),
  );

  it.effect("an explicit chain override wins over the local node", () =>
    withWallet({}, (wallet) =>
      Effect.gen(function* () {
        yield* wallet.applySettings({
          enabled: true,
          approvalMode: "auto-for-agents",
          chainId: 11155111,
          rpcUrl: "https://sepolia.example.test",
          autoConnectLoopback: false,
        });

        const status = yield* wallet.status;
        expect(status.chain?.chainId).toBe(11155111);
        expect(status.chain?.rpcUrl).toBe("https://sepolia.example.test");
        expect(status.rpcReachable).toBe(false);
      }),
    ),
  );
});
