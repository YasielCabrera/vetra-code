import type { ReactElement } from "react";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageReport,
} from "@t3tools/contracts";
import type { ClientSettingsPatch } from "@t3tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentProviderSubscriptionUsageStatus } from "../state/providerSubscriptionUsage";
import type { ProviderUsageAlertMarkers } from "../state/providerUsageAlerts";

type TestSettings = {
  providerUsageRefreshIntervalMinutes: 5;
  providerUsageAlertsEnabled: boolean;
  providerUsageAlertTransitions: ProviderUsageAlertMarkers;
};

const testState = vi.hoisted(() => ({
  environments: [] as EnvironmentProviderSubscriptionUsageStatus[],
  forceRefresh: vi.fn(),
  updateClientSettings: vi.fn<(patch: ClientSettingsPatch) => void>(),
  settings: {
    providerUsageRefreshIntervalMinutes: 5 as const,
    providerUsageAlertsEnabled: false,
    providerUsageAlertTransitions: {},
  } as TestSettings,
}));

const toastMocks = vi.hoisted(() => ({
  add: vi.fn(),
  stackedThreadToast: vi.fn((input: unknown) => input),
}));

const hooks = vi.hoisted(() => {
  type Cleanup = () => void;
  type EffectSlot = {
    readonly kind: "effect";
    readonly dependencies: readonly unknown[] | undefined;
    readonly cleanup: Cleanup | undefined;
  };
  type EventSlot = {
    readonly kind: "event";
    readonly callback: { current: (...arguments_: never[]) => unknown };
  };
  type MemoSlot = { readonly kind: "memo"; readonly values: unknown[] };
  type RefSlot = { readonly kind: "ref"; readonly value: { current: unknown } };
  type HookSlot = EffectSlot | EventSlot | MemoSlot | RefSlot;

  const componentSlots = new Map<string, HookSlot[]>();
  let slots: HookSlot[] = [];
  let cursor = 0;
  let pendingEffects: Array<() => void> = [];

  const nextIndex = () => cursor++;
  const sameDependencies = (
    left: readonly unknown[] | undefined,
    right: readonly unknown[] | undefined,
  ): boolean =>
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));

  return {
    beginRender(component: string) {
      slots = componentSlots.get(component) ?? [];
      componentSlots.set(component, slots);
      cursor = 0;
      pendingEffects = [];
    },
    commit() {
      const effects = pendingEffects;
      pendingEffects = [];
      for (const effect of effects) effect();
    },
    reset() {
      componentSlots.clear();
      slots = [];
      cursor = 0;
      pendingEffects = [];
    },
    unmount() {
      for (const entries of componentSlots.values()) {
        for (const slot of entries) {
          if (slot?.kind === "effect") slot.cleanup?.();
        }
      }
      componentSlots.clear();
    },
    useEffect(create: () => void | Cleanup, dependencies?: readonly unknown[]): void {
      const index = nextIndex();
      const previous = slots[index];
      if (previous?.kind === "effect" && sameDependencies(previous.dependencies, dependencies)) {
        return;
      }
      pendingEffects.push(() => {
        if (previous?.kind === "effect") previous.cleanup?.();
        const cleanup = create();
        slots[index] = {
          kind: "effect",
          dependencies: dependencies === undefined ? undefined : [...dependencies],
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      });
    },
    useEffectEvent<T extends (...arguments_: never[]) => unknown>(callback: T): T {
      const index = nextIndex();
      const previous = slots[index];
      const callbackRef = previous?.kind === "event" ? previous.callback : { current: callback };
      callbackRef.current = callback;
      slots[index] = { kind: "event", callback: callbackRef };

      // React returns a fresh wrapper on updates. The test deliberately mirrors
      // that behavior so an Effect Event in an effect dependency restarts it.
      return ((...arguments_: never[]) => callbackRef.current(...arguments_)) as T;
    },
    useMemoCache(size: number): unknown[] {
      const index = nextIndex();
      const previous = slots[index];
      if (previous?.kind === "memo") return previous.values;
      const values = Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel"));
      slots[index] = { kind: "memo", values };
      return values;
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = nextIndex();
      const previous = slots[index];
      if (previous?.kind === "ref") return previous.value as { current: T };
      const value = { current: initialValue };
      slots[index] = { kind: "ref", value };
      return value;
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: hooks.useEffect,
    useEffectEvent: hooks.useEffectEvent,
    useRef: hooks.useRef,
  };
});

vi.mock("react/compiler-runtime", () => ({ c: hooks.useMemoCache }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof testState.settings) => unknown) =>
    select(testState.settings),
  useClientSettingsHydrated: () => true,
  useUpdateClientSettings: () => testState.updateClientSettings,
}));

vi.mock("../state/providerSubscriptionUsage", () => ({
  useProviderSubscriptionUsage: () => ({ environments: testState.environments }),
}));

vi.mock("../state/server", () => ({
  serverEnvironment: { refreshProviderSubscriptionUsage: Symbol("refresh-subscription-usage") },
}));

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => testState.forceRefresh,
}));

vi.mock("./ui/toast", () => ({
  stackedThreadToast: toastMocks.stackedThreadToast,
  toastManager: { add: toastMocks.add },
}));

import { ProviderSubscriptionUsageMonitor } from "./ProviderSubscriptionUsageMonitor";

const environmentId = EnvironmentId.make("local");

const connectedEnvironment = (): EnvironmentProviderSubscriptionUsageStatus => ({
  environmentId,
  label: "Local",
  connectionPhase: "connected",
  providerInstancesKey: "[]",
  isPending: false,
  error: null,
  report: null,
});

const lowUsageReport = (cycle: number): ProviderSubscriptionUsageReport => ({
  contractVersion: 1,
  readAt: `2026-08-19T12:0${cycle}:00.000Z`,
  instances: [
    {
      instanceId: ProviderInstanceId.make("claude"),
      driver: ProviderDriverKind.make("claude"),
      displayName: "Claude",
      state: "ready",
      freshness: "fresh",
      fetchedAt: `2026-08-19T12:0${cycle}:00.000Z`,
      source: "provider-cli",
      windows: [
        {
          id: "session",
          label: "Session",
          usedPercent: 96 + cycle,
          resetsAt: `2026-08-${20 + cycle}T12:00:00.000Z`,
        },
      ],
      details: [],
    },
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      state: "ready",
      freshness: "fresh",
      fetchedAt: `2026-08-19T12:0${cycle}:00.000Z`,
      source: "provider-cli",
      windows: [
        {
          id: "session",
          label: "Session",
          usedPercent: 96 + cycle,
          resetsAt: `2026-08-${20 + cycle}T12:00:00.000Z`,
        },
      ],
      details: [],
    },
  ],
});

const installBrowserTimers = () => {
  const listeners = new Map<string, Set<EventListener>>();
  vi.stubGlobal("window", {
    setInterval: (callback: TimerHandler, delay?: number) =>
      globalThis.setInterval(callback, delay),
    clearInterval: (interval: ReturnType<typeof globalThis.setInterval>) =>
      globalThis.clearInterval(interval),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: (type: string, listener: EventListener) => {
      const registered = listeners.get(type) ?? new Set<EventListener>();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
  });
};

const hydratedMonitor = () => {
  hooks.beginRender("outer");
  const element = ProviderSubscriptionUsageMonitor() as ReactElement;
  hooks.commit();
  return element.type as () => null;
};

const renderMonitor = (Monitor: () => null) => {
  hooks.beginRender("monitor");
  Monitor();
  hooks.commit();
};

describe("ProviderSubscriptionUsageMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
    installBrowserTimers();
    hooks.reset();
    testState.forceRefresh.mockReset();
    testState.updateClientSettings.mockReset();
    testState.updateClientSettings.mockImplementation((patch) => {
      testState.settings = { ...testState.settings, ...patch } as TestSettings;
    });
    toastMocks.add.mockReset();
    toastMocks.stackedThreadToast.mockClear();
    testState.settings = {
      providerUsageRefreshIntervalMinutes: 5,
      providerUsageAlertsEnabled: false,
      providerUsageAlertTransitions: {},
    };
    testState.environments = [connectedEnvironment()];
  });

  afterEach(() => {
    hooks.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the configured interval through continuous navigation-style renders", () => {
    const Monitor = hydratedMonitor();
    renderMonitor(Monitor);

    // The initial connection is refreshed immediately; isolate the scheduled call.
    expect(testState.forceRefresh).toHaveBeenCalledTimes(1);
    testState.forceRefresh.mockClear();

    for (let elapsed = 10_000; elapsed <= 290_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000);
      testState.environments = [{ ...connectedEnvironment() }];
      renderMonitor(Monitor);
    }

    vi.advanceTimersByTime(10_000 - 1);
    testState.environments = [{ ...connectedEnvironment() }];
    renderMonitor(Monitor);
    expect(testState.forceRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(testState.forceRefresh).toHaveBeenCalledTimes(1);
    expect(testState.forceRefresh).toHaveBeenCalledWith({
      environmentId,
      input: { forceRefresh: true },
    });
  });

  it("refreshes changed provider instances without moving the periodic deadline", () => {
    const Monitor = hydratedMonitor();
    renderMonitor(Monitor);
    testState.forceRefresh.mockClear();

    vi.advanceTimersByTime(4 * 60_000);
    testState.environments = [
      {
        ...connectedEnvironment(),
        providerInstancesKey: '[["claude","claude"]]',
      },
    ];
    renderMonitor(Monitor);

    expect(testState.forceRefresh).toHaveBeenCalledTimes(1);
    expect(testState.forceRefresh).toHaveBeenLastCalledWith({
      environmentId,
      input: { forceRefresh: true },
    });
    testState.forceRefresh.mockClear();

    vi.advanceTimersByTime(60_000 - 1);
    expect(testState.forceRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(testState.forceRefresh).toHaveBeenCalledTimes(1);
    expect(testState.forceRefresh).toHaveBeenLastCalledWith({
      environmentId,
      input: { forceRefresh: true },
    });
  });

  it("waits 10 minutes before showing another usage alert for each provider", () => {
    testState.settings.providerUsageAlertsEnabled = true;
    testState.environments = [{ ...connectedEnvironment(), report: lowUsageReport(0) }];
    const Monitor = hydratedMonitor();
    renderMonitor(Monitor);

    expect(toastMocks.add).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5 * 60_000);
    testState.environments = [{ ...connectedEnvironment(), report: lowUsageReport(1) }];
    renderMonitor(Monitor);
    expect(toastMocks.add).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5 * 60_000);
    testState.environments = [{ ...connectedEnvironment(), report: lowUsageReport(2) }];
    renderMonitor(Monitor);
    expect(toastMocks.add).toHaveBeenCalledTimes(4);
  });
});
