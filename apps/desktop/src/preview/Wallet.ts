/**
 * Desktop side of the preview wallet.
 *
 * Deliberately thin: every piece of web3 behaviour — method classification,
 * request summarisation, chain resolution, signing, the keystore format — lives
 * in `@t3tools/web3`. What is left here is Electron: the two IPC surfaces,
 * sender validation, and the approval gate that has to consult preview tab
 * state.
 *
 * Two IPC surfaces, because they are two different trust boundaries:
 *
 * - The **guest** surface is reached by the preview preload on behalf of
 *   arbitrary web content. It is registered directly against `ipcMain` so the
 *   handler can see `event.sender` and reject anything that is not a preview
 *   `<webview>` guest of our own window.
 * - The **renderer** surface (`ipc/methods/preview.ts`) is our own app UI and
 *   the MCP automation path, and goes through the usual typed `DesktopIpc`
 *   helpers.
 */
import {
  DEFAULT_SERVER_SETTINGS,
  type PreviewAutomationWalletConfigureInput,
  type PreviewAutomationWalletRequestList,
  type PreviewAutomationWalletResolution,
  type Web3WalletSettings,
} from "@t3tools/contracts";
import { parsePersistedWeb3WalletSettings } from "@t3tools/shared/serverSettings";
import {
  DEFAULT_LOCAL_RPC_URL,
  describeChain,
  describeCustomNetwork,
  getDefaultChain,
  parseAddEthereumChain,
  probeChainId,
  resolveInitialChain,
  web3RpcRequest,
} from "@t3tools/web3/chain";
import type { Web3ProviderEvent } from "@t3tools/web3/inpage";
import {
  EMPTY_KEYSTORE,
  keystoreFileName,
  readKeystore,
  writeKeystore,
} from "@t3tools/web3/keystore";
import { findCustomNetwork, isBuiltInNetworkEnabled } from "@t3tools/web3/networks";
import {
  chainIdToHex,
  classifyWeb3Method,
  parseChainId,
  summarizeWeb3Request,
  web3MethodNeedsAccountGrant,
  web3MethodRequiresApproval,
  type Web3MethodKind,
} from "@t3tools/web3/rpc";
import {
  DEFAULT_WEB3_REJECT_CODE,
  PreviewWalletNoAccountError,
  PreviewWalletNoChainError,
  PreviewWalletRequestNotFoundError,
  WEB3_REJECT_MESSAGES,
  type PreviewWalletError,
  type Web3Chain,
  type Web3KeystoreFile,
  type Web3PendingRequest,
  type Web3RejectCode,
  type Web3RpcUrl,
  type Web3WalletStatus,
} from "@t3tools/web3/schema";
import {
  deriveMnemonicAccounts,
  dropAccountFromKeystore,
  generateWalletMnemonic,
  nextMnemonicDerivationIndex,
  resolveSigner,
  sendTransaction,
  signPersonalMessage,
  signTypedData,
} from "@t3tools/web3/signer";
import { ipcMain, webContents, type WebContents } from "electron";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpClient } from "effect/unstable/http";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  PREVIEW_WALLET_BOOTSTRAP_CHANNEL,
  PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL,
  PREVIEW_WALLET_REQUEST_CHANNEL,
  type PreviewWalletReply,
} from "./GuestProtocol.ts";

/**
 * How long after an agent action a wallet request still counts as
 * agent-driven.
 *
 * `PreviewTabState.controller` decays to `"none"` 750 ms after the last agent
 * action, which is far too short here: an agent clicks a button, the dapp
 * builds a transaction, and the wallet request can land seconds later. A
 * window this wide keeps `auto-for-agents` from stalling automated runs while
 * still expiring long before a human sits down at the same tab.
 */
const AGENT_ACTIVITY_GRACE_MS = 30_000;

/** How long a parked request waits before it gives the page an answer. */
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

function sameNumberList(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCustomNetworks(
  left: Web3WalletSettings["customNetworks"],
  right: Web3WalletSettings["customNetworks"],
): boolean {
  return (
    left.length === right.length &&
    left.every((network, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.chainId === network.chainId &&
        other.rpcUrl === network.rpcUrl &&
        other.name === network.name
      );
    })
  );
}

function catalogLostActiveChain(current: WalletState, settings: Web3WalletSettings): boolean {
  const chainId = current.chain?.chainId;
  if (chainId === undefined) return false;
  const lostCustom =
    findCustomNetwork(current.settings.customNetworks, chainId) !== null &&
    findCustomNetwork(settings.customNetworks, chainId) === null;
  const lostBuiltIn =
    isBuiltInNetworkEnabled(chainId, current.settings.disabledBuiltInChainIds) &&
    !isBuiltInNetworkEnabled(chainId, settings.disabledBuiltInChainIds);
  return lostCustom || lostBuiltIn;
}

export interface PreviewWalletBootstrap {
  readonly enabled: boolean;
  readonly uuid: string;
  readonly chainId: string | null;
  readonly selectedAddress: string | null;
}

/**
 * How a parked request comes back.
 *
 * A discriminated success rather than the error channel: rejection is a normal
 * outcome here, not a failure of the wallet, and modelling it as data keeps the
 * approve/reject paths symmetrical.
 */
type PendingOutcome =
  | { readonly approved: true; readonly result: unknown }
  | { readonly approved: false; readonly code: Web3RejectCode };

interface PendingEntry {
  readonly request: Web3PendingRequest;
  readonly kind: Web3MethodKind;
  readonly webContentsId: number;
  readonly grantOriginOnApproval: boolean;
  readonly deferred: Deferred.Deferred<PendingOutcome>;
}

interface WalletState {
  readonly settings: Web3WalletSettings;
  readonly keystore: Web3KeystoreFile;
  readonly chain: Web3Chain | null;
  readonly rpcReachable: boolean;
  readonly pending: ReadonlyMap<string, PendingEntry>;
}

export class PreviewWallet extends Context.Service<
  PreviewWallet,
  {
    readonly status: Effect.Effect<Web3WalletStatus>;
    readonly configure: (
      input: PreviewAutomationWalletConfigureInput,
    ) => Effect.Effect<Web3WalletStatus, PreviewWalletError>;
    readonly pendingRequests: Effect.Effect<PreviewAutomationWalletRequestList>;
    readonly approve: (
      requestId: string,
    ) => Effect.Effect<PreviewAutomationWalletResolution, PreviewWalletError>;
    readonly reject: (
      requestId: string,
      code?: Web3RejectCode,
    ) => Effect.Effect<PreviewAutomationWalletResolution, PreviewWalletError>;
    /** Re-read settings.json and reconcile chain + keystore against it. */
    readonly refreshSettings: Effect.Effect<void>;
    readonly applySettings: (settings: Web3WalletSettings) => Effect.Effect<void>;
    /**
     * Called by `PreviewManager` whenever an automation action touches a tab.
     * This is the signal behind `auto-for-agents`.
     */
    readonly noteAgentActivity: (webContentsId: number) => Effect.Effect<void>;
    readonly subscribeStateChanges: (
      listener: (status: Web3WalletStatus) => Effect.Effect<void>,
    ) => Effect.Effect<void>;
    /**
     * Runs one EIP-1193 request on behalf of a preview guest.
     *
     * Exposed on the service rather than buried in the IPC handler so the whole
     * pipeline — gate, grants, routing, signing — is reachable without an
     * Electron `ipcMain`.
     */
    readonly handleRequest: (input: {
      readonly method: string;
      readonly params: unknown;
      readonly origin: string;
      readonly webContentsId: number;
    }) => Effect.Effect<unknown, PreviewWalletError | Error>;
    /** Registers the guest-facing `ipcMain` handlers. Requires a scope. */
    readonly installGuestBridge: Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/preview/Wallet/PreviewWallet") {}

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
};

const providerError = (code: number, message: string) => {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
};

/** `about:blank` and opaque origins collapse to a stable, non-matching value. */
const originOf = (url: string): string => {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? "about:blank" : origin;
  } catch {
    return "about:blank";
  }
};

/**
 * Collapse a failed request into the guest envelope, preserving the EIP-1193
 * code when the failure carried one and falling back to -32603 otherwise.
 */
const replyFromCause = (cause: Cause.Cause<unknown>): PreviewWalletReply => {
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) continue;
    const error = reason.error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === "number") {
        return {
          ok: false,
          code,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      ok: false,
      code: -32603,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: false, code: -32603, message: "The preview wallet request failed." };
};

export const make = Effect.gen(function* PreviewWalletMake() {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const walletContext = yield* Effect.context<never>();

  const stateRef = yield* SynchronizedRef.make<WalletState>({
    settings: DEFAULT_SERVER_SETTINGS.web3Wallet,
    keystore: EMPTY_KEYSTORE,
    chain: null,
    rpcReachable: false,
    pending: new Map(),
  });
  const listenersRef = yield* Ref.make<
    ReadonlyArray<(status: Web3WalletStatus) => Effect.Effect<void>>
  >([]);
  const agentActivityRef = yield* Ref.make<ReadonlyMap<number, number>>(new Map());
  const keystoreLock = yield* Semaphore.make(1);

  /**
   * Mirror of the last published status, kept as a plain mutable value so the
   * synchronous bootstrap IPC handler (which `Effect.runSyncWith` requires to
   * be genuinely synchronous) never has to touch a `SynchronizedRef`.
   */
  let snapshot: Web3WalletStatus = {
    enabled: false,
    accounts: [],
    selectedAddress: null,
    chain: null,
    rpcReachable: false,
    approvalMode: "auto-for-agents",
    pendingRequests: [],
    connectedOrigins: [],
  };
  /** Stable per-process uuid so EIP-6963 identity does not change per document. */
  const providerUuid = yield* crypto.randomUUIDv4;

  const withHttp = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    Effect.provideService(effect, HttpClient.HttpClient, httpClient);

  const toStatus = (state: WalletState): Web3WalletStatus => ({
    enabled: state.settings.enabled,
    accounts: state.keystore.accounts,
    selectedAddress: state.keystore.selectedAddress,
    chain: state.chain,
    rpcReachable: state.rpcReachable,
    approvalMode: state.settings.approvalMode,
    pendingRequests: [...state.pending.values()].map((entry) => entry.request),
    connectedOrigins: state.keystore.connectedOrigins,
  });

  const publish = Effect.fn("PreviewWallet.publish")(function* () {
    const state = yield* SynchronizedRef.get(stateRef);
    const status = toStatus(state);
    snapshot = status;
    const listeners = yield* Ref.get(listenersRef);
    yield* Effect.forEach(
      listeners,
      (listener) =>
        listener(status).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("preview wallet state subscriber failed", cause),
          ),
        ),
      { discard: true },
    );
  });

  // One wallet per desktop state directory. Preview partitions are
  // per-environment, but the wallet's whole job is to be the same test identity
  // across the app, so it is not partition-scoped.
  const keystorePath = path.join(environment.previewWalletsDir, keystoreFileName("shared"));

  const persistKeystore = Effect.fn("PreviewWallet.persistKeystore")(function* (
    keystore: Web3KeystoreFile,
  ) {
    yield* writeKeystore({ keystorePath, keystore }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(Crypto.Crypto, crypto),
    );
  });

  const loadKeystore = Effect.fn("PreviewWallet.loadKeystore")(function* () {
    return yield* readKeystore(keystorePath).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );
  });

  /**
   * Generate the wallet's mnemonic on first enable. Never regenerates: losing
   * the mnemonic would orphan any test state a user has funded on a local node.
   */
  const ensureKeystore = Effect.fn("PreviewWallet.ensureKeystore")(function* (
    keystore: Web3KeystoreFile,
  ) {
    if (keystore.mnemonic !== null || keystore.accounts.length > 0) return keystore;

    const mnemonic = generateWalletMnemonic();
    const accounts = yield* deriveMnemonicAccounts(mnemonic, INITIAL_ACCOUNT_COUNT);
    const next: Web3KeystoreFile = {
      ...keystore,
      mnemonic,
      accounts,
      selectedAddress: accounts[0]?.address ?? null,
    };
    yield* persistKeystore(next);
    yield* Effect.logInfo("generated a preview wallet test mnemonic", {
      accountCount: accounts.length,
    });
    return next;
  });

  const resolveChain = Effect.fn("PreviewWallet.resolveChain")(function* (
    settings: Web3WalletSettings,
  ) {
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
      chain.rpcUrl === null
        ? false
        : (yield* withHttp(probeChainId(chain.rpcUrl))) === chain.chainId;
    return { chain, rpcReachable: reachable } as const;
  });

  const applySettings = Effect.fn("PreviewWallet.applySettings")(function* (
    settings: Web3WalletSettings,
  ) {
    const current = yield* SynchronizedRef.get(stateRef);
    const unchanged =
      current.settings.enabled === settings.enabled &&
      current.settings.approvalMode === settings.approvalMode &&
      current.settings.chainId === settings.chainId &&
      current.settings.rpcUrl === settings.rpcUrl &&
      current.settings.autoConnectLoopback === settings.autoConnectLoopback &&
      sameNumberList(current.settings.disabledBuiltInChainIds, settings.disabledBuiltInChainIds) &&
      sameCustomNetworks(current.settings.customNetworks, settings.customNetworks);
    if (unchanged && (current.keystore.accounts.length > 0 || !settings.enabled)) return;

    // A wallet that cannot read or create its keystore stays empty and logs;
    // it must not take down preview startup or settings propagation.
    const onKeystoreFailure = (cause: unknown) =>
      Effect.logWarning("could not prepare the preview wallet keystore", cause).pipe(
        Effect.as<Web3KeystoreFile>(EMPTY_KEYSTORE),
      );
    const keystore = settings.enabled
      ? yield* loadKeystore().pipe(
          Effect.flatMap(ensureKeystore),
          Effect.catchCause(onKeystoreFailure),
        )
      : current.keystore;

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
      settings,
      keystore,
      chain: resolved.chain,
      rpcReachable: resolved.rpcReachable,
    }));
    yield* publish();
  });

  const refreshSettings = Effect.fn("PreviewWallet.refreshSettings")(function* () {
    const raw = yield* fileSystem
      .readFileString(environment.serverSettingsPath)
      .pipe(Effect.option);
    // A missing or unreadable settings file means a disabled wallet: something
    // that can sign must fail closed, never fail open.
    const settings = Option.isSome(raw)
      ? parsePersistedWeb3WalletSettings(raw.value)
      : DEFAULT_SERVER_SETTINGS.web3Wallet;
    yield* applySettings(settings);
  });

  const noteAgentActivity = Effect.fn("PreviewWallet.noteAgentActivity")(function* (
    webContentsId: number,
  ) {
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(agentActivityRef, (activity) => {
      const next = new Map(activity);
      next.set(webContentsId, now);
      return next;
    });
  });

  const isAgentDriven = Effect.fn("PreviewWallet.isAgentDriven")(function* (webContentsId: number) {
    const activity = yield* Ref.get(agentActivityRef);
    const last = activity.get(webContentsId);
    if (last === undefined) return false;
    const now = yield* Clock.currentTimeMillis;
    return now - last <= AGENT_ACTIVITY_GRACE_MS;
  });

  const originGranted = (keystore: Web3KeystoreFile, origin: string): boolean =>
    keystore.connectedOrigins.includes(origin);

  /**
   * Whether a request can resolve without a human.
   *
   * `always-auto` still parks the *first* request from a non-loopback origin:
   * "approve everything" is meant to remove friction from local development,
   * not to hand a signing oracle to any page that happens to load in the
   * preview. Once an origin has been granted once, it is trusted thereafter.
   */
  const shouldAutoApprove = Effect.fn("PreviewWallet.shouldAutoApprove")(function* (input: {
    readonly state: WalletState;
    readonly kind: Web3MethodKind;
    readonly origin: string;
    readonly webContentsId: number;
  }) {
    const { state, kind, origin, webContentsId } = input;
    const loopback = isLoopbackOrigin(origin);
    const granted = originGranted(state.keystore, origin);

    if (kind === "connect" && granted) return true;
    if (kind === "connect" && loopback && state.settings.autoConnectLoopback) return true;

    switch (state.settings.approvalMode) {
      case "always-ask":
        return false;
      case "always-auto":
        return granted || loopback;
      case "auto-for-agents":
        return yield* isAgentDriven(webContentsId);
    }
  });

  const grantOrigin = Effect.fn("PreviewWallet.grantOrigin")(function* (origin: string) {
    yield* SynchronizedRef.updateEffect(stateRef, (state) =>
      Effect.gen(function* () {
        if (originGranted(state.keystore, origin)) return state;
        const keystore: Web3KeystoreFile = {
          ...state.keystore,
          connectedOrigins: [...state.keystore.connectedOrigins, origin],
        };
        yield* persistKeystore(keystore).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("could not persist a preview wallet origin grant", cause),
          ),
        );
        return { ...state, keystore };
      }),
    );
  });

  const requireChain = Effect.fn("PreviewWallet.requireChain")(function* (state: WalletState) {
    if (state.chain === null || state.chain.rpcUrl === null) {
      return yield* new PreviewWalletNoChainError();
    }
    return { chainId: state.chain.chainId, rpcUrl: state.chain.rpcUrl };
  });

  const accountList = (keystore: Web3KeystoreFile): ReadonlyArray<string> => {
    if (keystore.selectedAddress === null) return keystore.accounts.map((a) => a.address);
    return [
      keystore.selectedAddress,
      ...keystore.accounts
        .map((account) => account.address)
        .filter((address) => address !== keystore.selectedAddress),
    ];
  };

  const broadcastProviderEvent = (event: Web3ProviderEvent): void => {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() !== "webview" || contents.isDestroyed()) continue;
      contents.send(PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL, event);
    }
  };

  /** Account visibility is an origin grant, so never broadcast it globally. */
  const broadcastAccountsChanged = (keystore: Web3KeystoreFile): void => {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() !== "webview" || contents.isDestroyed()) continue;
      const origin = originOf(contents.getURL());
      contents.send(PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL, {
        event: "accountsChanged",
        payload: originGranted(keystore, origin) ? accountList(keystore) : [],
      } satisfies Web3ProviderEvent);
    }
  };

  const grantOriginAndNotify = Effect.fn("PreviewWallet.grantOriginAndNotify")(function* (
    origin: string,
  ) {
    yield* grantOrigin(origin);
    const next = yield* SynchronizedRef.get(stateRef);
    yield* publish();
    broadcastAccountsChanged(next.keystore);
    return accountList(next.keystore);
  });

  const setChain = Effect.fn("PreviewWallet.setChain")(function* (
    chain: Web3Chain,
    alreadyVerified = false,
  ) {
    const reachable =
      chain.rpcUrl === null
        ? false
        : alreadyVerified || (yield* withHttp(probeChainId(chain.rpcUrl))) === chain.chainId;
    yield* SynchronizedRef.update(stateRef, (state) => ({
      ...state,
      chain,
      rpcReachable: reachable,
    }));
    yield* publish();
    broadcastProviderEvent({ event: "chainChanged", payload: chainIdToHex(chain.chainId) });
  });

  /** Runs a request that has cleared the approval gate. */
  const executeRequest = Effect.fn("PreviewWallet.executeRequest")(function* (input: {
    readonly method: string;
    readonly params: unknown;
    readonly origin: string;
    readonly kind: Web3MethodKind;
  }) {
    const { method, params, origin, kind } = input;
    const state = yield* SynchronizedRef.get(stateRef);

    if (kind === "connect") {
      const accounts = accountList(state.keystore);
      if (accounts.length === 0) return yield* new PreviewWalletNoAccountError();
      yield* grantOriginAndNotify(origin);
      if (method === "wallet_requestPermissions") {
        return [{ parentCapability: "eth_accounts" }];
      }
      return accounts;
    }

    if (kind === "chain") {
      if (method === "wallet_addEthereumChain") {
        const chain = parseAddEthereumChain(params);
        if (chain === null) {
          return yield* Effect.fail(
            providerError(4902, "Could not understand the requested chain."),
          );
        }
        yield* setChain(chain);
        return null;
      }
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
        state.chain !== null && state.chain.rpcUrl !== null
          ? (yield* withHttp(probeChainId(state.chain.rpcUrl))) === chainId
            ? state.chain.rpcUrl
            : null
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
    }

    if (kind === "asset") {
      // Nothing to track: the preview wallet has no token list UI. Reporting
      // success keeps dapp onboarding flows moving.
      return true;
    }

    // Signature methods from here down.
    const addressParam =
      method === "personal_sign"
        ? Array.isArray(params)
          ? params[1]
          : undefined
        : Array.isArray(params)
          ? params[0]
          : undefined;
    const requestedAddress =
      typeof addressParam === "string" && /^0x[0-9a-fA-F]{40}$/.test(addressParam)
        ? addressParam
        : (state.keystore.selectedAddress ?? null);
    if (requestedAddress === null) return yield* new PreviewWalletNoAccountError();

    switch (method) {
      case "personal_sign": {
        const account = yield* resolveSigner(state.keystore, requestedAddress);
        const message = Array.isArray(params) ? params[0] : "";
        return yield* signPersonalMessage({ account, message: String(message) });
      }
      case "eth_sign": {
        const account = yield* resolveSigner(state.keystore, requestedAddress);
        const message = Array.isArray(params) ? params[1] : "";
        return yield* signPersonalMessage({ account, message: String(message) });
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

  const answerLocally = Effect.fn("PreviewWallet.answerLocally")(function* (input: {
    readonly method: string;
    readonly origin: string;
  }) {
    const state = yield* SynchronizedRef.get(stateRef);
    const granted = originGranted(state.keystore, input.origin);
    switch (input.method) {
      case "eth_accounts":
        // An un-granted origin gets an empty list rather than an error, which
        // is what MetaMask does and what dapp "not connected" branches expect.
        return granted ? accountList(state.keystore) : [];
      case "eth_coinbase":
        return granted ? (accountList(state.keystore)[0] ?? null) : null;
      case "eth_chainId":
        return state.chain === null ? null : chainIdToHex(state.chain.chainId);
      case "net_version":
        return state.chain === null ? null : String(state.chain.chainId);
      case "wallet_getPermissions":
        return granted ? [{ parentCapability: "eth_accounts" }] : [];
      case "wallet_revokePermissions": {
        yield* SynchronizedRef.updateEffect(stateRef, (current) =>
          Effect.gen(function* () {
            const keystore: Web3KeystoreFile = {
              ...current.keystore,
              connectedOrigins: current.keystore.connectedOrigins.filter(
                (entry) => entry !== input.origin,
              ),
            };
            yield* persistKeystore(keystore).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("could not persist a preview wallet revoke", cause),
              ),
            );
            return { ...current, keystore };
          }),
        );
        yield* publish();
        const next = yield* SynchronizedRef.get(stateRef);
        broadcastAccountsChanged(next.keystore);
        return null;
      }
      case "web3_clientVersion":
        return "VetraPreviewWallet/1.0.0";
      default:
        return null;
    }
  });

  const park = Effect.fn("PreviewWallet.park")(function* (input: {
    readonly method: string;
    readonly params: unknown;
    readonly origin: string;
    readonly kind: Web3MethodKind;
    readonly webContentsId: number;
    readonly grantOriginOnApproval: boolean;
  }) {
    const requestId = yield* crypto.randomUUIDv4;
    const now = yield* DateTime.now;
    const deferred = yield* Deferred.make<PendingOutcome>();
    const request: Web3PendingRequest = {
      requestId,
      origin: input.origin,
      method: input.method,
      params: input.params,
      summary: summarizeWeb3Request({
        method: input.method,
        params: input.params,
        origin: input.origin,
      }).concat(input.grantOriginOnApproval ? " Approving also connects this site." : ""),
      createdAt: DateTime.formatIso(now),
    };

    yield* SynchronizedRef.update(stateRef, (state) => {
      const pending = new Map(state.pending);
      pending.set(requestId, {
        request,
        kind: input.kind,
        webContentsId: input.webContentsId,
        grantOriginOnApproval: input.grantOriginOnApproval,
        deferred,
      });
      return { ...state, pending };
    });
    yield* publish();

    const drop = SynchronizedRef.update(stateRef, (state) => {
      const pending = new Map(state.pending);
      pending.delete(requestId);
      return { ...state, pending };
    }).pipe(Effect.andThen(publish()));

    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOrElse({
        duration: PENDING_REQUEST_TIMEOUT,
        orElse: () =>
          Effect.logInfo("a preview wallet request expired before anyone answered it", {
            method: input.method,
            origin: input.origin,
          }).pipe(Effect.as<PendingOutcome>({ approved: false, code: DEFAULT_WEB3_REJECT_CODE })),
      }),
      Effect.ensuring(drop),
    );
  });

  /** The whole guest request pipeline, from an untrusted page to an answer. */
  const handleGuestRequest = Effect.fn("PreviewWallet.handleGuestRequest")(function* (input: {
    readonly method: string;
    readonly params: unknown;
    readonly origin: string;
    readonly webContentsId: number;
  }) {
    const state = yield* SynchronizedRef.get(stateRef);
    if (!state.settings.enabled) {
      return yield* Effect.fail(providerError(4900, "The preview wallet is disabled."));
    }

    const kind = classifyWeb3Method(input.method);

    if (kind === "local") {
      return yield* answerLocally({ method: input.method, origin: input.origin });
    }

    if (kind === "passthrough") {
      const { rpcUrl } = yield* requireChain(state);
      return yield* withHttp(
        web3RpcRequest({ rpcUrl, method: input.method, params: input.params }),
      );
    }

    // Some connector libraries restore their own "connected" cache without
    // calling eth_requestAccounts again. Treat the first signature as a
    // recoverable connect request: it still goes through the approval gate,
    // and the origin grant is written only after signing succeeds.
    const grantOriginOnApproval =
      web3MethodNeedsAccountGrant(input.method) && !originGranted(state.keystore, input.origin);

    if (!web3MethodRequiresApproval(kind)) {
      return yield* executeRequest({ ...input, kind });
    }

    const auto = yield* shouldAutoApprove({
      state,
      kind,
      origin: input.origin,
      webContentsId: input.webContentsId,
    });
    if (auto) {
      const result = yield* executeRequest({ ...input, kind });
      if (grantOriginOnApproval) yield* grantOriginAndNotify(input.origin);
      return result;
    }

    const outcome = yield* park({ ...input, kind, grantOriginOnApproval });
    if (outcome.approved) return outcome.result;
    return yield* Effect.fail(providerError(outcome.code, WEB3_REJECT_MESSAGES[outcome.code]));
  });

  const takePending = Effect.fn("PreviewWallet.takePending")(function* (requestId: string) {
    const state = yield* SynchronizedRef.get(stateRef);
    const entry = state.pending.get(requestId);
    if (!entry) return yield* new PreviewWalletRequestNotFoundError({ requestId });
    return entry;
  });

  const approve = Effect.fn("PreviewWallet.approve")(function* (requestId: string) {
    const entry = yield* takePending(requestId);
    const executed = yield* executeRequest({
      method: entry.request.method,
      params: entry.request.params,
      origin: entry.request.origin,
      kind: entry.kind,
    }).pipe(Effect.result);

    if (executed._tag === "Failure") {
      // The page must not be left hanging on a request we failed to execute.
      yield* Deferred.succeed(entry.deferred, {
        approved: false,
        code: DEFAULT_WEB3_REJECT_CODE,
      });
      return {
        requestId,
        method: entry.request.method,
        outcome: "approved" as const,
        result: null,
        failure: String(executed.failure),
      };
    }

    if (entry.grantOriginOnApproval) {
      yield* grantOriginAndNotify(entry.request.origin);
    }
    yield* Deferred.succeed(entry.deferred, { approved: true, result: executed.success });
    return {
      requestId,
      method: entry.request.method,
      outcome: "approved" as const,
      result: executed.success,
      failure: null,
    };
  });

  const reject = Effect.fn("PreviewWallet.reject")(function* (
    requestId: string,
    code: Web3RejectCode = DEFAULT_WEB3_REJECT_CODE,
  ) {
    const entry = yield* takePending(requestId);
    yield* Deferred.succeed(entry.deferred, { approved: false, code });
    return {
      requestId,
      method: entry.request.method,
      outcome: "rejected" as const,
      result: null,
      failure: WEB3_REJECT_MESSAGES[code],
    };
  });

  const configure = Effect.fn("PreviewWallet.configure")(function* (
    input: PreviewAutomationWalletConfigureInput,
  ) {
    yield* keystoreLock.withPermits(1)(
      Effect.gen(function* () {
        const state = yield* SynchronizedRef.get(stateRef);
        let keystore = state.keystore;

        if (input.generateAccount === true) {
          let mnemonic = keystore.mnemonic;
          if (mnemonic === null) {
            // Imported-only wallets have no mnemonic to derive from. An empty
            // wallet is the Settings "Add account" path before first enable
            // has created a keystore — generate one rather than failing.
            if (keystore.accounts.length > 0) {
              return yield* new PreviewWalletNoAccountError();
            }
            mnemonic = generateWalletMnemonic();
            keystore = { ...keystore, mnemonic };
          }
          const nextIndex = nextMnemonicDerivationIndex(keystore.accounts);
          const derived = yield* deriveMnemonicAccounts(mnemonic, nextIndex + 1);
          const added = derived[nextIndex];
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
          const known = keystore.accounts.some(
            (account) => account.address.toLowerCase() === wanted,
          );
          if (!known) return yield* new PreviewWalletNoAccountError();
          keystore = {
            ...keystore,
            selectedAddress: keystore.accounts.find(
              (account) => account.address.toLowerCase() === wanted,
            )!.address,
          };
        }

        if (input.clearConnectedOrigins === true) {
          keystore = { ...keystore, connectedOrigins: [] };
        }

        if (keystore !== state.keystore) {
          yield* persistKeystore(keystore);
          yield* SynchronizedRef.update(stateRef, (current) => ({ ...current, keystore }));
          // Labels are display-only. Firing accountsChanged for a rename makes
          // dapps refetch as if the connected account set changed.
          if (keystoreAffectsPageAccounts(state.keystore, keystore)) {
            broadcastAccountsChanged(keystore);
          }
        }

        const settings: Web3WalletSettings = {
          ...state.settings,
          ...(input.approvalMode === undefined ? {} : { approvalMode: input.approvalMode }),
          ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
          ...(input.rpcUrl === undefined ? {} : { rpcUrl: input.rpcUrl }),
        };
        if (input.chainId !== undefined || input.rpcUrl !== undefined) {
          const resolved = yield* resolveChain(settings);
          yield* SynchronizedRef.update(stateRef, (current) => ({
            ...current,
            settings,
            chain: resolved.chain,
            rpcReachable: resolved.rpcReachable,
          }));
          if (resolved.chain !== null) {
            broadcastProviderEvent({
              event: "chainChanged",
              payload: chainIdToHex(resolved.chain.chainId),
            });
          }
        } else {
          yield* SynchronizedRef.update(stateRef, (current) => ({ ...current, settings }));
        }
      }),
    );
    yield* publish();
    return toStatus(yield* SynchronizedRef.get(stateRef));
  });

  /**
   * Only a preview `<webview>` guest may talk to the wallet.
   *
   * Mirrors the checks `PreviewManager.registerWebviewUnlocked` already makes,
   * and the `will-attach-webview` partition gate in `DesktopWindow`. Without
   * this, any renderer in the process could reach a signing surface.
   */
  const isPreviewGuest = (sender: WebContents): boolean => {
    if (sender.isDestroyed() || sender.getType() !== "webview") return false;
    const host = sender.hostWebContents;
    return host !== null && host !== undefined && !host.isDestroyed();
  };

  const installGuestBridge = Effect.fn("PreviewWallet.installGuestBridge")(function* () {
    const runPromise = Effect.runPromiseWith(walletContext);

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        ipcMain.removeAllListeners(PREVIEW_WALLET_BOOTSTRAP_CHANNEL);
        ipcMain.on(PREVIEW_WALLET_BOOTSTRAP_CHANNEL, (event) => {
          const origin = originOf(event.sender.getURL());
          const bootstrap: PreviewWalletBootstrap = isPreviewGuest(event.sender)
            ? {
                enabled: snapshot.enabled,
                uuid: providerUuid,
                chainId: snapshot.chain === null ? null : chainIdToHex(snapshot.chain.chainId),
                selectedAddress: snapshot.connectedOrigins.includes(origin)
                  ? snapshot.selectedAddress
                  : null,
              }
            : { enabled: false, uuid: providerUuid, chainId: null, selectedAddress: null };
          event.returnValue = bootstrap;
        });

        ipcMain.removeHandler(PREVIEW_WALLET_REQUEST_CHANNEL);
        ipcMain.handle(
          PREVIEW_WALLET_REQUEST_CHANNEL,
          async (event, raw): Promise<PreviewWalletReply> => {
            if (!isPreviewGuest(event.sender)) {
              return {
                ok: false,
                code: 4900,
                message: "The preview wallet is not available here.",
              };
            }
            const payload = raw as { method?: unknown; params?: unknown } | null;
            if (typeof payload?.method !== "string") {
              return { ok: false, code: -32600, message: "Invalid request: method is required." };
            }
            const origin = originOf(event.sender.getURL());
            return await runPromise(
              handleGuestRequest({
                method: payload.method,
                params: payload.params,
                origin,
                webContentsId: event.sender.id,
              }).pipe(
                Effect.map((result): PreviewWalletReply => ({ ok: true, result })),
                Effect.catchCause((cause) => Effect.succeed(replyFromCause(cause))),
              ),
            );
          },
        );
      }),
      () =>
        Effect.sync(() => {
          ipcMain.removeAllListeners(PREVIEW_WALLET_BOOTSTRAP_CHANNEL);
          ipcMain.removeHandler(PREVIEW_WALLET_REQUEST_CHANNEL);
        }),
    );
  });

  yield* refreshSettings().pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("could not load preview wallet settings at startup", cause),
    ),
  );

  return PreviewWallet.of({
    status: SynchronizedRef.get(stateRef).pipe(Effect.map(toStatus)),
    configure,
    pendingRequests: SynchronizedRef.get(stateRef).pipe(
      Effect.map((state) => ({
        requests: [...state.pending.values()].map((entry) => entry.request),
      })),
    ),
    approve,
    reject,
    handleRequest: handleGuestRequest,
    refreshSettings: refreshSettings(),
    applySettings,
    noteAgentActivity,
    subscribeStateChanges: (listener) =>
      Ref.update(listenersRef, (listeners) => [...listeners, listener]),
    installGuestBridge: installGuestBridge(),
  });
}).pipe(Effect.withSpan("PreviewWallet.make"));

export const layer = Layer.effect(PreviewWallet, make);

/** Pages only observe addresses and grants, not the labels shown in our UI. */
function keystoreAffectsPageAccounts(previous: Web3KeystoreFile, next: Web3KeystoreFile): boolean {
  if (previous.selectedAddress !== next.selectedAddress) return true;
  if (previous.connectedOrigins.join("\0") !== next.connectedOrigins.join("\0")) return true;
  if (previous.accounts.length !== next.accounts.length) return true;
  return previous.accounts.some(
    (account, index) => account.address !== next.accounts[index]?.address,
  );
}

const DISABLED_STATUS: Web3WalletStatus = {
  enabled: false,
  accounts: [],
  selectedAddress: null,
  chain: null,
  rpcReachable: false,
  approvalMode: "auto-for-agents",
  pendingRequests: [],
  connectedOrigins: [],
};

/**
 * A wallet that is present but switched off, plus a record of the agent
 * activity it was told about.
 *
 * Exists so `PreviewManager`'s tests can satisfy the dependency without an
 * Electron `ipcMain`, and so the "an automation action reports agent activity"
 * behaviour is assertable.
 */
export const layerTest = (agentActivity: Array<number> = []) =>
  Layer.succeed(
    PreviewWallet,
    PreviewWallet.of({
      status: Effect.succeed(DISABLED_STATUS),
      configure: () => Effect.succeed(DISABLED_STATUS),
      pendingRequests: Effect.succeed({ requests: [] }),
      approve: (requestId) => new PreviewWalletRequestNotFoundError({ requestId }),
      reject: (requestId) => new PreviewWalletRequestNotFoundError({ requestId }),
      refreshSettings: Effect.void,
      applySettings: () => Effect.void,
      noteAgentActivity: (webContentsId) =>
        Effect.sync(() => {
          agentActivity.push(webContentsId);
        }),
      handleRequest: () => Effect.succeed(null),
      subscribeStateChanges: () => Effect.void,
      installGuestBridge: Effect.void,
    }),
  );
