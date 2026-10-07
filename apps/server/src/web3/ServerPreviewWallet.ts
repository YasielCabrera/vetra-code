/**
 * The environment's preview wallet. One signer for every preview tab of this
 * environment: the server's own headless tabs reach it through
 * `ServerBrowserWallet`, and the tabs a desktop app renders for this server
 * through the desktop browser channel. Agents (MCP) and people (WebSocket) see
 * and resolve the same queue.
 *
 * Keys live only here, in the environment's secret store. Settings come from
 * `ServerSettings.web3Wallet`.
 */
import {
  type PreviewWalletPendingRequest,
  type PreviewWalletStatus,
  ThreadId,
} from "@t3tools/contracts";
import {
  PreviewWalletDisabledError,
  PreviewWalletKeystoreError,
  PreviewWalletRequestNotFoundError,
  Web3KeystoreFile,
  type PreviewWalletError,
  type Web3GuestReply,
  type Web3PageState,
  type Web3RejectCode,
  type Web3WalletConfigureInput,
  type Web3WalletResolution,
} from "@t3tools/web3/schema";
import * as Wallet from "@t3tools/web3/wallet";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { isSecretAlreadyExistsError, ServerSecretStore } from "../auth/ServerSecretStore.ts";
import * as DesktopBrowserChannel from "../preview/DesktopBrowserChannel.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as ServerSettings from "../serverSettings.ts";

/** The whole keystore under one secret, so keys, labels, and grants change together. */
const KEYSTORE_SECRET = "preview-wallet-v1";
/** How long a desktop-launched server waits for the desktop's old keys before making new ones. */
const DESKTOP_KEYS_WAIT = "10 seconds";
/** The human view leaves out raw params past this size; the summary already describes them. */
const HUMAN_PARAMS_MAX_BYTES = 8 * 1024;

const KeystoreJson = Schema.fromJsonString(Web3KeystoreFile);
const decodeKeystore = Schema.decodeEffect(KeystoreJson);
const encodeKeystore = Schema.encodeEffect(KeystoreJson);

export interface WalletTabKey {
  readonly threadId: string;
  readonly tabId: string;
}

/** The provider session an agent's preview tabs belong to, as `automationOwner` records it. */
export interface WalletAgent {
  readonly threadId: ThreadId;
  readonly agentSessionId: string;
  /** Narrows to one tab; without it, every tab the session owns in the thread. */
  readonly tabId?: string | undefined;
}

export interface WalletPageRequest {
  readonly documentId: string;
  readonly origin: string;
  readonly method: string;
  readonly params: unknown;
}

const guestIdOf = (key: WalletTabKey) => JSON.stringify([key.threadId, key.tabId]);
const keyOfGuest = (guestId: string): WalletTabKey => {
  const [threadId, tabId] = JSON.parse(guestId) as [string, string];
  return { threadId, tabId };
};

const samePage = (left: Web3PageState, right: Web3PageState) =>
  JSON.stringify(left) === JSON.stringify(right);

const fitsHumanView = (params: unknown) => {
  try {
    return JSON.stringify(params ?? null).length <= HUMAN_PARAMS_MAX_BYTES;
  } catch {
    return false;
  }
};

export class ServerPreviewWallet extends Context.Service<
  ServerPreviewWallet,
  {
    /** Settled once the environment's settings have been applied; pages wait for it. */
    readonly ready: Effect.Effect<void>;
    /** Everything, for people: current state first, then each change. */
    readonly changes: Stream.Stream<PreviewWalletStatus>;
    /** The agent's view: its own tabs' requests only. Fails while the wallet is off. */
    readonly statusFor: (
      agent: WalletAgent,
    ) => Effect.Effect<PreviewWalletStatus, PreviewWalletDisabledError>;
    /** Answers with the agent's view when an agent configures, else the whole status. */
    readonly configure: (
      input: Web3WalletConfigureInput,
      agent?: WalletAgent,
    ) => Effect.Effect<PreviewWalletStatus, PreviewWalletError>;
    /** Without an agent, any request of the environment (a person approving). */
    readonly approve: (
      requestId: string,
      agent?: WalletAgent,
    ) => Effect.Effect<Web3WalletResolution, PreviewWalletError>;
    readonly reject: (
      requestId: string,
      code?: Web3RejectCode,
      agent?: WalletAgent,
    ) => Effect.Effect<Web3WalletResolution, PreviewWalletError>;
    /** What pages may know, current first; repeats are dropped. */
    readonly page: Stream.Stream<Web3PageState>;
    readonly pageState: Effect.Effect<Web3PageState>;
    /** A request from a page in a tab the caller has already authenticated. */
    readonly request: (
      key: WalletTabKey,
      input: WalletPageRequest,
    ) => Effect.Effect<Web3GuestReply>;
    readonly openDocument: (key: WalletTabKey, documentId: string) => Effect.Effect<void>;
    /** An agent is about to act on the tab; marks it before the action runs. */
    readonly noteAgentActivity: (key: WalletTabKey) => Effect.Effect<void>;
    readonly clearAgentActivity: (key: WalletTabKey) => Effect.Effect<void>;
  }
>()("t3/web3/ServerPreviewWallet") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore;
  const settings = yield* ServerSettings.ServerSettingsService;
  const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
  const manager = yield* PreviewManager.PreviewManager;

  /** Open once the desktop has said whether it has keys from before; at once without one. */
  const desktopKeysSettled = yield* Deferred.make<void>();
  if (!channel.available) yield* Deferred.succeed(desktopKeysSettled, undefined);
  else
    yield* Deferred.succeed(desktopKeysSettled, undefined).pipe(
      Effect.delay(DESKTOP_KEYS_WAIT),
      Effect.forkScoped,
    );

  const storeLock = yield* Semaphore.make(1);
  const readFailure = new PreviewWalletKeystoreError({
    operation: "read",
    detail: "The stored preview wallet could not be read.",
  });
  const writeFailure = new PreviewWalletKeystoreError({
    operation: "write",
    detail: "The preview wallet could not be saved to the secret store.",
  });
  const read = secrets.get(KEYSTORE_SECRET).pipe(
    Effect.tapError((cause) => Effect.logWarning("could not read the preview wallet", { cause })),
    Effect.mapError(() => readFailure),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<Web3KeystoreFile>()),
        onSome: (bytes) =>
          decodeKeystore(new TextDecoder().decode(bytes)).pipe(
            Effect.asSome,
            Effect.mapError(() => readFailure),
          ),
      }),
    ),
  );
  const bytesOf = (keystore: Web3KeystoreFile) =>
    encodeKeystore(keystore).pipe(
      Effect.map((json) => new TextEncoder().encode(json)),
      Effect.mapError(() => writeFailure),
    );
  /** Creates the secret only if it is still absent; false when one already exists. */
  const createIfAbsent = (keystore: Web3KeystoreFile) =>
    bytesOf(keystore).pipe(
      Effect.flatMap((bytes) =>
        secrets.create(KEYSTORE_SECRET, bytes).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            isSecretAlreadyExistsError(error)
              ? Effect.succeed(false)
              : Effect.logWarning("could not create the preview wallet", { cause: error }).pipe(
                  Effect.andThen(Effect.fail(writeFailure)),
                ),
          ),
        ),
      ),
    );

  const store = Wallet.WalletStore.of({
    loadOrCreate: (create) =>
      Effect.gen(function* () {
        const existing = yield* storeLock.withPermits(1)(read);
        if (Option.isSome(existing)) return existing.value;
        // A desktop that signed before this server did hands its keys over first.
        yield* Deferred.await(desktopKeysSettled);
        return yield* storeLock.withPermits(1)(
          Effect.gen(function* () {
            const adopted = yield* read;
            if (Option.isSome(adopted)) return adopted.value;
            const created = yield* create;
            if (yield* createIfAbsent(created)) return created;
            return Option.getOrThrow(yield* read);
          }),
        );
      }),
    save: (keystore) =>
      bytesOf(keystore).pipe(
        Effect.flatMap((bytes) =>
          secrets.set(KEYSTORE_SECRET, bytes).pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("could not save the preview wallet", { cause }),
            ),
            Effect.mapError(() => writeFailure),
          ),
        ),
        storeLock.withPermits(1),
      ),
  });

  const engine = yield* Wallet.make.pipe(Effect.provideService(Wallet.WalletStore, store));

  // Subscribed before the snapshot, so no change lands between the two.
  const ready = yield* Deferred.make<void>();
  const settingsChanges = yield* settings.subscribeChanges;
  const initial = yield* settings.getSettings.pipe(
    Effect.map((current) => current.web3Wallet),
    Effect.catchCause((cause) =>
      Effect.logWarning("could not read wallet settings; the preview wallet stays off", {
        cause,
      }).pipe(Effect.as(undefined)),
    ),
  );
  yield* Effect.gen(function* () {
    if (initial !== undefined) yield* engine.applySettings(initial);
    yield* Deferred.succeed(ready, undefined);
    yield* settingsChanges.pipe(
      Stream.runForEach((current) => engine.applySettings(current.web3Wallet)),
    );
  }).pipe(Effect.forkScoped);

  const toPending = (entry: Wallet.WalletPendingEntry): PreviewWalletPendingRequest => {
    const key = keyOfGuest(entry.guestId);
    return { ...entry.request, threadId: ThreadId.make(key.threadId), tabId: key.tabId };
  };

  const humanStatus = (view: Wallet.WalletView): PreviewWalletStatus => ({
    ...view.status,
    pendingRequests: view.pending.map((entry) => {
      const pending = toPending(entry);
      return fitsHumanView(pending.params) ? pending : { ...pending, params: null };
    }),
  });

  /** Tabs the agent's provider session owns in its thread, from the preview sessions. */
  const ownedTabs = (agent: WalletAgent) =>
    manager
      .list({ threadId: agent.threadId })
      .pipe(
        Effect.map(
          ({ sessions }) =>
            new Set(
              sessions
                .filter(
                  (session) =>
                    session.automationOwner === agent.agentSessionId &&
                    (agent.tabId === undefined || session.tabId === agent.tabId),
                )
                .map((session) => session.tabId),
            ),
        ),
      );

  const agentPending = (agent: WalletAgent, view: Wallet.WalletView) =>
    Effect.map(ownedTabs(agent), (owned) =>
      view.pending
        .map(toPending)
        .filter((pending) => pending.threadId === agent.threadId && owned.has(pending.tabId)),
    );

  const requireEnabled = engine.view.pipe(
    Effect.filterOrFail(
      (view) => view.status.enabled,
      () => new PreviewWalletDisabledError(),
    ),
  );

  const statusFor = (agent: WalletAgent) =>
    Effect.gen(function* () {
      const view = yield* requireEnabled;
      return { ...view.status, pendingRequests: yield* agentPending(agent, view) };
    });

  /** An agent may resolve only requests from its own tabs; others look absent. */
  const requireOwned = (requestId: string, agent: WalletAgent | undefined) =>
    agent === undefined
      ? Effect.void
      : Effect.gen(function* () {
          const view = yield* requireEnabled;
          const owned = yield* agentPending(agent, view);
          if (!owned.some((pending) => pending.requestId === requestId)) {
            return yield* new PreviewWalletRequestNotFoundError({ requestId });
          }
        });

  const pageState = engine.view.pipe(Effect.map((view) => view.page));

  // A closed preview session ends its tab for the wallet too. A desktop tab
  // whose page the desktop only took back, say for DevTools, keeps its prompts.
  yield* manager.events.pipe(
    Stream.runForEach((event) =>
      event.type === "closed" ? engine.forgetGuest(guestIdOf(event)) : Effect.void,
    ),
    Effect.forkScoped,
  );

  const request = (key: WalletTabKey, input: WalletPageRequest) =>
    engine.request({
      guestId: guestIdOf(key),
      documentId: input.documentId,
      origin: input.origin,
      method: input.method,
      params: input.params,
    });

  // The desktop's pages: forwarded requests, the state its preload answers
  // from, and once per run the keys it signed with before this server did.
  if (channel.available) {
    const isServerTab = (key: WalletTabKey) =>
      manager
        .list({ threadId: ThreadId.make(key.threadId) })
        .pipe(
          Effect.map(({ sessions }) =>
            sessions.some((session) => session.tabId === key.tabId && session.runtime === "server"),
          ),
        );
    const answer = (
      event: Extract<DesktopBrowserChannel.DesktopWalletEvent, { type: "walletRequest" }>,
    ) =>
      Effect.gen(function* () {
        const key = { threadId: event.threadId, tabId: event.tabId };
        const reply: Web3GuestReply = (yield* isServerTab(key))
          ? yield* request(key, event)
          : {
              ok: false,
              code: 4100,
              message: "This page is not a preview tab of this environment.",
            };
        yield* channel.walletCommand({ type: "walletReply", requestId: event.requestId, reply });
      });
    const adopt = (keystore: Web3KeystoreFile | null) =>
      Effect.gen(function* () {
        if (keystore !== null) {
          const adopted = yield* storeLock.withPermits(1)(
            read.pipe(
              Effect.flatMap((existing) =>
                Option.isSome(existing) ? Effect.succeed(false) : createIfAbsent(keystore),
              ),
            ),
          );
          if (adopted) {
            yield* Effect.logInfo("adopted the desktop's preview wallet");
            yield* channel.walletCommand({ type: "walletKeystoreAccepted" });
          }
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("could not adopt the desktop's preview wallet", { cause }),
        ),
        Effect.ensuring(Deferred.succeed(desktopKeysSettled, undefined)),
      );
    yield* channel.walletEvents.pipe(
      Stream.runForEach((event) =>
        event.type === "walletRequest"
          ? Effect.forkScoped(answer(event)).pipe(Effect.asVoid)
          : adopt(event.keystore),
      ),
      Effect.forkScoped,
    );
    yield* engine.changes.pipe(
      Stream.map((view) => view.page),
      Stream.changesWith(samePage),
      Stream.runForEach((state) => channel.walletCommand({ type: "walletState", state })),
      Effect.forkScoped,
    );
  }

  return ServerPreviewWallet.of({
    ready: Deferred.await(ready),
    changes: engine.changes.pipe(Stream.map(humanStatus)),
    statusFor,
    configure: (input, agent) =>
      engine
        .configure(input)
        .pipe(
          Effect.andThen(
            agent === undefined ? engine.view.pipe(Effect.map(humanStatus)) : statusFor(agent),
          ),
        ),
    approve: (requestId, agent) =>
      requireOwned(requestId, agent).pipe(Effect.andThen(engine.approve(requestId))),
    reject: (requestId, code, agent) =>
      requireOwned(requestId, agent).pipe(Effect.andThen(engine.reject(requestId, code))),
    page: engine.changes.pipe(
      Stream.map((view) => view.page),
      Stream.changesWith(samePage),
    ),
    pageState,
    request,
    openDocument: (key, documentId) => engine.openDocument(guestIdOf(key), documentId),
    noteAgentActivity: (key) => engine.noteAgentActivity(guestIdOf(key)),
    clearAgentActivity: (key) => engine.clearAgentActivity(guestIdOf(key)),
  });
});

export const layer = Layer.effect(ServerPreviewWallet, make);
