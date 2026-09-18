import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderSubscriptionUsageReport,
  ProviderUsageAlertTransitionMarker,
} from "@t3tools/contracts";

export type ProviderUsageAlertMarkers = Readonly<
  Record<string, ProviderUsageAlertTransitionMarker>
>;

export interface ProviderUsageAlertGroup {
  readonly kind: "low" | "restored";
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly windowLabels: readonly string[];
}

export interface ProviderUsageAlertEvaluation {
  readonly markers: ProviderUsageAlertMarkers;
  readonly groups: readonly ProviderUsageAlertGroup[];
  readonly changed: boolean;
}

export const PROVIDER_USAGE_ALERT_COOLDOWN_MS = 10 * 60_000;

export const providerUsageAlertMarkerKey = (
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
  windowId: string,
): string => JSON.stringify([environmentId, instanceId, windowId]);

/**
 * Reads back {@link providerUsageAlertMarkerKey}. This module owns every key in
 * the record, so a key that no longer decodes is corruption or a superseded
 * format and is retired rather than retained forever.
 */
const parsedMarkerKey = (
  key: string,
): { readonly environmentId: string; readonly instanceId: string } | undefined => {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
    const [environmentId, instanceId] = parsed as readonly unknown[];
    if (typeof environmentId !== "string" || typeof instanceId !== "string") return undefined;
    return { environmentId, instanceId };
  } catch {
    return undefined;
  }
};

/**
 * Applies one device-local cooldown across every environment that reports the
 * same provider instance ID. The timestamp lives on existing window markers,
 * so normal marker pruning also bounds cooldown state.
 */
export function applyProviderUsageAlertCooldown(input: {
  readonly markers: ProviderUsageAlertMarkers;
  readonly instanceId: ProviderInstanceId;
  readonly now: number;
}): { readonly markers: ProviderUsageAlertMarkers; readonly shouldNotify: boolean } {
  const matchingKeys: string[] = [];
  let lastNotifiedAt: number | undefined;

  for (const [key, marker] of Object.entries(input.markers)) {
    const parsed = parsedMarkerKey(key);
    if (parsed?.instanceId !== input.instanceId) continue;
    matchingKeys.push(key);
    if (marker.lastNotifiedAt !== undefined) {
      lastNotifiedAt = Math.max(lastNotifiedAt ?? marker.lastNotifiedAt, marker.lastNotifiedAt);
    }
  }

  const elapsed = lastNotifiedAt === undefined ? undefined : input.now - lastNotifiedAt;
  if (elapsed !== undefined && elapsed >= 0 && elapsed < PROVIDER_USAGE_ALERT_COOLDOWN_MS) {
    return { markers: input.markers, shouldNotify: false };
  }

  if (matchingKeys.length === 0) {
    return { markers: input.markers, shouldNotify: true };
  }

  const next = { ...input.markers };
  for (const key of matchingKeys) {
    const marker = next[key];
    if (marker) next[key] = { ...marker, lastNotifiedAt: input.now };
  }
  return { markers: next, shouldNotify: true };
}

/**
 * Retires markers for environments the client no longer knows about. Callers
 * must skip this while the environment catalog is empty: a disconnected
 * environment is still listed, so only a removed one disappears from it.
 *
 * Returns the original record when nothing was dropped so callers can skip the
 * settings write on identity.
 */
export function pruneProviderUsageAlertEnvironments(
  markers: ProviderUsageAlertMarkers,
  knownEnvironmentIds: ReadonlySet<string>,
): ProviderUsageAlertMarkers {
  const retained: Record<string, ProviderUsageAlertTransitionMarker> = {};
  let dropped = false;
  for (const [key, marker] of Object.entries(markers)) {
    const parsed = parsedMarkerKey(key);
    if (parsed !== undefined && knownEnvironmentIds.has(parsed.environmentId)) {
      retained[key] = marker;
      continue;
    }
    dropped = true;
  }
  return dropped ? retained : markers;
}

const sameMarker = (
  left: ProviderUsageAlertTransitionMarker | undefined,
  right: ProviderUsageAlertTransitionMarker,
) =>
  left !== undefined &&
  left.cycleKey === right.cycleKey &&
  left.lowNotified === right.lowNotified &&
  left.exhausted === right.exhausted &&
  left.restorationNotified === right.restorationNotified &&
  left.lastUsedPercent === right.lastUsedPercent &&
  left.lastNotifiedAt === right.lastNotifiedAt;

/**
 * Advances alert transitions only from fresh, successful provider snapshots.
 * Provider reset timestamps define cycles. When a provider omits them, a
 * recovery from the low/exhausted range is the only safe reset signal.
 *
 * Also retires this environment's markers for provider instances the report no
 * longer lists, which is what keeps the persisted record bounded as instances
 * come and go.
 */
export function evaluateProviderUsageAlerts(input: {
  readonly environmentId: EnvironmentId;
  readonly report: ProviderSubscriptionUsageReport;
  readonly markers: ProviderUsageAlertMarkers;
}): ProviderUsageAlertEvaluation {
  let changed = false;
  // Instance presence, not window presence, is the deletion signal: a needs-auth
  // or error instance reports zero windows, so pruning by window would discard
  // transition state on a temporary failure and re-alert on recovery.
  const reportedInstanceIds = new Set<string>(
    input.report.instances.map((instance) => instance.instanceId),
  );
  const next: Record<string, ProviderUsageAlertTransitionMarker> = {};
  for (const [key, marker] of Object.entries(input.markers)) {
    const parsed = parsedMarkerKey(key);
    const retained =
      parsed !== undefined &&
      (parsed.environmentId !== input.environmentId || reportedInstanceIds.has(parsed.instanceId));
    if (retained) next[key] = marker;
    else changed = true;
  }
  const grouped = new Map<
    string,
    {
      kind: "low" | "restored";
      instanceId: ProviderInstanceId;
      displayName: string;
      windowLabels: string[];
    }
  >();

  const addGroup = (
    kind: "low" | "restored",
    instanceId: ProviderInstanceId,
    displayName: string,
    label: string,
  ) => {
    const key = `${instanceId}:${kind}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.windowLabels.push(label);
      return;
    }
    grouped.set(key, { kind, instanceId, displayName, windowLabels: [label] });
  };

  for (const instance of input.report.instances) {
    if (instance.state !== "ready" || instance.freshness !== "fresh") continue;

    for (const window of instance.windows) {
      const key = providerUsageAlertMarkerKey(input.environmentId, instance.instanceId, window.id);
      const previous = input.markers[key];
      let cycleKey = window.resetsAt ?? previous?.cycleKey ?? "provider-reset-unknown";
      const recoveredWithoutReset =
        window.resetsAt === undefined &&
        previous !== undefined &&
        ((previous.exhausted && window.usedPercent < 100) ||
          (previous.lastUsedPercent >= 95 && window.usedPercent < 95));
      if (recoveredWithoutReset) {
        cycleKey = `observed-reset:${instance.fetchedAt}`;
      }
      const cycleChanged = previous !== undefined && previous.cycleKey !== cycleKey;
      const exhausted = window.usedPercent >= 100;
      const low = window.usedPercent >= 95;
      const restored =
        previous?.exhausted === true &&
        !exhausted &&
        (cycleChanged || !previous.restorationNotified);
      let lowNotified = cycleChanged ? false : (previous?.lowNotified ?? false);
      let restorationNotified = cycleChanged ? false : (previous?.restorationNotified ?? false);

      if (restored) {
        restorationNotified = true;
        addGroup("restored", instance.instanceId, instance.displayName, window.label);
      }
      if (low && !lowNotified) {
        lowNotified = true;
        addGroup("low", instance.instanceId, instance.displayName, window.label);
      }

      const marker: ProviderUsageAlertTransitionMarker = {
        cycleKey,
        lowNotified,
        exhausted,
        restorationNotified,
        lastUsedPercent: window.usedPercent,
        ...(previous?.lastNotifiedAt !== undefined
          ? { lastNotifiedAt: previous.lastNotifiedAt }
          : {}),
      };
      if (!sameMarker(previous, marker)) {
        next[key] = marker;
        changed = true;
      }
    }
  }

  return {
    markers: changed ? next : input.markers,
    groups: [...grouped.values()],
    changed,
  };
}
