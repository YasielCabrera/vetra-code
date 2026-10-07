// @effect-diagnostics nodeBuiltinImport:off - Names download files on the shared disk.
/**
 * The desktop end of the desktop browser channel (see `DesktopBrowserEvent` in
 * contracts). The primary backend gets two file descriptors at spawn: this
 * service writes events for the desktop's tabs to one and reads commands from
 * the other. Each attached tab is reachable only through its `CdpRelay`.
 *
 * A tab is attached once its `<webview>` registers with a key the web app
 * gave it. The preview manager owns the tab's single debugger session and hands
 * it here; the relay shares it.
 *
 * The server's preview wallet signs for these tabs too. `Wallet.ts` vouches for
 * the page asking; this forwards the request, routes the reply, and keeps the
 * wallet state the server last said pages may see. Each run starts by offering
 * the keystore from when the desktop signed for itself.
 */
import {
  DesktopBrowserCommand,
  DesktopBrowserEvent,
  type DesktopBrowserEvent as DesktopBrowserEventType,
} from "@t3tools/contracts";
import { keystoreFileName, readKeystore } from "@t3tools/web3/keystore";
import type { Web3GuestReply, Web3PageState } from "@t3tools/web3/schema";
import * as Context from "effect/Context";
import * as NodePath from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { createCdpRelayConnection, type CdpRelayConnection } from "./CdpRelay.ts";

const encodeEvent = Schema.encodeSync(Schema.fromJsonString(DesktopBrowserEvent));
const encodeEventOption = Schema.encodeOption(Schema.fromJsonString(DesktopBrowserEvent));
const decodeCommand = Schema.decodeUnknownOption(Schema.fromJsonString(DesktopBrowserCommand));
const lineEncoder = new TextEncoder();

export interface DesktopBrowserTabKey {
  readonly threadId: string;
  readonly tabId: string;
}

/** A tab's debugger, as the preview manager lends it to the relay. */
export interface DesktopBrowserTabDebugger {
  readonly webContents: Electron.WebContents;
  readonly debugger: Electron.Debugger;
}

const keyOf = ({ threadId, tabId }: DesktopBrowserTabKey) => `${threadId}\u0000${tabId}`;

const WALLET_NOT_CONNECTED: Web3GuestReply = {
  ok: false,
  code: 4900,
  message: "The preview wallet is not connected.",
};
const WALLET_INVALID_REQUEST: Web3GuestReply = {
  ok: false,
  code: -32600,
  message: "Invalid request.",
};
/** Outlasts the server's own five-minute expiry for a request waiting on approval. */
const WALLET_REPLY_TIMEOUT = "6 minutes";

interface AttachedTab {
  readonly key: DesktopBrowserTabKey;
  readonly debuggee: DesktopBrowserTabDebugger;
  relay: CdpRelayConnection | null;
  /** Where the server wants this tab's downloads; null keeps Electron's own handling. */
  downloadDirectory: string | null;
  /** The guid CDP gave the download that is about to start. */
  pendingDownloadGuid: string | null;
  readonly onMessage: (
    event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
  ) => void;
}

export class DesktopBrowserHost extends Context.Service<
  DesktopBrowserHost,
  {
    /**
     * Newline-delimited events for a backend's browser fd. Each run starts by
     * announcing the tabs already attached, so a restarted backend hears them.
     */
    readonly events: Stream.Stream<Uint8Array>;
    /** One line from the backend's browser control fd. */
    readonly handleCommandLine: (line: string) => Effect.Effect<void>;
    /** Offers a server tab's `<webview>` to the server. */
    readonly attach: (key: DesktopBrowserTabKey, debuggee: DesktopBrowserTabDebugger) => void;
    /** Withdraws it: closed, swapped, crashed, or devtools needs the debugger. */
    readonly detach: (key: DesktopBrowserTabKey) => void;
    /** Points a server tab's download at the server; false for any other download. */
    readonly placeDownload: (source: Electron.WebContents, item: Electron.DownloadItem) => boolean;
    /** The agent's cursor positions for attached tabs, keyed by their server tab. */
    readonly pointers: Stream.Stream<{
      readonly key: DesktopBrowserTabKey;
      readonly phase: "move" | "click";
      readonly x: number;
      readonly y: number;
    }>;
    /**
     * Sends a page's wallet call to the server's wallet and waits for its
     * answer, which is 4900 when no run is connected or the run ends first.
     */
    readonly walletRequest: (
      request: Omit<
        Extract<DesktopBrowserEventType, { readonly type: "walletRequest" }>,
        "type" | "requestId"
      >,
    ) => Effect.Effect<Web3GuestReply>;
    /** What the server last said pages may know of its wallet; null between runs. */
    readonly walletState: () => Web3PageState | null;
    /** `walletState` as it changes, starting from the latest. */
    readonly walletStates: Stream.Stream<Web3PageState | null>;
  }
>()("@t3tools/desktop/preview/DesktopBrowserHost") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const outbox = yield* PubSub.unbounded<DesktopBrowserEventType>();
  const pointers = yield* PubSub.sliding<{
    readonly key: DesktopBrowserTabKey;
    readonly phase: "move" | "click";
    readonly x: number;
    readonly y: number;
  }>(16);
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const tabs = new Map<string, AttachedTab>();
  const emit = (event: DesktopBrowserEventType) => runFork(PubSub.publish(outbox, event));

  const relayFor = (tab: AttachedTab) => {
    if (tab.relay) return tab.relay;
    const { webContents, debugger: debuggee } = tab.debuggee;
    const relay: CdpRelayConnection = createCdpRelayConnection(
      {
        send: (method, params, sessionId) =>
          sessionId === undefined
            ? debuggee.sendCommand(method, params)
            : debuggee.sendCommand(method, params, sessionId),
        targetId: () =>
          debuggee
            .sendCommand("Target.getTargetInfo")
            .then((result: { targetInfo: { targetId: string } }) => result.targetInfo.targetId),
        url: () => webContents.getURL(),
        title: () => webContents.getTitle(),
        userAgent: () => webContents.getUserAgent(),
        setDownloadDirectory: (directory) => {
          tab.downloadDirectory = directory;
        },
      },
      // A released relay's late replies belong to a connection that is gone.
      (message) => {
        if (tab.relay === relay && tabs.get(keyOf(tab.key)) === tab) {
          emit({ type: "cdp", ...tab.key, message });
        }
      },
    );
    tab.relay = relay;
    return relay;
  };

  /**
   * Saves a download from a server tab where the server's Playwright expects
   * it. Without a path Electron would open its Save dialog over the app for a
   * file the agent asked for. CDP names the download just before this runs.
   */
  const placeDownload = (source: Electron.WebContents, item: Electron.DownloadItem) => {
    const tab = [...tabs.values()].find(
      (candidate) => candidate.debuggee.webContents === source && candidate.downloadDirectory,
    );
    if (!tab?.downloadDirectory || !tab.pendingDownloadGuid) return false;
    item.setSavePath(NodePath.join(tab.downloadDirectory, tab.pendingDownloadGuid));
    tab.pendingDownloadGuid = null;
    return true;
  };

  const detach = (key: DesktopBrowserTabKey) => {
    const id = keyOf(key);
    const tab = tabs.get(id);
    if (!tab) return;
    tabs.delete(id);
    tab.debuggee.debugger.off("message", tab.onMessage);
    emit({ type: "detached", ...key });
  };

  const attach = (key: DesktopBrowserTabKey, debuggee: DesktopBrowserTabDebugger) => {
    const id = keyOf(key);
    if (tabs.get(id)?.debuggee.webContents === debuggee.webContents) return;
    detach(key);
    const tab: AttachedTab = {
      key,
      debuggee,
      relay: null,
      downloadDirectory: null,
      pendingDownloadGuid: null,
      onMessage: (_event, method, params, sessionId) => {
        if (method === "Browser.downloadWillBegin") {
          const guid = (params as { guid?: unknown } | undefined)?.guid;
          tab.pendingDownloadGuid = typeof guid === "string" ? guid : null;
        }
        tab.relay?.event(method, params, sessionId);
      },
    };
    tabs.set(id, tab);
    debuggee.debugger.on("message", tab.onMessage);
    emit({ type: "attached", ...key });
  };

  /** Requests the current run is answering, by request id; null between runs. */
  let walletWaiters: Map<string, Deferred.Deferred<Web3GuestReply>> | null = null;
  let walletState: Web3PageState | null = null;
  let lastWalletRequestId = 0;
  const walletStates = yield* PubSub.unbounded<Web3PageState | null>({ replay: 1 });

  const setWalletState = (state: Web3PageState | null) => {
    walletState = state;
    PubSub.publishUnsafe(walletStates, state);
  };

  /**
   * A backend run's share of the wallet. When it ends, the pages still waiting
   * on it get 4900, and every page sees the wallet disconnect until the next
   * run reports its state.
   */
  const walletRun = Effect.acquireRelease(
    Effect.sync(() => {
      const waiters = new Map<string, Deferred.Deferred<Web3GuestReply>>();
      walletWaiters = waiters;
      return waiters;
    }),
    (waiters) =>
      Effect.sync(() => {
        for (const waiter of waiters.values()) {
          Deferred.doneUnsafe(waiter, Effect.succeed(WALLET_NOT_CONNECTED));
        }
        if (walletWaiters !== waiters) return;
        walletWaiters = null;
        setWalletState(null);
      }),
  );

  const walletRequest: DesktopBrowserHost["Service"]["walletRequest"] = (request) =>
    Effect.gen(function* () {
      lastWalletRequestId += 1;
      const requestId = String(lastWalletRequestId);
      const event: DesktopBrowserEventType = { type: "walletRequest", requestId, ...request };
      // Checked here because an event that fails to encode would end the run.
      if (Option.isNone(encodeEventOption(event))) return WALLET_INVALID_REQUEST;
      const reply = yield* Deferred.make<Web3GuestReply>();
      // Joined in one step, so a run cannot end between the check and the join.
      const waiters = walletWaiters;
      if (waiters === null) return WALLET_NOT_CONNECTED;
      waiters.set(requestId, reply);
      yield* PubSub.publish(outbox, event);
      return yield* Deferred.await(reply).pipe(
        Effect.timeoutOrElse({
          duration: WALLET_REPLY_TIMEOUT,
          orElse: () => Effect.succeed(WALLET_NOT_CONNECTED),
        }),
        Effect.ensuring(Effect.sync(() => waiters.delete(requestId))),
      );
    });

  const legacyKeystorePath = environment.path.join(
    environment.previewWalletsDir,
    keystoreFileName("shared"),
  );

  /** The server adopts these keys only while it has no wallet of its own. */
  const legacyKeystoreOffer = readKeystore(legacyKeystorePath).pipe(
    // A wallet that was never switched on has nothing to hand over.
    Effect.map((keystore) =>
      keystore.mnemonic === null && keystore.privateKeys.length === 0 ? null : keystore,
    ),
    Effect.catchTags({
      PreviewWalletKeystoreError: () =>
        Effect.logWarning("left the desktop's unreadable preview wallet in place").pipe(
          Effect.as(null),
        ),
    }),
    Effect.map((keystore): DesktopBrowserEventType => ({ type: "walletKeystoreOffer", keystore })),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
  );

  /** Renamed rather than deleted, and never over an earlier copy. */
  const retireLegacyKeystore = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(legacyKeystorePath))) return;
    let target = `${legacyKeystorePath}.migrated`;
    for (let copy = 1; yield* fileSystem.exists(target); copy += 1) {
      target = `${legacyKeystorePath}.migrated.${copy}`;
    }
    yield* fileSystem.rename(legacyKeystorePath, target);
  }).pipe(
    Effect.catchTags({
      PlatformError: (cause) =>
        Effect.logWarning("could not retire the desktop's old preview wallet", { cause }),
    }),
  );

  const handleCommandLine = (line: string) =>
    Effect.suspend(() => {
      const command = decodeCommand(line);
      if (Option.isNone(command)) return Effect.void;
      const value = command.value;
      // One rename, once: quick enough to finish before the next command.
      if (value.type === "walletKeystoreAccepted") return retireLegacyKeystore;
      return Effect.sync(() => {
        if (value.type === "walletReply") {
          const waiter = walletWaiters?.get(value.requestId);
          if (waiter) Deferred.doneUnsafe(waiter, Effect.succeed(value.reply));
          return;
        }
        if (value.type === "walletState") {
          setWalletState(value.state);
          return;
        }
        const tab = tabs.get(keyOf(value));
        if (!tab) return;
        if (value.type === "pointer") {
          const { threadId, tabId, phase, x, y } = value;
          runFork(PubSub.publish(pointers, { key: { threadId, tabId }, phase, x, y }));
          return;
        }
        if (value.type === "release") {
          // A new server connection starts with a fresh relay and fresh sessions.
          tab.relay = null;
          return;
        }
        relayFor(tab).receive(value.message);
      });
    });

  // Read when a backend starts, not when the host is built.
  const announceAll = Effect.suspend(() =>
    Effect.forEach(
      [...tabs.values()],
      (tab) => {
        tab.relay = null;
        return PubSub.publish(outbox, { type: "attached", ...tab.key });
      },
      { discard: true },
    ),
  );

  return DesktopBrowserHost.of({
    pointers: Stream.fromPubSub(pointers),
    // Subscribes before announcing, so no attach falls between the two.
    events: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(outbox);
        yield* walletRun;
        yield* announceAll;
        // First, because the server waits for it before making a wallet of its own.
        return Stream.concat(
          Stream.fromEffect(legacyKeystoreOffer),
          Stream.fromSubscription(subscription),
        );
      }),
    ).pipe(Stream.map((event) => lineEncoder.encode(`${encodeEvent(event)}\n`))),
    handleCommandLine,
    attach,
    detach,
    placeDownload,
    walletRequest,
    walletState: () => walletState,
    walletStates: Stream.fromPubSub(walletStates),
  });
});

export const layer = Layer.effect(DesktopBrowserHost, make);
