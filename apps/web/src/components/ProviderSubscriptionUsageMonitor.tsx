import type { EnvironmentId } from "@vetra-code/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "../hooks/useSettings";
import { useProviderSubscriptionUsage } from "../state/providerSubscriptionUsage";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  connectedProviderUsageEnvironmentIds,
  newlyConnectedProviderUsageEnvironmentIds,
  providerUsageEnvironmentIdsWithChangedInstances,
  providerUsageRefreshIntervalMs,
  shouldCatchUpProviderUsage,
} from "../state/providerSubscriptionUsageScheduling";
import {
  applyProviderUsageAlertCooldown,
  evaluateProviderUsageAlerts,
  pruneProviderUsageAlertEnvironments,
} from "../state/providerUsageAlerts";
import { stackedThreadToast, toastManager } from "./ui/toast";

const reportAlertSignature = (
  report: NonNullable<
    ReturnType<typeof useProviderSubscriptionUsage>["environments"][number]["report"]
  >,
) =>
  JSON.stringify(
    report.instances.map((instance) => [
      instance.instanceId,
      instance.state,
      instance.freshness,
      instance.fetchedAt,
      instance.windows.map((window) => [window.id, window.usedPercent, window.resetsAt]),
    ]),
  );

export function ProviderSubscriptionUsageMonitor() {
  const hydrated = useClientSettingsHydrated();
  return hydrated ? <HydratedProviderSubscriptionUsageMonitor /> : null;
}

function HydratedProviderSubscriptionUsageMonitor() {
  const navigate = useNavigate();
  const { environments } = useProviderSubscriptionUsage();
  const forceRefreshSubscriptionUsage = useAtomCommand(
    serverEnvironment.refreshProviderSubscriptionUsage,
    { reportFailure: false },
  );
  const refreshIntervalMinutes = useClientSettings(
    (settings) => settings.providerUsageRefreshIntervalMinutes,
  );
  const alertsEnabled = useClientSettings((settings) => settings.providerUsageAlertsEnabled);
  const alertMarkers = useClientSettings((settings) => settings.providerUsageAlertTransitions);
  const updateClientSettings = useUpdateClientSettings();
  const previousConnectedRef = useRef<ReadonlySet<EnvironmentId>>(new Set());
  const previousProviderInstancesKeyRef = useRef<ReadonlyMap<EnvironmentId, string | null>>(
    new Map(),
  );
  const lastRefreshAtRef = useRef(0);
  const handledReportSignaturesRef = useRef(new Map<EnvironmentId, string>());
  const refreshNow = useEffectEvent((environmentIds?: ReadonlySet<EnvironmentId>) => {
    lastRefreshAtRef.current = Date.now();
    for (const environment of environments) {
      if (
        environment.connectionPhase !== "connected" ||
        (environmentIds !== undefined && !environmentIds.has(environment.environmentId))
      ) {
        continue;
      }
      void forceRefreshSubscriptionUsage({
        environmentId: environment.environmentId,
        input: { forceRefresh: true },
      });
    }
  });
  const refreshChangedEnvironments = useEffectEvent(() => {
    const connected = connectedProviderUsageEnvironmentIds(environments);
    const newlyConnected = newlyConnectedProviderUsageEnvironmentIds(
      environments,
      previousConnectedRef.current,
    );
    const changedInstances = providerUsageEnvironmentIdsWithChangedInstances(
      environments,
      previousProviderInstancesKeyRef.current,
    );
    previousConnectedRef.current = connected;
    previousProviderInstancesKeyRef.current = new Map(
      environments
        .filter((environment) => environment.connectionPhase === "connected")
        .map((environment) => [environment.environmentId, environment.providerInstancesKey]),
    );
    const refreshIds = new Set([...newlyConnected, ...changedInstances]);
    if (refreshIds.size > 0) refreshNow(refreshIds);
  });
  const connectedKey = environments
    .filter((environment) => environment.connectionPhase === "connected")
    .map((environment) => environment.environmentId)
    .toSorted()
    .join("\u0000");
  const providerInstancesKey = environments
    .filter((environment) => environment.connectionPhase === "connected")
    .map(
      (environment) =>
        `${environment.environmentId}\u0000${environment.providerInstancesKey ?? "unknown"}`,
    )
    .toSorted()
    .join("\u0001");

  useEffect(() => {
    refreshChangedEnvironments();
  }, [connectedKey, providerInstancesKey]);

  useEffect(() => {
    const intervalMs = providerUsageRefreshIntervalMs(refreshIntervalMinutes);
    if (intervalMs === null) return;
    const interval = window.setInterval(() => refreshNow(), intervalMs);
    const catchUpWhenVisible = () => {
      if (
        shouldCatchUpProviderUsage({
          intervalMs,
          lastRefreshAt: lastRefreshAtRef.current,
          now: Date.now(),
          visible: document.visibilityState === "visible",
        })
      ) {
        refreshNow();
      }
    };
    document.addEventListener("visibilitychange", catchUpWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", catchUpWhenVisible);
    };
  }, [refreshIntervalMinutes]);

  useEffect(() => {
    if (!alertsEnabled) return;
    let markers = alertMarkers;
    let changed = false;

    for (const environment of environments) {
      if (!environment.report) continue;
      const signature = reportAlertSignature(environment.report);
      if (handledReportSignaturesRef.current.get(environment.environmentId) === signature) {
        continue;
      }
      handledReportSignaturesRef.current.set(environment.environmentId, signature);
      const evaluation = evaluateProviderUsageAlerts({
        environmentId: environment.environmentId,
        report: environment.report,
        markers,
      });
      markers = evaluation.markers;
      changed ||= evaluation.changed;

      for (const group of evaluation.groups) {
        const markersBeforeCooldown = markers;
        const cooldown = applyProviderUsageAlertCooldown({
          markers,
          instanceId: group.instanceId,
          now: Date.now(),
        });
        markers = cooldown.markers;
        changed ||= markers !== markersBeforeCooldown;
        if (!cooldown.shouldNotify) continue;

        const windows = new Intl.ListFormat("en", { style: "short", type: "conjunction" }).format(
          group.windowLabels,
        );
        toastManager.add(
          stackedThreadToast({
            type: group.kind === "low" ? "warning" : "success",
            title:
              group.kind === "low"
                ? `${group.displayName} is near its limit`
                : `${group.displayName} usage restored`,
            description:
              group.kind === "low"
                ? `${windows} has 5% or less remaining on ${environment.label}.`
                : `${windows} is available again on ${environment.label}.`,
            actionVariant: "outline",
            actionProps: {
              children: "View usage",
              onClick: () => void navigate({ to: "/usage" }),
            },
          }),
        );
      }
    }

    // Instance-level pruning only reaches environments that reported, so retire
    // whole environments here. Skipped while the catalog is empty, since a boot
    // before environments load would otherwise erase every marker.
    if (environments.length > 0) {
      const retained = pruneProviderUsageAlertEnvironments(
        markers,
        new Set(environments.map((environment) => environment.environmentId)),
      );
      if (retained !== markers) {
        markers = retained;
        changed = true;
      }
    }

    if (changed) {
      updateClientSettings({ providerUsageAlertTransitions: markers });
    }
  }, [alertMarkers, alertsEnabled, environments, navigate, updateClientSettings]);

  return null;
}
