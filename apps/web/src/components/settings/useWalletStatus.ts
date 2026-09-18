/**
 * Preview wallet status, shared across every consumer.
 *
 * One module-level snapshot and one IPC subscription feed both the Web3
 * settings page and the preview toolbar chip — the same shape `useSettings.ts`
 * uses, so a second consumer does not mean a second subscription.
 *
 * Returns `null` on the web build, where there is no preview and no wallet.
 */
import type { Web3WalletStatus } from "@t3tools/web3/schema";
import { useCallback, useSyncExternalStore } from "react";

import { previewBridge } from "../preview/previewBridge";

type Listener = () => void;

let snapshot: Web3WalletStatus | null = null;
const listeners = new Set<Listener>();
let unsubscribeBridge: (() => void) | null = null;

const emit = (): void => {
  for (const listener of Array.from(listeners)) listener();
};

const setSnapshot = (next: Web3WalletStatus | null): void => {
  snapshot = next;
  emit();
};

const walletBridge = () => previewBridge?.wallet ?? null;

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  const bridge = walletBridge();
  if (bridge && unsubscribeBridge === null) {
    unsubscribeBridge = bridge.onStateChange((state) => {
      setSnapshot(state.status);
    });
    // Seed the snapshot; state pushes only arrive when something changes.
    void bridge.status().then(setSnapshot);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeBridge !== null) {
      unsubscribeBridge();
      unsubscribeBridge = null;
    }
  };
};

const getSnapshot = (): Web3WalletStatus | null => snapshot;

export function useWalletStatus(): {
  readonly status: Web3WalletStatus | null;
  readonly refresh: () => Promise<void>;
} {
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const refresh = useCallback(async () => {
    const bridge = walletBridge();
    if (!bridge) return;
    setSnapshot(await bridge.status());
  }, []);
  return { status, refresh };
}

/** Non-React read, for code paths outside a component. */
export function getWalletStatus(): Web3WalletStatus | null {
  return snapshot;
}
