import type { EnvironmentId, ProviderUsageRefreshIntervalMinutes } from "@t3tools/contracts";

import type { EnvironmentProviderSubscriptionUsageStatus } from "./providerSubscriptionUsage";

export const providerUsageRefreshIntervalMs = (
  minutes: ProviderUsageRefreshIntervalMinutes,
): number | null => (minutes === null ? null : minutes * 60_000);

export const connectedProviderUsageEnvironmentIds = (
  environments: readonly EnvironmentProviderSubscriptionUsageStatus[],
): ReadonlySet<EnvironmentId> =>
  new Set(
    environments
      .filter((environment) => environment.connectionPhase === "connected")
      .map((environment) => environment.environmentId),
  );

export const newlyConnectedProviderUsageEnvironmentIds = (
  environments: readonly EnvironmentProviderSubscriptionUsageStatus[],
  previouslyConnected: ReadonlySet<EnvironmentId>,
): ReadonlySet<EnvironmentId> =>
  new Set(
    [...connectedProviderUsageEnvironmentIds(environments)].filter(
      (environmentId) => !previouslyConnected.has(environmentId),
    ),
  );

export const providerUsageEnvironmentIdsWithChangedInstances = (
  environments: readonly EnvironmentProviderSubscriptionUsageStatus[],
  previousKeys: ReadonlyMap<EnvironmentId, string | null>,
): ReadonlySet<EnvironmentId> =>
  new Set(
    environments
      .filter(
        (environment) =>
          environment.connectionPhase === "connected" &&
          previousKeys.has(environment.environmentId) &&
          previousKeys.get(environment.environmentId) !== environment.providerInstancesKey,
      )
      .map((environment) => environment.environmentId),
  );

export const shouldCatchUpProviderUsage = (input: {
  readonly intervalMs: number | null;
  readonly lastRefreshAt: number;
  readonly now: number;
  readonly visible: boolean;
}): boolean =>
  input.visible && input.intervalMs !== null && input.now - input.lastRefreshAt >= input.intervalMs;
