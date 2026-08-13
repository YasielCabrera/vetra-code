/**
 * Blocks pointer events on hosted preview webviews while a renderer overlay
 * (the wallet popover) is open over them.
 *
 * Electron `<webview>` is a native guest: CSS z-index does not stop it from
 * receiving the same click as the HTML overlay. That click dismisses the
 * dapp's own modal and the wallet action never completes. `pointer-events:
 * none` on the webview is the reliable fix.
 *
 * Release waits until the current pointer gesture ends, so closing on
 * pointerdown does not let the matching pointerup fall through into the page.
 */
import { useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
const activePointers = new Set<number>();

let holds = 0;
let pendingReleases = 0;
let tracking = false;

const emit = (): void => {
  for (const listener of Array.from(listeners)) listener();
};

const onPointerDown = (event: PointerEvent): void => {
  activePointers.add(event.pointerId);
};

const onPointerUp = (event: PointerEvent): void => {
  activePointers.delete(event.pointerId);
  flushPendingReleases();
};

const getWindow = (): Window | null => (typeof window === "undefined" ? null : window);

const startTracking = (): void => {
  if (tracking) return;
  const target = getWindow();
  if (target === null) return;
  tracking = true;
  target.addEventListener("pointerdown", onPointerDown, true);
  target.addEventListener("pointerup", onPointerUp, true);
  target.addEventListener("pointercancel", onPointerUp, true);
};

const stopTracking = (): void => {
  if (holds > 0 || pendingReleases > 0) return;
  const target = getWindow();
  tracking = false;
  activePointers.clear();
  if (target === null) return;
  target.removeEventListener("pointerdown", onPointerDown, true);
  target.removeEventListener("pointerup", onPointerUp, true);
  target.removeEventListener("pointercancel", onPointerUp, true);
};

/** Test seam: the unit project has no `window` to dispatch pointer events on. */
export function noteHostedBrowserPointerDown(pointerId: number): void {
  activePointers.add(pointerId);
}

export function noteHostedBrowserPointerUp(pointerId: number): void {
  activePointers.delete(pointerId);
  flushPendingReleases();
}

const flushPendingReleases = (): void => {
  if (pendingReleases === 0 || activePointers.size > 0) return;
  holds = Math.max(0, holds - pendingReleases);
  pendingReleases = 0;
  emit();
  stopTracking();
};

export function isHostedBrowserPointerLocked(): boolean {
  return holds > 0;
}

export function acquireHostedBrowserPointerLock(): () => void {
  holds += 1;
  startTracking();
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingReleases += 1;
    flushPendingReleases();
  };
}

export function resetHostedBrowserPointerLock(): void {
  holds = 0;
  pendingReleases = 0;
  stopTracking();
  emit();
}

export function useHostedBrowserPointerLocked(): boolean {
  return useSyncExternalStore(
    (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isHostedBrowserPointerLocked,
    isHostedBrowserPointerLocked,
  );
}
