import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentProviderSubscriptionUsageStatus } from "./providerSubscriptionUsage";
import {
  connectedProviderUsageEnvironmentIds,
  newlyConnectedProviderUsageEnvironmentIds,
  providerUsageEnvironmentIdsWithChangedInstances,
  providerUsageRefreshIntervalMs,
  shouldCatchUpProviderUsage,
} from "./providerSubscriptionUsageScheduling";

const environment = (
  id: string,
  connectionPhase: EnvironmentProviderSubscriptionUsageStatus["connectionPhase"],
): EnvironmentProviderSubscriptionUsageStatus => ({
  environmentId: EnvironmentId.make(id),
  label: id,
  connectionPhase,
  providerInstancesKey: connectionPhase === "connected" ? "[]" : null,
  isPending: false,
  error: connectionPhase === "connected" ? null : "offline",
  report: null,
});

describe("provider subscription usage scheduling", () => {
  it.each([
    [null, null],
    [5, 300_000],
    [15, 900_000],
    [30, 1_800_000],
    [60, 3_600_000],
  ] as const)("maps the %s minute polling preset", (minutes, milliseconds) => {
    expect(providerUsageRefreshIntervalMs(minutes)).toBe(milliseconds);
  });

  it("refreshes each environment when it first connects or reconnects", () => {
    const local = environment("local", "connected");
    const remoteOffline = environment("remote", "offline");
    const initial = newlyConnectedProviderUsageEnvironmentIds([local, remoteOffline], new Set());
    expect([...initial]).toEqual([EnvironmentId.make("local")]);

    const connectedBeforeReconnect = connectedProviderUsageEnvironmentIds([local, remoteOffline]);
    const afterReconnect = newlyConnectedProviderUsageEnvironmentIds(
      [local, environment("remote", "connected")],
      connectedBeforeReconnect,
    );
    expect([...afterReconnect]).toEqual([EnvironmentId.make("remote")]);
  });

  it("refreshes a connected environment when its enabled provider instances change", () => {
    const local = environment("local", "connected");
    const previous = new Map([[EnvironmentId.make("local"), "[]"]]);
    const changed = {
      ...local,
      providerInstancesKey: '[["cursor","cursor"]]',
    };

    expect([...providerUsageEnvironmentIdsWithChangedInstances([local], previous)]).toEqual([]);
    expect([...providerUsageEnvironmentIdsWithChangedInstances([changed], previous)]).toEqual([
      EnvironmentId.make("local"),
    ]);
  });

  it("catches up only when a visible client is stale and polling is enabled", () => {
    expect(
      shouldCatchUpProviderUsage({
        intervalMs: 300_000,
        lastRefreshAt: 100,
        now: 300_100,
        visible: true,
      }),
    ).toBe(true);
    expect(
      shouldCatchUpProviderUsage({
        intervalMs: null,
        lastRefreshAt: 0,
        now: 1_000_000,
        visible: true,
      }),
    ).toBe(false);
    expect(
      shouldCatchUpProviderUsage({
        intervalMs: 300_000,
        lastRefreshAt: 0,
        now: 1_000_000,
        visible: false,
      }),
    ).toBe(false);
  });
});
