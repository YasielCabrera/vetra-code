import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageReport,
} from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyProviderUsageAlertCooldown,
  evaluateProviderUsageAlerts,
  PROVIDER_USAGE_ALERT_COOLDOWN_MS,
  providerUsageAlertMarkerKey,
  pruneProviderUsageAlertEnvironments,
  type ProviderUsageAlertMarkers,
} from "./providerUsageAlerts";

const environmentId = EnvironmentId.make("environment-local");
const instanceId = ProviderInstanceId.make("codex-work");

const report = (input: {
  readonly usedPercent: number;
  readonly freshness?: "fresh" | "stale";
  readonly resetsAt?: string;
  readonly state?: "ready" | "error";
  readonly instance?: string;
  readonly windowId?: string;
  readonly windowLabel?: string;
}): ProviderSubscriptionUsageReport => {
  const id = ProviderInstanceId.make(input.instance ?? instanceId);
  const state = input.state ?? "ready";
  const instance =
    state === "ready"
      ? {
          instanceId: id,
          driver: ProviderDriverKind.make("codex"),
          displayName: id === instanceId ? "Codex Work" : id,
          state,
          freshness: input.freshness ?? "fresh",
          fetchedAt: "2026-08-13T11:59:00.000Z",
          source: "provider-cli" as const,
          windows: [
            {
              id: input.windowId ?? "weekly",
              label: input.windowLabel ?? "Weekly",
              usedPercent: input.usedPercent,
              ...(input.resetsAt ? { resetsAt: input.resetsAt } : {}),
            },
          ],
          details: [],
        }
      : {
          instanceId: id,
          driver: ProviderDriverKind.make("codex"),
          displayName: id === instanceId ? "Codex Work" : id,
          state,
          message: "Unavailable",
          windows: [],
          details: [],
        };
  return {
    contractVersion: 1,
    readAt: "2026-08-13T12:00:00.000Z",
    instances: [instance],
  };
};

const evaluate = (
  usage: ProviderSubscriptionUsageReport,
  markers: ProviderUsageAlertMarkers = {},
  environment = environmentId,
) => evaluateProviderUsageAlerts({ environmentId: environment, report: usage, markers });

describe("evaluateProviderUsageAlerts", () => {
  it("alerts on an initially observed low window only once in its reset cycle", () => {
    const first = evaluate(report({ usedPercent: 96, resetsAt: "2026-08-20T12:00:00.000Z" }));
    expect(first.groups).toEqual([
      {
        kind: "low",
        instanceId,
        displayName: "Codex Work",
        windowLabels: ["Weekly"],
      },
    ]);

    const repeated = evaluate(
      report({ usedPercent: 99, resetsAt: "2026-08-20T12:00:00.000Z" }),
      first.markers,
    );
    expect(repeated.groups).toEqual([]);
    expect(
      repeated.markers[providerUsageAlertMarkerKey(environmentId, instanceId, "weekly")]
        ?.lastUsedPercent,
    ).toBe(99);
  });

  it("starts a new low transition when the provider reset cycle changes", () => {
    const first = evaluate(report({ usedPercent: 97, resetsAt: "2026-08-20T12:00:00.000Z" }));
    const nextCycle = evaluate(
      report({ usedPercent: 95, resetsAt: "2026-08-27T12:00:00.000Z" }),
      first.markers,
    );
    expect(nextCycle.groups.map((group) => group.kind)).toEqual(["low"]);
  });

  it("emits one restoration after a previously exhausted window becomes available", () => {
    const exhausted = evaluate(report({ usedPercent: 100, resetsAt: "2026-08-20T12:00:00.000Z" }));
    const restored = evaluate(
      report({ usedPercent: 8, resetsAt: "2026-08-27T12:00:00.000Z" }),
      exhausted.markers,
    );
    expect(restored.groups).toEqual([
      {
        kind: "restored",
        instanceId,
        displayName: "Codex Work",
        windowLabels: ["Weekly"],
      },
    ]);

    const repeated = evaluate(
      report({ usedPercent: 9, resetsAt: "2026-08-27T12:00:00.000Z" }),
      restored.markers,
    );
    expect(repeated.groups).toEqual([]);
  });

  it("does not advance markers from stale or failed snapshots", () => {
    const markers: ProviderUsageAlertMarkers = {};
    const stale = evaluate(report({ usedPercent: 100, freshness: "stale" }), markers);
    const failed = evaluate(report({ usedPercent: 100, state: "error" }), markers);
    expect(stale).toEqual({ markers, groups: [], changed: false });
    expect(failed).toEqual({ markers, groups: [], changed: false });
  });

  it("groups simultaneous windows by provider instance", () => {
    const usage = report({ usedPercent: 97 });
    const baseInstance = usage.instances[0];
    if (!baseInstance) throw new Error("fixture instance missing");
    const grouped = evaluate({
      ...usage,
      instances: [
        {
          ...baseInstance,
          windows: [
            { id: "five-hour", label: "5-hour", usedPercent: 96 },
            { id: "weekly", label: "Weekly", usedPercent: 100 },
          ],
        },
      ],
    });
    expect(grouped.groups).toEqual([
      {
        kind: "low",
        instanceId,
        displayName: "Codex Work",
        windowLabels: ["5-hour", "Weekly"],
      },
    ]);
  });

  it("keeps transition state separate between environments", () => {
    const local = evaluate(report({ usedPercent: 96 }));
    const remoteEnvironment = EnvironmentId.make("environment-remote");
    const remote = evaluate(report({ usedPercent: 96 }), local.markers, remoteEnvironment);
    expect(remote.groups).toHaveLength(1);
    expect(Object.keys(remote.markers)).toHaveLength(2);
  });

  it("retires markers for a provider instance the report no longer lists", () => {
    const seeded = evaluate(report({ usedPercent: 96 }));
    const remoteEnvironment = EnvironmentId.make("environment-remote");
    const otherEnvironment = evaluate(
      report({ usedPercent: 20 }),
      seeded.markers,
      remoteEnvironment,
    );
    expect(Object.keys(otherEnvironment.markers)).toHaveLength(2);

    const afterDeletion = evaluate(
      report({ usedPercent: 30, instance: "codex-personal" }),
      otherEnvironment.markers,
    );
    expect(afterDeletion.changed).toBe(true);
    expect(
      afterDeletion.markers[providerUsageAlertMarkerKey(environmentId, instanceId, "weekly")],
    ).toBeUndefined();
    // Another environment's state survives a prune it was not part of.
    expect(
      afterDeletion.markers[providerUsageAlertMarkerKey(remoteEnvironment, instanceId, "weekly")],
    ).toBeDefined();
  });

  it("keeps markers while a listed instance reports no windows", () => {
    const seeded = evaluate(report({ usedPercent: 100, resetsAt: "2026-08-20T12:00:00.000Z" }));
    const failing = evaluate(report({ usedPercent: 0, state: "error" }), seeded.markers);

    expect(failing.markers).toEqual(seeded.markers);
    expect(failing.changed).toBe(false);

    // The exhausted marker survived, so recovery still emits exactly one alert.
    const recovered = evaluate(
      report({ usedPercent: 5, resetsAt: "2026-08-27T12:00:00.000Z" }),
      failing.markers,
    );
    expect(recovered.groups.map((group) => group.kind)).toEqual(["restored"]);
  });
});

describe("applyProviderUsageAlertCooldown", () => {
  it("allows one alert per provider instance every 10 minutes", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const seeded = evaluate(report({ usedPercent: 96 })).markers;

    const first = applyProviderUsageAlertCooldown({ markers: seeded, instanceId, now });
    expect(first.shouldNotify).toBe(true);
    expect(
      first.markers[providerUsageAlertMarkerKey(environmentId, instanceId, "weekly")],
    ).toMatchObject({ lastNotifiedAt: now });

    const insideCooldown = applyProviderUsageAlertCooldown({
      markers: first.markers,
      instanceId,
      now: now + PROVIDER_USAGE_ALERT_COOLDOWN_MS - 1,
    });
    expect(insideCooldown).toEqual({ markers: first.markers, shouldNotify: false });

    const afterCooldown = applyProviderUsageAlertCooldown({
      markers: first.markers,
      instanceId,
      now: now + PROVIDER_USAGE_ALERT_COOLDOWN_MS,
    });
    expect(afterCooldown.shouldNotify).toBe(true);
    expect(
      afterCooldown.markers[providerUsageAlertMarkerKey(environmentId, instanceId, "weekly")]
        ?.lastNotifiedAt,
    ).toBe(now + PROVIDER_USAGE_ALERT_COOLDOWN_MS);
  });

  it("shares the cooldown across environments but not provider instances", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const local = evaluate(report({ usedPercent: 96 })).markers;
    const first = applyProviderUsageAlertCooldown({ markers: local, instanceId, now });
    const remoteEnvironment = EnvironmentId.make("environment-remote");
    const remote = evaluate(report({ usedPercent: 96 }), first.markers, remoteEnvironment);

    expect(
      applyProviderUsageAlertCooldown({
        markers: remote.markers,
        instanceId,
        now: now + 60_000,
      }).shouldNotify,
    ).toBe(false);

    const otherInstanceId = ProviderInstanceId.make("claude-personal");
    const withOtherInstance = evaluate(
      report({ usedPercent: 96, instance: otherInstanceId }),
      remote.markers,
    );
    expect(
      applyProviderUsageAlertCooldown({
        markers: withOtherInstance.markers,
        instanceId: otherInstanceId,
        now: now + 60_000,
      }).shouldNotify,
    ).toBe(true);
  });
});

describe("pruneProviderUsageAlertEnvironments", () => {
  it("drops markers for environments the client no longer knows", () => {
    const remoteEnvironment = EnvironmentId.make("environment-remote");
    const local = evaluate(report({ usedPercent: 96 }));
    const both = evaluate(report({ usedPercent: 96 }), local.markers, remoteEnvironment);

    const pruned = pruneProviderUsageAlertEnvironments(both.markers, new Set([environmentId]));
    expect(Object.keys(pruned)).toEqual([
      providerUsageAlertMarkerKey(environmentId, instanceId, "weekly"),
    ]);
  });

  it("returns the same record when every environment is still known", () => {
    const local = evaluate(report({ usedPercent: 96 }));
    expect(pruneProviderUsageAlertEnvironments(local.markers, new Set([environmentId]))).toBe(
      local.markers,
    );
  });

  it("retires keys that no longer decode", () => {
    expect(
      pruneProviderUsageAlertEnvironments(
        {
          "not-a-marker-key": {
            cycleKey: "x",
            lowNotified: true,
            exhausted: false,
            restorationNotified: false,
            lastUsedPercent: 96,
          },
        },
        new Set([environmentId]),
      ),
    ).toEqual({});
  });
});
