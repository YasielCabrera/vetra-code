/**
 * The Electron end of the preview wallet.
 *
 * A page in a `<webview>` that renders one of the server's tabs gets an
 * EIP-1193 provider from `WalletPreload.ts`, and this answers that preload. The
 * server's wallet signs, so nothing here holds keys or wallet state of its own:
 * it decides which guest is asking, takes the origin from the browser rather
 * than the page, forwards the call through `DesktopBrowserHost`, and replays
 * the server's wallet state to each page as provider events.
 *
 * The handlers sit on `ipcMain` itself rather than the typed `DesktopIpc`
 * helpers, which drop `event.sender`, the only identity a page cannot forge.
 */
import {
  EMPTY_PAGE_VIEW,
  pageEventsBetween,
  pageViewFor,
  type Web3PageView,
} from "@t3tools/web3/page";
import {
  WEB3_GUEST_PARAMS_MAX_BYTES,
  type Web3GuestReply,
  type Web3PageState,
} from "@t3tools/web3/schema";
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";
import {
  PREVIEW_WALLET_BOOTSTRAP_CHANNEL,
  PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL,
  PREVIEW_WALLET_REQUEST_CHANNEL,
  type PreviewWalletBootstrap,
} from "./GuestProtocol.ts";
import * as PreviewManager from "./Manager.ts";

/**
 * How long a page waits for its host to register the tab it renders. A tab
 * opened straight to a URL starts its first document before that lands.
 */
const REGISTRATION_TIMEOUT = "3 seconds";

const DISABLED: PreviewWalletBootstrap = { enabled: false };
const NOT_AVAILABLE: Web3GuestReply = {
  ok: false,
  code: 4100,
  message: "The preview wallet is not available here.",
};
const INVALID_REQUEST: Web3GuestReply = {
  ok: false,
  code: -32600,
  message: "Invalid request.",
};
const PARAMS_TOO_LARGE: Web3GuestReply = {
  ok: false,
  code: -32602,
  message: "The request params are too large.",
};
const REQUEST_FAILED: Web3GuestReply = {
  ok: false,
  code: -32603,
  message: "The preview wallet request failed.",
};

const decodeGuestRequest = Schema.decodeUnknownOption(
  Schema.Struct({
    documentId: Schema.String,
    method: Schema.String,
    params: Schema.optional(Schema.Unknown),
  }),
);
const encodeJson = Schema.encodeOption(Schema.fromJsonString(Schema.Unknown));
const byteEncoder = new TextEncoder();

/** The server's bound, checked here too so an oversized call never crosses the channel. */
const paramsTooLarge = (params: unknown) =>
  Option.match(encodeJson(params ?? null), {
    // Cycles and bigints have no JSON form to send.
    onNone: () => true,
    onSome: (json) => byteEncoder.encode(json).length > WEB3_GUEST_PARAMS_MAX_BYTES,
  });

/** `about:blank` and opaque origins collapse to a stable, non-matching value. */
const originOf = (url: string): string => {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? "about:blank" : origin;
  } catch {
    return "about:blank";
  }
};

/** A guest document that was given a provider, and what it has been told since. */
interface Guest {
  readonly contents: WebContents;
  readonly documentId: string;
  view: Web3PageView;
}

const make = Effect.gen(function* () {
  const browserHost = yield* DesktopBrowserHost.DesktopBrowserHost;
  const manager = yield* PreviewManager.PreviewManager;
  const crypto = yield* Crypto.Crypto;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const guests = new Map<number, Guest>();
  const watched = new WeakSet<WebContents>();

  /** The tab a guest renders, waiting for its host to register it if it has not yet. */
  const registeredTab = (webContentsId: number) =>
    Effect.gen(function* () {
      const registered = yield* Deferred.make<PreviewManager.PreviewTabState>();
      // Subscribed before the lookup, so a registration between the two still lands.
      yield* manager.subscribeStateChanges((_tabId, state) =>
        state.webContentsId === webContentsId
          ? Deferred.succeed(registered, state).pipe(Effect.asVoid)
          : Effect.void,
      );
      const known = yield* manager.tabForGuest(webContentsId);
      if (known !== null) return known;
      return yield* Deferred.await(registered).pipe(
        Effect.timeoutOption(REGISTRATION_TIMEOUT),
        Effect.map(Option.getOrNull),
      );
    }).pipe(Effect.scoped);

  /**
   * The server tab whose page sent this, or null. Only the top frame of a
   * `<webview>` the preview manager registered for a server tab qualifies: not
   * the app's own renderer, not a local tab, not an embedded frame.
   */
  const serverTabOf = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const sender = event.sender;
    if (sender.isDestroyed() || sender.getType() !== "webview") return Effect.succeed(null);
    if (event.senderFrame !== sender.mainFrame) return Effect.succeed(null);
    return registeredTab(sender.id).pipe(Effect.map((tab) => tab?.serverTab ?? null));
  };

  const track = (contents: WebContents, guest: Guest) => {
    guests.set(contents.id, guest);
    if (watched.has(contents)) return;
    watched.add(contents);
    const id = contents.id;
    contents.once("destroyed", () => guests.delete(id));
  };

  const bootstrap = (event: IpcMainEvent) =>
    Effect.gen(function* () {
      const contents = event.sender;
      if ((yield* serverTabOf(event)) === null) return DISABLED;
      // A new document starts over, whatever the last one was told.
      guests.delete(contents.id);
      const state = browserHost.walletState();
      if (state === null || !state.enabled) return DISABLED;
      const view = pageViewFor(state, originOf(contents.getURL()));
      const documentId = yield* crypto.randomUUIDv4;
      track(contents, { contents, documentId, view });
      return {
        enabled: true,
        uuid: state.uuid,
        chainId: state.chainId,
        selectedAddress: view.accounts[0] ?? null,
        documentId,
      } satisfies PreviewWalletBootstrap;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("preview wallet bootstrap failed", { cause }).pipe(Effect.as(DISABLED)),
      ),
    );

  const request = (event: IpcMainInvokeEvent, raw: unknown) =>
    Effect.gen(function* () {
      const serverTab = yield* serverTabOf(event);
      const guest = guests.get(event.sender.id);
      if (serverTab === null || guest === undefined) return NOT_AVAILABLE;
      const payload = decodeGuestRequest(raw);
      if (Option.isNone(payload)) return INVALID_REQUEST;
      // Only the document this guest shows now; an earlier one has nobody to answer.
      if (payload.value.documentId !== guest.documentId) return NOT_AVAILABLE;
      if (paramsTooLarge(payload.value.params)) return PARAMS_TOO_LARGE;
      return yield* browserHost.walletRequest({
        ...serverTab,
        documentId: guest.documentId,
        origin: originOf(event.sender.getURL()),
        method: payload.value.method,
        // The channel needs the key; JSON-RPC reads an empty list as no params.
        params: payload.value.params ?? [],
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("preview wallet request failed", { cause }).pipe(
          Effect.as(REQUEST_FAILED),
        ),
      ),
    );

  /** Each page hears only what its origin may see, and only what changed for it. */
  const replayState = (state: Web3PageState | null) =>
    Effect.sync(() => {
      for (const guest of guests.values()) {
        if (guest.contents.isDestroyed()) continue;
        const view =
          state === null ? EMPTY_PAGE_VIEW : pageViewFor(state, originOf(guest.contents.getURL()));
        for (const providerEvent of pageEventsBetween(guest.view, view)) {
          guest.contents.send(PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL, providerEvent);
        }
        guest.view = view;
      }
    });

  yield* browserHost.walletStates.pipe(
    Stream.runForEach((state) =>
      replayState(state).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("could not tell preview pages about the wallet", { cause }),
        ),
      ),
    ),
    Effect.forkScoped,
  );

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      // Synchronous for the page, so its first inline script already finds
      // `window.ethereum`: it waits in `sendSync` until `returnValue` is set.
      ipcMain.on(PREVIEW_WALLET_BOOTSTRAP_CHANNEL, (event) => {
        void runPromise(bootstrap(event)).then(
          (reply) => {
            event.returnValue = reply;
          },
          () => {
            event.returnValue = DISABLED;
          },
        );
      });
      ipcMain.handle(PREVIEW_WALLET_REQUEST_CHANNEL, (event, raw) =>
        runPromise(request(event, raw)),
      );
    }),
    () =>
      Effect.sync(() => {
        ipcMain.removeAllListeners(PREVIEW_WALLET_BOOTSTRAP_CHANNEL);
        ipcMain.removeHandler(PREVIEW_WALLET_REQUEST_CHANNEL);
      }),
  );
});

export const layer = Layer.effectDiscard(make);
