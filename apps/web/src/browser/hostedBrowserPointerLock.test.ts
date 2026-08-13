import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  acquireHostedBrowserPointerLock,
  isHostedBrowserPointerLocked,
  noteHostedBrowserPointerDown,
  noteHostedBrowserPointerUp,
  resetHostedBrowserPointerLock,
} from "./hostedBrowserPointerLock";

afterEach(() => {
  resetHostedBrowserPointerLock();
});

describe("hostedBrowserPointerLock", () => {
  it("unlocks immediately when no pointer gesture is in flight", () => {
    const release = acquireHostedBrowserPointerLock();
    expect(isHostedBrowserPointerLocked()).toBe(true);
    release();
    expect(isHostedBrowserPointerLocked()).toBe(false);
  });

  it("stays locked until pointerup when closed mid-gesture", () => {
    const release = acquireHostedBrowserPointerLock();
    noteHostedBrowserPointerDown(1);
    release();
    expect(isHostedBrowserPointerLocked()).toBe(true);
    noteHostedBrowserPointerUp(1);
    expect(isHostedBrowserPointerLocked()).toBe(false);
  });

  it("unlocks immediately after a completed click", () => {
    const release = acquireHostedBrowserPointerLock();
    noteHostedBrowserPointerDown(1);
    noteHostedBrowserPointerUp(1);
    release();
    expect(isHostedBrowserPointerLocked()).toBe(false);
  });

  it("stays locked while another holder is still open", () => {
    const first = acquireHostedBrowserPointerLock();
    const second = acquireHostedBrowserPointerLock();
    first();
    expect(isHostedBrowserPointerLocked()).toBe(true);
    second();
    expect(isHostedBrowserPointerLocked()).toBe(false);
  });
});
