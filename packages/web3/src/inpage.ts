/**
 * The in-page EIP-1193 provider for the preview wallet.
 *
 * **This module must stay dependency-free.** It is bundled into
 * `preview-pick-preload.cjs`, a *sandboxed* Electron preload, and Electron
 * cannot resolve package imports from inside a packaged ASAR. Importing
 * `effect` or `viem` here would break the packaged app, not just bloat it.
 *
 * It also takes its window, uuid and icon as arguments rather than reaching for
 * globals, so the unit tests can drive it without a DOM.
 *
 * @module Web3Inpage
 */

export interface Eip1193RequestArgs {
  readonly method: string;
  readonly params?: unknown;
}

export interface Eip1193ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
}

export type Web3ProviderEventName =
  | "accountsChanged"
  | "chainChanged"
  | "connect"
  | "disconnect"
  | "message";

export interface Web3ProviderEvent {
  readonly event: Web3ProviderEventName;
  readonly payload: unknown;
}

type Listener = (payload: unknown) => void;

export interface Web3InpageProvider {
  readonly isMetaMask: true;
  readonly isVetraPreviewWallet: true;
  chainId: string | null;
  networkVersion: string | null;
  selectedAddress: string | null;
  request(args: Eip1193RequestArgs): Promise<unknown>;
  on(event: string, listener: Listener): Web3InpageProvider;
  addListener(event: string, listener: Listener): Web3InpageProvider;
  removeListener(event: string, listener: Listener): Web3InpageProvider;
  removeAllListeners(event?: string): Web3InpageProvider;
  /** Legacy: pre-EIP-1193 connect. */
  enable(): Promise<unknown>;
  /** Legacy: both `send(method, params)` and `send(payload, callback)` shapes. */
  send(methodOrPayload: unknown, paramsOrCallback?: unknown): unknown;
  /** Legacy: node-style callback JSON-RPC. */
  sendAsync(
    payload: { readonly id?: unknown; readonly method: string; readonly params?: unknown },
    callback: (error: unknown, response?: unknown) => void,
  ): void;
  readonly _metamask: { isUnlocked(): Promise<boolean> };
}

/** Narrow slice of `window` this module touches, so tests can fake it. */
export interface Web3InpageWindow {
  ethereum?: unknown;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
  dispatchEvent(event: unknown): unknown;
  CustomEvent: new (type: string, init?: { detail?: unknown }) => unknown;
}

export interface Web3InpageOptions {
  /** Forwards a JSON-RPC call to the host. Rejections should carry a `code`. */
  readonly transport: (args: Eip1193RequestArgs) => Promise<unknown>;
  /** Stable per-page uuid for EIP-6963. */
  readonly uuid: string;
  /** Data URI, required by EIP-6963. */
  readonly icon: string;
  readonly chainId?: string | null;
  readonly selectedAddress?: string | null;
}

export interface Web3InpageHandle {
  readonly provider: Web3InpageProvider;
  /** Re-announce and update mutable state from a host-pushed event. */
  readonly emit: (event: Web3ProviderEvent) => void;
  readonly announce: () => void;
  readonly uninstall: () => void;
}

/**
 * `rdns` is `io.metamask` deliberately: dapps route on it, and a wallet that
 * announces something else is invisible to a large slice of the ecosystem the
 * preview exists to test. `name` carries the honest label so a human looking at
 * the wallet picker can still tell what they are connected to.
 */
export const WEB3_PROVIDER_INFO = {
  name: "MetaMask",
  rdns: "io.metamask",
} as const;

export const WEB3_PROVIDER_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI2Y2ODUxYiIvPjxwYXRoIGQ9Ik0yMyA5bC01LjIgMy45IDEtMi4zeiIgZmlsbD0iI2ZmZiIvPjxwYXRoIGQ9Ik05IDlsNS4xIDMuOS0uOS0yLjN6bTEyLjggMTAuMkwyMCAyMmwzLjkgMS4xIDEuMS0zLjh6bS0xNC44IDBMOC4xIDIzLjEgMTIgMjJsLTEuOC0yLjh6IiBmaWxsPSIjZmZmIi8+PC9zdmc+";

function providerError(code: number, message: string, data?: unknown): Eip1193ProviderRpcError {
  const error = new Error(message) as Error & { code: number; data?: unknown };
  error.code = code;
  if (data !== undefined) error.data = data;
  return error as Eip1193ProviderRpcError;
}

export function createWeb3InpageProvider(options: Web3InpageOptions): {
  readonly provider: Web3InpageProvider;
  readonly emit: (event: Web3ProviderEvent) => void;
} {
  const listeners = new Map<string, Set<Listener>>();

  const emitLocal = (event: string, payload: unknown): void => {
    const bucket = listeners.get(event);
    if (!bucket) return;
    // Snapshot first: a listener that calls removeListener during dispatch
    // would otherwise mutate the set mid-iteration and skip its peers.
    const snapshot = Array.from(bucket);
    for (const listener of snapshot) {
      try {
        listener(payload);
      } catch {
        // A throwing dapp listener must not break the wallet or its siblings.
      }
    }
  };

  const provider: Web3InpageProvider = {
    isMetaMask: true,
    isVetraPreviewWallet: true,
    chainId: options.chainId ?? null,
    networkVersion:
      options.chainId === undefined || options.chainId === null
        ? null
        : String(Number.parseInt(options.chainId, 16)),
    selectedAddress: options.selectedAddress ?? null,

    async request(args) {
      if (typeof args?.method !== "string" || args.method.length === 0) {
        throw providerError(-32600, "Invalid request: method is required.");
      }
      const result = await options.transport({ method: args.method, params: args.params });
      if (args.method === "eth_accounts" || args.method === "eth_requestAccounts") {
        const accounts = Array.isArray(result) ? result : [];
        provider.selectedAddress = typeof accounts[0] === "string" ? accounts[0] : null;
      } else if (args.method === "wallet_revokePermissions") {
        provider.selectedAddress = null;
      }
      return result;
    },

    on(event, listener) {
      const bucket = listeners.get(event) ?? new Set<Listener>();
      bucket.add(listener);
      listeners.set(event, bucket);
      return provider;
    },

    addListener(event, listener) {
      return provider.on(event, listener);
    },

    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },

    removeAllListeners(event) {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
      return provider;
    },

    enable() {
      return provider.request({ method: "eth_requestAccounts" });
    },

    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === "string") {
        return provider.request({
          method: methodOrPayload,
          ...(paramsOrCallback === undefined ? {} : { params: paramsOrCallback }),
        });
      }
      const payload = methodOrPayload as { method: string; params?: unknown; id?: unknown };
      if (typeof paramsOrCallback === "function") {
        provider.sendAsync(payload, paramsOrCallback as (e: unknown, r?: unknown) => void);
        return undefined;
      }
      return provider.request({ method: payload.method, params: payload.params });
    },

    sendAsync(payload, callback) {
      provider
        .request({ method: payload.method, params: payload.params })
        .then((result) => {
          callback(null, { id: payload.id ?? null, jsonrpc: "2.0", result });
        })
        .catch((error: unknown) => {
          callback(error);
        });
    },

    _metamask: {
      isUnlocked() {
        return Promise.resolve(true);
      },
    },
  };

  const emit = (event: Web3ProviderEvent): void => {
    switch (event.event) {
      case "chainChanged": {
        const chainId = typeof event.payload === "string" ? event.payload : null;
        provider.chainId = chainId;
        provider.networkVersion = chainId === null ? null : String(Number.parseInt(chainId, 16));
        break;
      }
      case "accountsChanged": {
        const accounts = Array.isArray(event.payload) ? event.payload : [];
        provider.selectedAddress = typeof accounts[0] === "string" ? accounts[0] : null;
        break;
      }
      case "connect": {
        const payload = event.payload as { chainId?: unknown } | null;
        if (payload && typeof payload.chainId === "string") {
          provider.chainId = payload.chainId;
          provider.networkVersion = String(Number.parseInt(payload.chainId, 16));
        }
        break;
      }
      case "disconnect": {
        provider.selectedAddress = null;
        break;
      }
      default:
        break;
    }
    emitLocal(event.event, event.payload);
  };

  return { provider, emit };
}

/**
 * Install the provider on `window` and wire EIP-6963.
 *
 * Announces immediately *and* on every `eip6963:requestProvider`. The second
 * half is what makes late installation safe: a dapp that already ran its
 * discovery re-requests, and we answer.
 */
export function installWeb3InpageProvider(
  target: Web3InpageWindow,
  options: Web3InpageOptions,
): Web3InpageHandle {
  const { provider, emit } = createWeb3InpageProvider(options);
  const info = Object.freeze({ ...WEB3_PROVIDER_INFO, uuid: options.uuid, icon: options.icon });
  const detail = Object.freeze({ info, provider });

  const announce = (): void => {
    try {
      target.dispatchEvent(new target.CustomEvent("eip6963:announceProvider", { detail }));
    } catch {
      // A page that has broken CustomEvent still gets window.ethereum.
    }
  };

  const onRequestProvider = (): void => {
    announce();
  };

  try {
    target.ethereum = provider;
  } catch {
    // Some pages define a non-configurable `ethereum`; EIP-6963 still works.
  }

  target.addEventListener("eip6963:requestProvider", onRequestProvider);
  announce();

  return {
    provider,
    emit,
    announce,
    uninstall: () => {
      target.removeEventListener?.("eip6963:requestProvider", onRequestProvider);
      if (target.ethereum === provider) {
        try {
          delete target.ethereum;
        } catch {
          target.ethereum = undefined;
        }
      }
      provider.removeAllListeners();
    },
  };
}
