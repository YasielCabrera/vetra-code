import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageReport,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  enabledProviderInstancesKey,
  filterReportToEnabledProviderInstances,
  presentConnectedProviderSubscriptionUsage,
} from "./providerSubscriptionUsage";

const report = (contractVersion: number): ProviderSubscriptionUsageReport => ({
  contractVersion,
  readAt: "2026-08-13T12:00:00.000Z",
  instances: [],
});

describe("presentConnectedProviderSubscriptionUsage", () => {
  it("keeps a supported current report available", () => {
    const current = report(1);
    expect(presentConnectedProviderSubscriptionUsage(AsyncResult.success(current))).toEqual({
      isPending: false,
      error: null,
      report: current,
    });
  });

  it("degrades an old server RPC failure without affecting other usage state", () => {
    expect(
      presentConnectedProviderSubscriptionUsage(
        AsyncResult.failure(Cause.fail(new Error("RPC method not found"))),
      ),
    ).toEqual({ isPending: false, error: "not-supported", report: null });
  });

  it("degrades a future report version locally", () => {
    expect(presentConnectedProviderSubscriptionUsage(AsyncResult.success(report(2)))).toEqual({
      isPending: false,
      error: "contract-version",
      report: null,
    });
  });

  it("keeps an ordinary environment failure distinct from old-server degradation", () => {
    expect(
      presentConnectedProviderSubscriptionUsage(
        AsyncResult.failure(Cause.fail(new Error("Connection interrupted"))),
      ),
    ).toEqual({ isPending: false, error: "error", report: null });
  });
});

describe("provider instance availability", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("cursor"),
      driver: ProviderDriverKind.make("cursor"),
      enabled: true,
    },
    {
      instanceId: ProviderInstanceId.make("grok"),
      driver: ProviderDriverKind.make("grok"),
      enabled: false,
    },
  ];
  const usageReport: ProviderSubscriptionUsageReport = {
    contractVersion: 1,
    readAt: "2026-08-13T12:00:00.000Z",
    instances: [
      {
        instanceId: ProviderInstanceId.make("grok"),
        driver: ProviderDriverKind.make("grok"),
        displayName: "Grok",
        state: "unsupported",
        windows: [],
        details: [],
      },
      {
        instanceId: ProviderInstanceId.make("cursor"),
        driver: ProviderDriverKind.make("cursor"),
        displayName: "Cursor",
        state: "needs-auth",
        windows: [],
        details: [],
      },
    ],
  };

  it("hides cached quota results as soon as their provider instance is disabled", () => {
    expect(
      filterReportToEnabledProviderInstances(usageReport, providers).instances.map(
        (instance) => instance.instanceId,
      ),
    ).toEqual([ProviderInstanceId.make("cursor")]);
  });

  it("keys refreshes only by enabled instance identity", () => {
    expect(enabledProviderInstancesKey(providers)).toBe('[["cursor","cursor"]]');
  });
});
