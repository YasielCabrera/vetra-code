/**
 * The preview wallet: one signer, its approval policy, and the queue of
 * requests waiting for a person or an agent.
 *
 * Transport-free. A host hands it requests from pages it has already
 * authenticated, as an opaque `guestId` (one per browser tab) with the origin
 * the browser reported, and reads `changes` to keep pages and approval UIs
 * current. Keys stay in here and in the `WalletStore` the host provides.
 *
 * @module Web3Wallet
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpClient } from "effect/http";

import {
  DEFAULT_LOCAL_RPC_URL,
  describeChain,
  describeCustomNetwork,
  getDefaultChain,
  parseAddEthereumChain,
  probeChainId,
  resolveInitialChain,
  web3RpcRequest,
} from "./chain.ts";
import { EMPTY_KEYSTORE } from "./keystore.ts";
import { findCustomNetwork, isBuiltInNetworkEnabled } from "./networks.ts";
import {
  chainIdToHex,
  classifyWeb3Method,
  parseChainId,
  summarizeWeb3Request,
  web3MethodNeedsAccountGrant,
  web3MethodRequiresApproval,
  type Web3MethodKind,
} from "./rpc.ts";
import {
  DEFAULT_WEB3_REJECT_CODE,
  PreviewWalletDisabledError,
  PreviewWalletKeystoreError,
  PreviewWalletNoAccountError,
  PreviewWalletNoChainError,
  PreviewWalletRequestNotFoundError,
  WEB3_GUEST_PARAMS_MAX_BYTES,
  WEB3_PENDING_MAX,
  WEB3_PENDING_PER_GUEST,
  WEB3_REJECT_MESSAGES,
  Web3WalletSettings,
  type PreviewWalletError,
  type Web3Chain,
  type Web3GuestReply,
  type Web3KeystoreFile,
  type Web3PageState,
  type Web3PendingRequest,
  type Web3RejectCode,
  type Web3RpcUrl,
  type Web3WalletConfigureInput,
  type Web3WalletResolution,
  type Web3WalletStatus,
} from "./schema.ts";
import {
  deriveMnemonicAccounts,
  dropAccountFromKeystore,
  generateWalletMnemonic,
  nextMnemonicDerivationIndex,
  resolveSigner,
  sendTransaction,
  signPersonalMessage,
  signTypedData,
} from "./signer.ts";

/**
 * How long after an agent action a request still counts as agent-driven. An
 * agent clicks, the dapp builds a transaction, and the request can land seconds
 * later; the window still closes long before a person sits down at the tab.
 */
const AGENT_ACTIVITY_GRACE_MS = 30_000;

/** How long a parked request waits before the page gets an answer. */
const PENDING_REQUEST_TIMEOUT = "5 minutes";

/** Accounts derived when the wallet first generates a mnemonic. */
const INITIAL_ACCOUNT_COUNT = 3;

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0.0.0.0",
]);

/** Off until the host applies the environment's settings. */
const DEFAULT_SETTINGS = Schema.decodeSync(Web3WalletSettings)({});

/** Where a host keeps the wallet's keys. */
export class WalletStore extends Context.Service<
  WalletStore,
  {
    /**
     * The stored keystore, or the one `create` makes and stores when there is
     * none yet. A stored value that cannot be read fails; it is never replaced.
     */
    readonly loadOrCreate: <E>(
      create: Effect.Effect<Web3KeystoreFile, E>,
    ) => Effect.Effect<Web3KeystoreFile, E | PreviewWalletKeystoreError>;
    readonly save: (keystore: Web3KeystoreFile) => Effect.Effect<void, PreviewWalletKeystoreError>;
  }
>()("@t3tools/web3/wallet/WalletStore") {}

/** One page request, with identity the host took from the browser, not from the page. */
export interface WalletGuestRequest {
  /** The tab the page runs in. Agent activity and request ownership key off it. */
  readonly guestId: string;
  /** Changes with each document in the tab, so a reload drops its old prompts. */
  readonly documentId: string;
  readonly origin: string;
  readonly method: string;
  readonly params: unknown;
}

export interface WalletPendingEntry {
  readonly request: Web3PendingRequest;
  readonly guestId: string;
}

/** Everything the wallet publishes. Keys never appear here. */
export interface WalletView {
  readonly status: Web3WalletStatus;
  readonly pending: ReadonlyArray<WalletPendingEntry>;
  readonly page: Web3PageState;
}

type PendingOutcome =
  | { readonly _tag: "approved"; readonly result: unknown }
  | { readonly _tag: "rejected"; readonly code: Web3RejectCode }
  | { readonly _tag: "failed"; readonly code: number; readonly message: string };

interface PendingEntry {
  readonly request: Web3PendingRequest;
  readonly kind: Web3MethodKind;
  readonly guestId: string;
  readonly documentId: string;
  readonly grantOriginOnApproval: boolean;
  readonly outcome: Deferred.Deferred<PendingOutcome>;
}

interface WalletState {
  /** As stored in settings. */
  readonly persisted: Web3WalletSettings;
  /** Settings plus test overrides from `configure`, which last until settings change. */
  readonly settings: Web3WalletSettings;
  readonly keystore: Web3KeystoreFile;
  /** Unloaded until first enabled; failed means the stored keystore could not be read. */
  readonly keystoreStatus: "unloaded" | "ready" | "failed";
  readonly chain: Web3Chain | null;
  readonly rpcReachable: boolean;
  readonly pending: ReadonlyMap<string, PendingEntry>;
  /** Each guest's current document; requests from an earlier one are dropped. */
  readonly documents: ReadonlyMap<string, string>;
}

export class PreviewWalletEngine extends Context.Service<
  PreviewWalletEngine,
  {
    readonly view: Effect.Effect<WalletView>;
    /** The current view, then every later one. */
    readonly changes: Stream.Stream<WalletView>;
    /** Applies the environment's stored settings. Disabling answers every parked request. */
    readonly applySettings: (settings: Web3WalletSettings) => Effect.Effect<void>;
    readonly configure: (
      input: Web3WalletConfigureInput,
    ) => Effect.Effect<Web3WalletStatus, PreviewWalletError>;
    /** Claims the request first, so two approvers can never both sign it. */
    readonly approve: (
      requestId: string,
    ) => Effect.Effect<Web3WalletResolution, PreviewWalletError>;
    readonly reject: (
      requestId: string,
      code?: Web3RejectCode,
    ) => Effect.Effect<Web3WalletResolution, PreviewWalletError>;
    /** Runs one page request through the gate, grants, and signer. */
    readonly request: (input: WalletGuestRequest) => Effect.Effect<Web3GuestReply>;
    /** A guest loaded a new document; its earlier document's prompts are answered and dropped. */
    readonly openDocument: (guestId: string, documentId: string) => Effect.Effect<void>;
    /** An agent acted on the guest's tab. This is the signal behind `auto-for-agents`. */
    readonly noteAgentActivity: (guestId: string) => Effect.Effect<void>;
    /** A person took the tab, so an agent's earlier action no longer approves anything. */
    readonly clearAgentActivity: (guestId: string) => Effect.Effect<void>;
    /** The guest's tab closed. */
    readonly forgetGuest: (guestId: string) => Effect.Effect<void>;
  }
>()("@t3tools/web3/wallet/PreviewWalletEngine") {}

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
};

const isWebOrigin = (origin: string): boolean => /^https?:\/\/[^/]+$/i.test(origin);

const providerError = (code: number, message: string) => {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
};

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 4000);

/** Keeps the EIP-1193 code a failure carried, falling back to -32603. */
const replyFromCause = (cause: Cause.Cause<unknown>): Web3GuestReply => {
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return {
      ok: false,
      code: typeof code === "number" && Number.isInteger(code) ? code : -32603,
      message: messageOf(error),
    };
  }
  return { ok: false, code: -32603, message: "The preview wallet request failed." };
};

const sameSettings = (left: Web3WalletSettings, right: Web3WalletSettings): boolean =>
  left.enabled === right.enabled &&
  left.approvalMode === right.approvalMode &&
  left.chainId === right.chainId &&
  left.rpcUrl === right.rpcUrl &&
  left.autoConnectLoopback === right.autoConnectLoopback &&
  left.disabledBuiltInChainIds.length === right.disabledBuiltInChainIds.length &&
  left.disabledBuiltInChainIds.every((id, index) => id === right.disabledBuiltInChainIds[index]) &&
  sameCustomNetworks(left.customNetworks, right.customNetworks);

const sameCustomNetworks = (
  left: Web3WalletSettings["customNetworks"],
  right: Web3WalletSettings["customNetworks"],
): boolean =>
  left.length === right.length &&
  left.every((network, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      other.chainId === network.chainId &&
      other.rpcUrl === network.rpcUrl &&
      other.name === network.name
    );
  });

const catalogLostActiveChain = (current: WalletState, settings: Web3WalletSettings): boolean => {
  const chainId = current.chain?.chainId;
  if (chainId === undefined) return false;
  const lostCustom =
    findCustomNetwork(current.settings.customNetworks, chainId) !== null &&
    findCustomNetwork(settings.customNetworks, chainId) === null;
  const lostBuiltIn =
    isBuiltInNetworkEnabled(chainId, current.settings.disabledBuiltInChainIds) &&
    !isBuiltInNetworkEnabled(chainId, settings.disabledBuiltInChainIds);
  return lostCustom || lostBuiltIn;
};

const originGranted = (keystore: Web3KeystoreFile, origin: string): boolean =>
  keystore.connectedOrigins.includes(origin);

/** Every address, the active one first: what `eth_accounts` returns to a granted origin. */
const accountList = (keystore: Web3KeystoreFile): ReadonlyArray<string> => {
  if (keystore.selectedAddress === null) return keystore.accounts.map((a) => a.address);
  return [
    keystore.selectedAddress,
    ...keystore.accounts
      .map((account) => account.address)
      .filter((address) => address !== keystore.selectedAddress),
  ];
};

/**
 * A page's params in their JSON form, as JSON-RPC carries them and MCP shows
 * them; missing params are an empty list. None when they are too large or have
 * no JSON form.
 */
const jsonParams = (params: unknown): Option.Option<unknown> => {
  try {
    const encoded = JSON.stringify(params ?? []);
    return new TextEncoder().encode(encoded).length > WEB3_GUEST_PARAMS_MAX_BYTES
      ? Option.none()
      : Option.some(JSON.parse(encoded));
  } catch {
    return Option.none();
  }
};

export const make = Effect.gen(function* () {
  const store = yield* WalletStore;
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const uuid = yield* crypto.randomUUIDv4;

  const stateRef = yield* SynchronizedRef.make<WalletState>({
    persisted: DEFAULT_SETTINGS,
    settings: DEFAULT_SETTINGS,
    keystore: EMPTY_KEYSTORE,
    keystoreStatus: "unloaded",
    chain: null,
    rpcReachable: false,
    pending: new Map(),
    documents: new Map(),
  });
  const agentActivity = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
  /** Serializes settings, keystore, and grant changes; parked requests never wait on it. */
  const mutation = yield* Semaphore.make(1);
  const serialized = mutation.withPermits(1);

  const toView = (state: WalletState): WalletView => {
    const entries = [...state.pending.values()];
    const enabled = state.settings.enabled;
    return {
      status: {
        enabled,
        accounts: state.keystore.accounts,
        selectedAddress: state.keystore.selectedAddress,
        chain: state.chain,
        rpcReachable: state.rpcReachable,
        approvalMode: state.settings.approvalMode,
        pendingRequests: entries.map((entry) => entry.request),
        connectedOrigins: state.keystore.connectedOrigins,
      },
      pending: entries.map((entry) => ({ request: entry.request, guestId: entry.guestId })),
      page: {
        enabled,
        uuid,
        chainId: enabled && state.chain !== null ? chainIdToHex(state.chain.chainId) : null,
        accounts: enabled ? accountList(state.keystore) : [],
        connectedOrigins: enabled ? state.keystore.connectedOrigins : [],
      },
    };
  };

  const initialState = yield* SynchronizedRef.get(stateRef);
  const viewRef = yield* SubscriptionRef.make(toView(initialState));
  const publishedState = yield* Ref.make(initialState);
  /** Publishes the latest state, in order, and only when something visible changed. */
  const publish = SubscriptionRef.updateSomeEffect(viewRef, () =>
    Effect.gen(function* () {
      const state = yield* SynchronizedRef.get(stateRef);
      const last = yield* Ref.getAndSet(publishedState, state);
      const unchanged =
        last.settings === state.settings &&
        last.keystore === state.keystore &&
        last.chain === state.chain &&
        last.rpcReachable === state.rpcReachable &&
        last.pending === state.pending;
      return unchanged ? Option.none() : Option.some(toView(state));
    }),
  );

  const withHttp = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    Effect.provideService(effect, HttpClient.HttpClient, httpClient);

  const requireKeystore = (state: WalletState) =>
    state.keystoreStatus === "ready"
      ? Effect.void
      : Effect.fail(
          new PreviewWalletKeystoreError({
            operation: "read",
            detail: "The stored preview wallet could not be read, so it is left untouched.",
          }),
        );

  const persist = (keystore: Web3KeystoreFile) =>
    store
      .save(keystore)
      .pipe(Effect.andThen(SynchronizedRef.update(stateRef, (state) => ({ ...state, keystore }))));

  /** First enable generates the mnemonic; it is never regenerated, so funded test state survives. */
  const generateInto = (base: Web3KeystoreFile) =>
    Effect.gen(function* () {
      const mnemonic = generateWalletMnemonic();
      const accounts = yield* deriveMnemonicAccounts(mnemonic, INITIAL_ACCOUNT_COUNT);
      yield* Effect.logInfo("generated a preview wallet test mnemonic", {
        accountCount: accounts.length,
      });
      return {
        ...base,
        mnemonic,
        accounts,
        selectedAddress: accounts[0]?.address ?? null,
      } satisfies Web3KeystoreFile;
    });

  const loadKeystore = store.loadOrCreate(generateInto(EMPTY_KEYSTORE)).pipe(
    Effect.filterOrElse(
      (loaded) => loaded.mnemonic !== null || loaded.accounts.length > 0,
      (empty) => generateInto(empty).pipe(Effect.tap(store.save)),
    ),
    Effect.map((keystore) => ({ keystore, status: "ready" as const })),
    Effect.catchCause((cause) =>
      Effect.logWarning("could not load the preview wallet keystore", cause).pipe(
        Effect.as({ keystore: EMPTY_KEYSTORE, status: "failed" as const }),
      ),
    ),
  );

  const resolveChain = (settings: Web3WalletSettings) =>
    Effect.gen(function* () {
      const chain = yield* withHttp(
        resolveInitialChain({
          settingsChainId: settings.chainId,
          settingsRpcUrl: settings.rpcUrl,
          disabledBuiltInChainIds: settings.disabledBuiltInChainIds,
          customNetworks: settings.customNetworks,
        }),
      );
      if (chain === null) return { chain: null, rpcReachable: false } as const;
      const reachable =
        chain.rpcUrl !== null && (yield* withHttp(probeChainId(chain.rpcUrl))) === chain.chainId;
      return { chain, rpcReachable: reachable } as const;
    });

  /** Answers parked requests that match, outside any lock, and forgets them. */
  const settlePending = (
    matches: (entry: PendingEntry) => boolean,
    outcome: PendingOutcome,
  ): Effect.Effect<void> =>
    SynchronizedRef.modify(stateRef, (state) => {
      const settled = [...state.pending.values()].filter(matches);
      if (settled.length === 0) return [settled, state];
      const pending = new Map(state.pending);
      for (const entry of settled) pending.delete(entry.request.requestId);
      return [settled, { ...state, pending }];
    }).pipe(
      Effect.flatMap((settled) =>
        settled.length === 0
          ? Effect.void
          : Effect.forEach(settled, (entry) => Deferred.succeed(entry.outcome, outcome), {
              discard: true,
            }).pipe(Effect.andThen(publish)),
      ),
    );

  const DISCONNECTED: PendingOutcome = { _tag: "rejected", code: 4900 };

  const applySettings = (persisted: Web3WalletSettings) =>
    serialized(
      Effect.gen(function* () {
        const current = yield* SynchronizedRef.get(stateRef);
        if (
          sameSettings(current.persisted, persisted) &&
          (current.keystoreStatus !== "unloaded" || !persisted.enabled)
        ) {
          return;
        }
        // A settings change ends any test override, so what Settings shows is what signs.
        const settings = persisted;
        const keystore =
          settings.enabled && current.keystoreStatus !== "ready"
            ? yield* loadKeystore
            : { keystore: current.keystore, status: current.keystoreStatus };

        const chainTargetChanged =
          current.settings.chainId !== settings.chainId ||
          current.settings.rpcUrl !== settings.rpcUrl ||
          current.chain === null ||
          catalogLostActiveChain(current, settings) ||
          !sameCustomNetworks(current.settings.customNetworks, settings.customNetworks);
        const resolved =
          settings.enabled && chainTargetChanged
            ? yield* resolveChain(settings)
            : { chain: current.chain, rpcReachable: current.rpcReachable };

        yield* SynchronizedRef.update(stateRef, (state) => ({
          ...state,
          persisted,
          settings,
          keystore: keystore.keystore,
          keystoreStatus: keystore.status,
          chain: resolved.chain,
          rpcReachable: resolved.rpcReachable,
        }));
        if (!settings.enabled) yield* settlePending(() => true, DISCONNECTED);
        yield* publish;
      }),
    );

  const noteAgentActivity = (guestId: string) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Ref.update(agentActivity, (activity) => new Map(activity).set(guestId, now)),
      ),
    );

  const clearAgentActivity = (guestId: string) =>
    Ref.update(agentActivity, (activity) => {
      if (!activity.has(guestId)) return activity;
      const next = new Map(activity);
      next.delete(guestId);
      return next;
    });

  const isAgentDriven = (guestId: string) =>
    Effect.gen(function* () {
      const last = (yield* Ref.get(agentActivity)).get(guestId);
      if (last === undefined) return false;
      return (yield* Clock.currentTimeMillis) - last <= AGENT_ACTIVITY_GRACE_MS;
    });

  /**
   * `always-auto` still parks the first request from a non-loopback origin:
   * removing friction from local development must not hand a signing oracle to
   * any page that loads in the preview. A granted origin is trusted thereafter.
   */
  const shouldAutoApprove = (input: {
    readonly state: WalletState;
    readonly kind: Web3MethodKind;
    readonly origin: string;
    readonly guestId: string;
  }) => {
    const { state, kind, origin } = input;
    const loopback = isLoopbackOrigin(origin);
    const granted = originGranted(state.keystore, origin);
    if (kind === "connect" && granted) return Effect.succeed(true);
    if (kind === "connect" && loopback && state.settings.autoConnectLoopback) {
      return Effect.succeed(true);
    }
    switch (state.settings.approvalMode) {
      case "always-ask":
        return Effect.succeed(false);
      case "always-auto":
        return Effect.succeed(granted || loopback);
      case "auto-for-agents":
        return isAgentDriven(input.guestId);
    }
  };

  const updateKeystore = (update: (keystore: Web3KeystoreFile) => Web3KeystoreFile) =>
    serialized(
      Effect.gen(function* () {
        const state = yield* SynchronizedRef.get(stateRef);
        yield* requireKeystore(state);
        const keystore = update(state.keystore);
        if (keystore !== state.keystore) yield* persist(keystore);
        yield* publish;
      }),
    );

  const grantOrigin = (origin: string) =>
    updateKeystore((keystore) =>
      originGranted(keystore, origin)
        ? keystore
        : { ...keystore, connectedOrigins: [...keystore.connectedOrigins, origin] },
    );

  const requireChain = (state: WalletState) =>
    state.chain === null || state.chain.rpcUrl === null
      ? Effect.fail(new PreviewWalletNoChainError())
      : Effect.succeed({ chainId: state.chain.chainId, rpcUrl: state.chain.rpcUrl });

  const setChain = (chain: Web3Chain, alreadyVerified: boolean) =>
    Effect.gen(function* () {
      const reachable =
        chain.rpcUrl !== null &&
        (alreadyVerified || (yield* withHttp(probeChainId(chain.rpcUrl))) === chain.chainId);
      yield* SynchronizedRef.update(stateRef, (state) => ({
        ...state,
        chain,
        rpcReachable: reachable,
      }));
      yield* publish;
    });

  const switchChain = (state: WalletState, params: unknown) =>
    Effect.gen(function* () {
      const chainId = parseChainId(
        (Array.isArray(params) ? (params[0] as { chainId?: unknown } | undefined) : undefined)
          ?.chainId,
      );
      if (chainId === null) {
        return yield* Effect.fail(providerError(4902, "Unrecognised chain id."));
      }
      if (state.chain?.chainId === chainId) return null;
      const custom = findCustomNetwork(state.settings.customNetworks, chainId);
      // Keep the current endpoint only when it actually serves the target
      // chain; otherwise the wallet would claim a chain it cannot read.
      const reuseRpc =
        state.chain !== null &&
        state.chain.rpcUrl !== null &&
        (yield* withHttp(probeChainId(state.chain.rpcUrl))) === chainId
          ? state.chain.rpcUrl
          : null;
      const customRpcUrl = custom?.rpcUrl ?? null;
      const customChainId =
        reuseRpc === null && customRpcUrl !== null
          ? yield* withHttp(probeChainId(customRpcUrl))
          : null;
      const localChainId =
        reuseRpc === null && customChainId !== chainId
          ? yield* withHttp(probeChainId(DEFAULT_LOCAL_RPC_URL))
          : null;
      const defaultChain = isBuiltInNetworkEnabled(chainId, state.settings.disabledBuiltInChainIds)
        ? getDefaultChain(chainId)
        : null;
      const defaultRpcUrl = defaultChain?.rpcUrl ?? null;
      const defaultChainId =
        reuseRpc === null &&
        customChainId !== chainId &&
        localChainId !== chainId &&
        defaultRpcUrl !== null
          ? yield* withHttp(probeChainId(defaultRpcUrl))
          : null;
      const rpcUrl =
        reuseRpc ??
        (customChainId === chainId ? customRpcUrl : null) ??
        (localChainId === chainId ? (DEFAULT_LOCAL_RPC_URL as Web3RpcUrl) : null) ??
        (defaultChainId === chainId ? defaultRpcUrl : null);
      if (rpcUrl === null) {
        return yield* Effect.fail(
          providerError(
            4902,
            `No working JSON-RPC endpoint is known for chain ${chainId}. Add a custom network in Settings > Web3 or call wallet_addEthereumChain.`,
          ),
        );
      }
      yield* setChain(
        custom !== null && rpcUrl === custom.rpcUrl
          ? describeCustomNetwork(custom)
          : describeChain(chainId, rpcUrl),
        true,
      );
      return null;
    });

  /** Runs a request that has cleared the approval gate. */
  const execute = (input: {
    readonly method: string;
    readonly params: unknown;
    readonly origin: string;
    readonly kind: Web3MethodKind;
  }) =>
    Effect.gen(function* () {
      const { method, params, origin, kind } = input;
      const state = yield* SynchronizedRef.get(stateRef);

      if (kind === "connect") {
        if (state.keystore.accounts.length === 0) return yield* new PreviewWalletNoAccountError();
        yield* grantOrigin(origin);
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        return accountList((yield* SynchronizedRef.get(stateRef)).keystore);
      }

      if (kind === "chain") {
        if (method === "wallet_addEthereumChain") {
          const chain = parseAddEthereumChain(params);
          if (chain === null) {
            return yield* Effect.fail(
              providerError(4902, "Could not understand the requested chain."),
            );
          }
          yield* setChain(chain, false);
          return null;
        }
        return yield* switchChain(state, params);
      }

      // Nothing to track: the preview wallet has no token list. Success keeps
      // dapp onboarding flows moving.
      if (kind === "asset") return true;

      const addressParam = Array.isArray(params)
        ? method === "personal_sign"
          ? params[1]
          : params[0]
        : undefined;
      const requestedAddress =
        typeof addressParam === "string" && /^0x[0-9a-fA-F]{40}$/.test(addressParam)
          ? addressParam
          : state.keystore.selectedAddress;
      if (requestedAddress === null) return yield* new PreviewWalletNoAccountError();

      switch (method) {
        case "personal_sign":
        case "eth_sign": {
          const account = yield* resolveSigner(state.keystore, requestedAddress);
          const message = Array.isArray(params) ? params[method === "personal_sign" ? 0 : 1] : "";
          return yield* signPersonalMessage({ account, message: String(message ?? "") });
        }
        case "eth_signTypedData":
        case "eth_signTypedData_v1":
        case "eth_signTypedData_v3":
        case "eth_signTypedData_v4": {
          const account = yield* resolveSigner(state.keystore, requestedAddress);
          const typedData = Array.isArray(params) ? (params[1] ?? params[0]) : params;
          return yield* signTypedData({ account, typedData });
        }
        case "eth_sendTransaction": {
          const { chainId, rpcUrl } = yield* requireChain(state);
          const request = (Array.isArray(params) ? params[0] : params) as Record<string, unknown>;
          const from = typeof request?.from === "string" ? request.from : requestedAddress;
          const account = yield* resolveSigner(state.keystore, from);
          return yield* withHttp(
            sendTransaction({ account, chainId, rpcUrl, request: request ?? {} }),
          );
        }
        default:
          return yield* Effect.fail(
            providerError(-32601, `The preview wallet does not implement ${method}.`),
          );
      }
    });

  const answerLocally = (method: string, origin: string) =>
    Effect.gen(function* () {
      const state = yield* SynchronizedRef.get(stateRef);
      const granted = originGranted(state.keystore, origin);
      switch (method) {
        case "eth_accounts":
          // An empty list, not an error: MetaMask's answer, and what dapp
          // "not connected" branches expect.
          return granted ? accountList(state.keystore) : [];
        case "eth_coinbase":
          return granted ? (accountList(state.keystore)[0] ?? null) : null;
        case "eth_chainId":
          return state.chain === null ? null : chainIdToHex(state.chain.chainId);
        case "net_version":
          return state.chain === null ? null : String(state.chain.chainId);
        case "wallet_getPermissions":
          return granted ? [{ parentCapability: "eth_accounts" }] : [];
        case "wallet_revokePermissions":
          yield* updateKeystore((keystore) =>
            originGranted(keystore, origin)
              ? {
                  ...keystore,
                  connectedOrigins: keystore.connectedOrigins.filter((entry) => entry !== origin),
                }
              : keystore,
          );
          return null;
        case "web3_clientVersion":
          return "VetraPreviewWallet/1.0.0";
        default:
          return null;
      }
    });

  /** Takes a parked request out of the queue; only the caller that gets it may settle it. */
  const claim = (requestId: string) =>
    SynchronizedRef.modify(stateRef, (state): [Option.Option<PendingEntry>, WalletState] => {
      const entry = state.pending.get(requestId);
      if (entry === undefined) return [Option.none(), state];
      const pending = new Map(state.pending);
      pending.delete(requestId);
      return [Option.some(entry), { ...state, pending }];
    }).pipe(Effect.tap((claimed) => (Option.isSome(claimed) ? publish : Effect.void)));

  const park = (input: {
    readonly guest: WalletGuestRequest;
    readonly kind: Web3MethodKind;
    readonly grantOriginOnApproval: boolean;
  }) =>
    Effect.gen(function* () {
      const { guest } = input;
      const requestId = yield* crypto.randomUUIDv4;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const outcome = yield* Deferred.make<PendingOutcome>();
      const entry: PendingEntry = {
        request: {
          requestId,
          origin: guest.origin,
          method: guest.method,
          params: guest.params,
          summary: summarizeWeb3Request({
            method: guest.method,
            params: guest.params,
            origin: guest.origin,
          }).concat(input.grantOriginOnApproval ? " Approving also connects this site." : ""),
          createdAt,
        },
        kind: input.kind,
        guestId: guest.guestId,
        documentId: guest.documentId,
        grantOriginOnApproval: input.grantOriginOnApproval,
        outcome,
      };
      const parked = yield* SynchronizedRef.modify(stateRef, (state): [boolean, WalletState] => {
        const forGuest = [...state.pending.values()].filter(
          (pending) => pending.guestId === guest.guestId,
        ).length;
        if (state.pending.size >= WEB3_PENDING_MAX || forGuest >= WEB3_PENDING_PER_GUEST) {
          return [false, state];
        }
        return [true, { ...state, pending: new Map(state.pending).set(requestId, entry) }];
      });
      if (!parked) {
        return yield* Effect.fail(
          providerError(-32005, "Too many preview wallet requests are waiting for approval."),
        );
      }
      yield* publish;

      // An expired request may already be executing for an approver; then the
      // page gets that answer rather than a false rejection.
      const expire = claim(requestId).pipe(
        Effect.flatMap((claimed) =>
          Option.isSome(claimed)
            ? Effect.logInfo("a preview wallet request expired before anyone answered it", {
                method: guest.method,
              }).pipe(
                Effect.as<PendingOutcome>({ _tag: "rejected", code: DEFAULT_WEB3_REJECT_CODE }),
              )
            : Deferred.await(outcome),
        ),
      );
      const settled = yield* Deferred.await(outcome).pipe(
        Effect.timeoutOrElse({ duration: PENDING_REQUEST_TIMEOUT, orElse: () => expire }),
        Effect.onInterrupt(() => claim(requestId)),
      );
      switch (settled._tag) {
        case "approved":
          return settled.result;
        case "rejected":
          return yield* Effect.fail(
            providerError(settled.code, WEB3_REJECT_MESSAGES[settled.code]),
          );
        case "failed":
          return yield* Effect.fail(providerError(settled.code, settled.message));
      }
    });

  const openDocument = (guestId: string, documentId: string) =>
    SynchronizedRef.modify(stateRef, (state): [boolean, WalletState] =>
      state.documents.get(guestId) === documentId
        ? [false, state]
        : [true, { ...state, documents: new Map(state.documents).set(guestId, documentId) }],
    ).pipe(
      Effect.flatMap((changed) =>
        changed
          ? settlePending(
              (entry) => entry.guestId === guestId && entry.documentId !== documentId,
              DISCONNECTED,
            )
          : Effect.void,
      ),
    );

  const handle = (call: WalletGuestRequest) =>
    Effect.gen(function* () {
      if (!isWebOrigin(call.origin)) {
        return yield* Effect.fail(providerError(4100, WEB3_REJECT_MESSAGES[4100]));
      }
      const params = jsonParams(call.params);
      if (Option.isNone(params)) {
        return yield* Effect.fail(providerError(-32602, "The request params are too large."));
      }
      const guest = { ...call, params: params.value };
      const state = yield* SynchronizedRef.get(stateRef);
      if (!state.settings.enabled) {
        return yield* Effect.fail(providerError(4900, "The preview wallet is disabled."));
      }
      yield* openDocument(guest.guestId, guest.documentId);

      const kind = classifyWeb3Method(guest.method);
      if (kind === "local") return yield* answerLocally(guest.method, guest.origin);
      if (kind === "passthrough") {
        const { rpcUrl } = yield* requireChain(state);
        return yield* withHttp(
          web3RpcRequest({ rpcUrl, method: guest.method, params: guest.params }),
        );
      }

      // Some connector libraries restore their own "connected" cache without
      // calling eth_requestAccounts again. The first signature then doubles as
      // the connect request: it still passes the gate, and the origin is
      // granted only after signing succeeds.
      const grantOriginOnApproval =
        web3MethodNeedsAccountGrant(guest.method) && !originGranted(state.keystore, guest.origin);
      const input = { ...guest, kind };
      if (!web3MethodRequiresApproval(kind)) return yield* execute(input);

      if (yield* shouldAutoApprove({ ...input, state })) {
        const result = yield* execute(input);
        if (grantOriginOnApproval) yield* grantOrigin(guest.origin);
        return result;
      }
      return yield* park({ guest, kind, grantOriginOnApproval });
    });

  const request = (guest: WalletGuestRequest) =>
    handle(guest).pipe(
      Effect.map((result): Web3GuestReply => ({ ok: true, result })),
      Effect.catchCause((cause) => Effect.succeed(replyFromCause(cause))),
    );

  const approve = (requestId: string) =>
    Effect.gen(function* () {
      const claimed = yield* claim(requestId);
      if (Option.isNone(claimed))
        return yield* new PreviewWalletRequestNotFoundError({ requestId });
      const entry = claimed.value;
      const state = yield* SynchronizedRef.get(stateRef);
      if (!state.settings.enabled) {
        yield* Deferred.succeed(entry.outcome, DISCONNECTED);
        return yield* new PreviewWalletDisabledError();
      }
      const executed = yield* execute({
        method: entry.request.method,
        params: entry.request.params,
        origin: entry.request.origin,
        kind: entry.kind,
      }).pipe(Effect.result);
      if (executed._tag === "Failure") {
        const failure = executed.failure;
        const code =
          typeof failure === "object" && "code" in failure && typeof failure.code === "number"
            ? failure.code
            : -32603;
        yield* Deferred.succeed(entry.outcome, {
          _tag: "failed",
          code,
          message: messageOf(failure),
        });
        return {
          requestId,
          method: entry.request.method,
          outcome: "approved" as const,
          result: null,
          failure: messageOf(failure),
        };
      }
      if (entry.grantOriginOnApproval) {
        yield* grantOrigin(entry.request.origin).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("could not record a preview wallet origin grant", cause),
          ),
        );
      }
      yield* Deferred.succeed(entry.outcome, { _tag: "approved", result: executed.success });
      return {
        requestId,
        method: entry.request.method,
        outcome: "approved" as const,
        result: executed.success,
        failure: null,
      };
    });

  const reject = (requestId: string, code: Web3RejectCode = DEFAULT_WEB3_REJECT_CODE) =>
    Effect.gen(function* () {
      const claimed = yield* claim(requestId);
      if (Option.isNone(claimed))
        return yield* new PreviewWalletRequestNotFoundError({ requestId });
      yield* Deferred.succeed(claimed.value.outcome, { _tag: "rejected", code });
      return {
        requestId,
        method: claimed.value.request.method,
        outcome: "rejected" as const,
        result: null,
        failure: WEB3_REJECT_MESSAGES[code],
      };
    });

  const configure = (input: Web3WalletConfigureInput) =>
    serialized(
      Effect.gen(function* () {
        const state = yield* SynchronizedRef.get(stateRef);
        if (!state.settings.enabled) return yield* new PreviewWalletDisabledError();
        let keystore = state.keystore;

        if (input.generateAccount === true) {
          yield* requireKeystore(state);
          let mnemonic = keystore.mnemonic;
          if (mnemonic === null) {
            // Imported-only wallets have nothing to derive from.
            if (keystore.accounts.length > 0) return yield* new PreviewWalletNoAccountError();
            mnemonic = generateWalletMnemonic();
            keystore = { ...keystore, mnemonic };
          }
          const nextIndex = nextMnemonicDerivationIndex(keystore.accounts);
          const added = (yield* deriveMnemonicAccounts(mnemonic, nextIndex + 1))[nextIndex];
          if (added !== undefined) {
            keystore = {
              ...keystore,
              accounts: [...keystore.accounts, added],
              selectedAddress: added.address,
            };
          }
        }

        if (input.removeAccount !== undefined) {
          const next = dropAccountFromKeystore(keystore, input.removeAccount);
          if (next === null) return yield* new PreviewWalletNoAccountError();
          keystore = next;
        }

        if (input.accountLabel !== undefined) {
          const wanted = input.accountLabel.address.toLowerCase();
          const index = keystore.accounts.findIndex(
            (account) => account.address.toLowerCase() === wanted,
          );
          if (index < 0) return yield* new PreviewWalletNoAccountError();
          const current = keystore.accounts[index]!;
          if (current.label !== input.accountLabel.label) {
            const accounts = keystore.accounts.slice();
            accounts[index] = { ...current, label: input.accountLabel.label };
            keystore = { ...keystore, accounts };
          }
        }

        if (input.selectedAddress !== undefined) {
          const wanted = input.selectedAddress.toLowerCase();
          const account = keystore.accounts.find((entry) => entry.address.toLowerCase() === wanted);
          if (account === undefined) return yield* new PreviewWalletNoAccountError();
          keystore = { ...keystore, selectedAddress: account.address };
        }

        if (input.clearConnectedOrigins === true) keystore = { ...keystore, connectedOrigins: [] };

        if (keystore !== state.keystore) {
          yield* requireKeystore(state);
          yield* persist(keystore);
        }

        const settings: Web3WalletSettings = {
          ...state.settings,
          ...(input.approvalMode === undefined ? {} : { approvalMode: input.approvalMode }),
          ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
          ...(input.rpcUrl === undefined ? {} : { rpcUrl: input.rpcUrl }),
        };
        const resolved =
          input.chainId !== undefined || input.rpcUrl !== undefined
            ? yield* resolveChain(settings)
            : { chain: state.chain, rpcReachable: state.rpcReachable };
        yield* SynchronizedRef.update(stateRef, (current) => ({
          ...current,
          settings,
          chain: resolved.chain,
          rpcReachable: resolved.rpcReachable,
        }));
        yield* publish;
        return (yield* SubscriptionRef.get(viewRef)).status;
      }),
    );

  const forgetGuest = (guestId: string) =>
    clearAgentActivity(guestId).pipe(
      Effect.andThen(settlePending((entry) => entry.guestId === guestId, DISCONNECTED)),
      Effect.andThen(
        SynchronizedRef.update(stateRef, (state) => {
          if (!state.documents.has(guestId)) return state;
          const documents = new Map(state.documents);
          documents.delete(guestId);
          return { ...state, documents };
        }),
      ),
    );

  return PreviewWalletEngine.of({
    view: SubscriptionRef.get(viewRef),
    changes: SubscriptionRef.changes(viewRef),
    applySettings,
    configure,
    approve,
    reject,
    request,
    openDocument,
    noteAgentActivity,
    clearAgentActivity,
    forgetGuest,
  });
}).pipe(Effect.withSpan("PreviewWalletEngine.make"));

export const layer = Layer.effect(PreviewWalletEngine, make);
