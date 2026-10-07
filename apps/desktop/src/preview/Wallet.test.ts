import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type { Web3ProviderEvent } from "@t3tools/web3/inpage";
import type { Web3GuestReply, Web3PageState } from "@t3tools/web3/schema";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";
import * as BrowserSession from "./BrowserSession.ts";
import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";
import {
  PREVIEW_WALLET_BOOTSTRAP_CHANNEL,
  PREVIEW_WALLET_REQUEST_CHANNEL,
  type PreviewWalletBootstrap,
} from "./GuestProtocol.ts";
import * as PreviewManager from "./Manager.ts";
import * as PreviewWallet from "./Wallet.ts";

const electronMock = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  /** The guests the real preview manager can look up by id. */
  webContents: new Map<number, unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    on: (channel: string, listener: (event: unknown) => void) => {
      electronMock.listeners.set(channel, listener);
    },
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      electronMock.listeners.set(channel, handler);
    },
    removeAllListeners: (channel: string) => {
      electronMock.listeners.delete(channel);
    },
    removeHandler: (channel: string) => {
      electronMock.listeners.delete(channel);
    },
  },
  webContents: {
    fromId: (id: number) => electronMock.webContents.get(id) ?? null,
    getFocusedWebContents: () => null,
  },
}));

const GRANTED_ORIGIN = "http://localhost:5173";
const OTHER_ORIGIN = "https://other.example.test";
const ACTIVE = "0x00000000000000000000000000000000000000aa";
const SECOND = "0x00000000000000000000000000000000000000bb";
const SERVER_TAB = { threadId: "thread-1", tabId: "tab-1" };
const REGISTERED_GUEST = 42;
const REGISTERED_GUEST_2 = 43;
/** A guest the manager registered for a tab of its own, not the server's. */
const LOCAL_GUEST = 7;

const enabledState = (overrides: Partial<Web3PageState> = {}): Web3PageState => ({
  enabled: true,
  uuid: "wallet-1",
  chainId: "0x7a69",
  accounts: [ACTIVE, SECOND],
  connectedOrigins: [GRANTED_ORIGIN],
  ...overrides,
});

const tabState = (
  webContentsId: number,
  serverTab?: typeof SERVER_TAB,
): PreviewManager.PreviewTabState => ({
  tabId: `runtime-${webContentsId}`,
  webContentsId,
  navStatus: { kind: "Idle" },
  canGoBack: false,
  canGoForward: false,
  zoomFactor: 1,
  pictureInPicture: false,
  colorScheme: "system",
  audioMuted: false,
  audible: false,
  controller: "none",
  ...(serverTab === undefined ? {} : { serverTab }),
  updatedAt: "2026-10-07T00:00:00.000Z",
});

/** A `<webview>` guest's webContents, recording the provider events it is sent. */
const makeGuest = (id: number, url: string, onSend: () => void = () => {}) => {
  const sent: Array<Web3ProviderEvent> = [];
  const contents = {
    id,
    mainFrame: { name: "main" },
    isDestroyed: () => false,
    getType: () => "webview",
    getURL: () => url,
    once: () => undefined,
    send: (_channel: string, event: Web3ProviderEvent) => {
      sent.push(event);
      onSend();
    },
  };
  return { contents, sent };
};
type Guest = ReturnType<typeof makeGuest>;

/**
 * Sends a document's synchronous bootstrap. Electron replies when the handler
 * sets `returnValue`, so the page waits until the returned answer completes.
 */
const startBootstrap = (guest: Guest, frame: unknown = guest.contents.mainFrame) =>
  Effect.gen(function* () {
    const answer = yield* Deferred.make<PreviewWalletBootstrap>();
    electronMock.listeners.get(PREVIEW_WALLET_BOOTSTRAP_CHANNEL)!({
      sender: guest.contents,
      senderFrame: frame,
      set returnValue(value: PreviewWalletBootstrap) {
        Deferred.doneUnsafe(answer, Effect.succeed(value));
      },
    });
    return answer;
  });

const bootstrap = (guest: Guest, frame?: unknown) =>
  startBootstrap(guest, frame).pipe(Effect.flatMap(Deferred.await));

const request = (guest: Guest, payload: unknown, frame: unknown = guest.contents.mainFrame) =>
  Effect.promise(
    () =>
      electronMock.listeners.get(PREVIEW_WALLET_REQUEST_CHANNEL)!(
        { sender: guest.contents, senderFrame: frame },
        payload,
      ) as Promise<Web3GuestReply>,
  );

/**
 * Runs `use` with the guest bridge installed over a stand-in browser host,
 * which reports `state` and answers every forwarded call with `reply`.
 */
const withBridge = <A, E>(
  use: (bridge: {
    readonly setState: (state: Web3PageState | null) => Effect.Effect<void>;
    readonly forwarded: ReadonlyArray<unknown>;
  }) => Effect.Effect<A, E, Scope.Scope>,
  reply: Web3GuestReply = { ok: true, result: [ACTIVE] },
) =>
  Effect.gen(function* () {
    let state: Web3PageState | null = null;
    const states = yield* PubSub.unbounded<Web3PageState | null>({ replay: 1 });
    const forwarded: Array<unknown> = [];
    const layerBrowserHost = Layer.mock(DesktopBrowserHost.DesktopBrowserHost)({
      attach: () => {},
      detach: () => {},
      placeDownload: () => false,
      walletState: () => state,
      walletStates: Stream.fromPubSub(states),
      walletRequest: (input) =>
        Effect.sync(() => {
          forwarded.push(input);
          return reply;
        }),
    });
    const layerManager = Layer.mock(PreviewManager.PreviewManager)({
      isBrowserPartition: () => false,
      subscribeStateChanges: () => Effect.void,
      tabForGuest: (webContentsId) =>
        Effect.succeed(
          webContentsId === REGISTERED_GUEST || webContentsId === REGISTERED_GUEST_2
            ? tabState(webContentsId, SERVER_TAB)
            : webContentsId === LOCAL_GUEST
              ? tabState(webContentsId)
              : null,
        ),
    });
    const setState = (next: Web3PageState | null) =>
      Effect.sync(() => {
        state = next;
      }).pipe(Effect.andThen(PubSub.publish(states, next)));
    return yield* use({ setState, forwarded }).pipe(
      Effect.provide(
        PreviewWallet.layer.pipe(
          Layer.provide([layerBrowserHost, layerManager, NodeServices.layer]),
        ),
      ),
    );
  }).pipe(Effect.scoped);

describe("PreviewWallet guest bridge", () => {
  it.effect("refuses anything but the top frame of a registered server tab guest", () =>
    withBridge(({ setState, forwarded }) =>
      Effect.gen(function* () {
        yield* setState(enabledState());
        const stranger = makeGuest(LOCAL_GUEST, `${GRANTED_ORIGIN}/`);
        expect(yield* bootstrap(stranger)).toEqual({ enabled: false });
        expect(yield* request(stranger, { documentId: "x", method: "eth_accounts" })).toMatchObject(
          { ok: false, code: 4100 },
        );

        const guest = makeGuest(REGISTERED_GUEST, `${GRANTED_ORIGIN}/`);
        const frame = { name: "embedded" };
        expect(yield* bootstrap(guest, frame)).toEqual({ enabled: false });
        const started = yield* bootstrap(guest);
        assertEnabled(started);
        expect(
          yield* request(guest, { documentId: started.documentId, method: "eth_accounts" }, frame),
        ).toMatchObject({ ok: false, code: 4100 });
        expect(forwarded).toEqual([]);
      }),
    ),
  );

  it.effect("gives pages no wallet before the server has reported one", () =>
    withBridge(() =>
      Effect.gen(function* () {
        expect(yield* bootstrap(makeGuest(REGISTERED_GUEST, `${GRANTED_ORIGIN}/`))).toEqual({
          enabled: false,
        });
      }),
    ),
  );

  it.effect("shares the active account only with an origin the wallet granted", () =>
    withBridge(({ setState }) =>
      Effect.gen(function* () {
        yield* setState(enabledState());
        const granted = yield* bootstrap(makeGuest(REGISTERED_GUEST, `${GRANTED_ORIGIN}/app`));
        const other = yield* bootstrap(makeGuest(REGISTERED_GUEST_2, `${OTHER_ORIGIN}/app`));

        expect(granted).toMatchObject({
          enabled: true,
          uuid: "wallet-1",
          chainId: "0x7a69",
          selectedAddress: ACTIVE,
        });
        expect(other).toMatchObject({ enabled: true, selectedAddress: null });
        assertEnabled(granted);
        assertEnabled(other);
        expect(granted.documentId).not.toBe(other.documentId);
      }),
    ),
  );

  it.effect("forwards a call with the tab, document and origin the browser reports", () =>
    withBridge(({ setState, forwarded }) =>
      Effect.gen(function* () {
        yield* setState(enabledState());
        const guest = makeGuest(REGISTERED_GUEST, `${GRANTED_ORIGIN}/app?x=1`);
        const started = yield* bootstrap(guest);
        assertEnabled(started);

        const reply = yield* request(guest, {
          documentId: started.documentId,
          method: "eth_requestAccounts",
          // Whatever the page claims, the origin comes from its webContents.
          origin: "https://attacker.example.test",
        });

        expect(reply).toEqual({ ok: true, result: [ACTIVE] });
        expect(forwarded).toEqual([
          {
            ...SERVER_TAB,
            documentId: started.documentId,
            origin: GRANTED_ORIGIN,
            method: "eth_requestAccounts",
            params: [],
          },
        ]);

        // A document the guest no longer shows, or a call too big to send, never leaves.
        expect(
          yield* request(guest, { documentId: "earlier-document", method: "eth_accounts" }),
        ).toMatchObject({ ok: false, code: 4100 });
        expect(
          yield* request(guest, {
            documentId: started.documentId,
            method: "personal_sign",
            params: ["x".repeat(300 * 1024)],
          }),
        ).toMatchObject({ ok: false, code: -32602 });
        expect(forwarded).toHaveLength(1);
      }),
    ),
  );

  it.effect("tells each page only what changed for its own origin", () =>
    withBridge(({ setState }) =>
      Effect.gen(function* () {
        yield* setState(enabledState());
        const otherSent = yield* Deferred.make<void>();
        const granted = makeGuest(REGISTERED_GUEST, `${GRANTED_ORIGIN}/`);
        const other = makeGuest(REGISTERED_GUEST_2, `${OTHER_ORIGIN}/`, () => {
          Deferred.doneUnsafe(otherSent, Effect.void);
        });
        yield* bootstrap(granted);
        yield* bootstrap(other);

        yield* setState(enabledState({ chainId: "0x1", accounts: [SECOND, ACTIVE] }));
        // Pages hear changes in the order they started; this one is last.
        yield* Deferred.await(otherSent);

        expect(granted.sent).toEqual([
          { event: "chainChanged", payload: "0x1" },
          { event: "accountsChanged", payload: [SECOND, ACTIVE] },
        ]);
        expect(other.sent).toEqual([{ event: "chainChanged", payload: "0x1" }]);
      }),
    ),
  );
});

/** A guest the real preview manager can register, with the methods registration reads. */
const makeRegistrableGuest = (id: number, url: string) => {
  const guest = makeGuest(id, url);
  const ignore = () => undefined;
  electronMock.webContents.set(
    id,
    Object.assign(guest.contents, {
      hostWebContents: { id: 1, isDestroyed: () => false },
      getTitle: () => "",
      isLoading: () => false,
      getZoomFactor: () => 1,
      setZoomFactor: ignore,
      setAudioMuted: ignore,
      setBackgroundThrottling: ignore,
      isCurrentlyAudible: () => false,
      on: ignore,
      off: ignore,
      ipc: { on: ignore, off: ignore },
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      setIgnoreMenuShortcuts: ignore,
      setWindowOpenHandler: ignore,
      executeJavaScript: async () => undefined,
      debugger: {
        isAttached: () => false,
        attach: ignore,
        detach: ignore,
        sendCommand: async () => undefined,
        on: ignore,
        off: ignore,
      },
    }),
  );
  return guest;
};

const layerRealManager = PreviewManager.layer.pipe(
  Layer.provideMerge(DesktopBrowserHost.layer),
  Layer.provideMerge(
    Layer.succeed(DesktopRendererHistory.DesktopRendererHistory, {
      register: () => Effect.void,
      recordMetrics: () => Effect.void,
      shutdown: Effect.void,
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(
      BrowserSession.BrowserSession,
      BrowserSession.BrowserSession.of({
        getPartition: () => Effect.succeed("persist:vetra-code-preview-test"),
        isPartition: (partition) => partition.startsWith("persist:vetra-code-preview-"),
        getSession: () => Effect.die("unused"),
        clearCookies: () => Effect.void,
        clearCache: () => Effect.void,
      }),
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
      browserArtifactsDir: "/tmp/vetra/dev/browser-artifacts",
      previewWalletsDir: "/tmp/vetra/dev/preview-wallets",
      dirname: "/tmp/vetra/desktop",
      path: { join: (...parts: ReadonlyArray<string>) => parts.join("/") },
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
  ),
  Layer.provideMerge(FileSystem.layerNoop({})),
  Layer.provideMerge(Layer.succeed(HostProcessPlatform, "darwin")),
);

/** The bridge over the real preview manager and the real end of the server's channel. */
const withManager = <A, E>(
  use: (services: {
    readonly manager: PreviewManager.PreviewManager["Service"];
    readonly browserHost: DesktopBrowserHost.DesktopBrowserHost["Service"];
  }) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const manager = yield* PreviewManager.PreviewManager;
    const browserHost = yield* DesktopBrowserHost.DesktopBrowserHost;
    // The line the server writes; mainnet's id is the odd-length `0x1`.
    yield* browserHost.handleCommandLine(
      JSON.stringify({ type: "walletState", state: enabledState({ chainId: "0x1" }) }),
    );
    return yield* use({ manager, browserHost });
  }).pipe(
    Effect.provide(
      PreviewWallet.layer.pipe(
        Layer.provideMerge(layerRealManager),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );

describe("PreviewWallet guest bridge with the preview manager", () => {
  it.effect("gives a tab's first document its provider once the host registers the tab", () =>
    withManager(({ manager }) =>
      Effect.gen(function* () {
        yield* manager.createTab("runtime-tab", { serverTab: SERVER_TAB });
        const guest = makeRegistrableGuest(REGISTERED_GUEST, `${GRANTED_ORIGIN}/`);
        // A tab opened straight to a URL starts its document before the host registers it.
        const answer = yield* startBootstrap(guest);
        yield* manager.registerWebview("runtime-tab", REGISTERED_GUEST);

        expect(yield* Deferred.await(answer)).toMatchObject({
          enabled: true,
          chainId: "0x1",
          selectedAddress: ACTIVE,
        });
      }),
    ),
  );

  it.effect("gives no wallet to a guest no tab claims", () =>
    withManager(() =>
      Effect.gen(function* () {
        const answer = yield* startBootstrap(makeRegistrableGuest(99, `${GRANTED_ORIGIN}/`));
        expect(yield* Deferred.isDone(answer)).toBe(false);
        yield* TestClock.adjust("3 seconds");

        expect(yield* Deferred.await(answer)).toEqual({ enabled: false });
      }),
    ),
  );
});

function assertEnabled(
  bootstrap: PreviewWalletBootstrap,
): asserts bootstrap is Extract<PreviewWalletBootstrap, { enabled: true }> {
  expect(bootstrap.enabled).toBe(true);
}
