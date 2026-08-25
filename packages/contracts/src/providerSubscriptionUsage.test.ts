import { describe, expect, it } from "vite-plus/test";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION,
  ProviderSubscriptionCredentialSetInput,
  ProviderSubscriptionUsageReport,
} from "./providerSubscriptionUsage.ts";
import { ClientSettingsSchema } from "./settings.ts";

const decodeReport = Schema.decodeUnknownSync(ProviderSubscriptionUsageReport);
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("ProviderSubscriptionUsageReport", () => {
  it("preserves the version, instance identity, and raw usage above 100 percent", () => {
    const report = decodeReport({
      contractVersion: PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION,
      readAt: "2026-08-13T12:00:00.000Z",
      instances: [
        {
          instanceId: "codex_work",
          driver: "codex",
          displayName: "Codex Work",
          state: "ready",
          freshness: "fresh",
          fetchedAt: "2026-08-13T11:59:00.000Z",
          source: "provider-cli",
          windows: [{ id: "weekly", label: "Weekly", usedPercent: 127.5 }],
          details: [],
        },
      ],
    });

    expect(report.contractVersion).toBe(1);
    expect(report.instances[0]?.instanceId).toBe("codex_work");
    expect(report.instances[0]?.windows[0]?.usedPercent).toBe(127.5);
  });

  it("decodes optional provider cost history without weakening numeric validation", () => {
    const report = decodeReport({
      contractVersion: 1,
      readAt: "2026-08-13T12:00:00.000Z",
      instances: [
        {
          instanceId: "cursor_work",
          driver: "cursor",
          displayName: "Cursor",
          state: "ready",
          freshness: "fresh",
          fetchedAt: "2026-08-13T12:00:00.000Z",
          source: "provider-app",
          windows: [],
          details: [],
          cost: {
            currencyCode: "USD",
            periodDays: 30,
            scope: "provider-account",
            costCoverage: "complete",
            meteredCost: 113.95,
            todayCost: 0,
            periodCost: 205,
            latestTokens: 7_600_000,
            periodTokens: 158_000_000,
            topModel: "cursor-grok-4.6-xhigh-fast",
            daily: [{ date: "2026-08-12", cost: 147, tokens: 7_600_000 }],
          },
        },
      ],
    });

    expect(report.instances[0]?.state === "ready" && report.instances[0].cost?.periodCost).toBe(
      205,
    );
    expect(report.instances[0]?.state === "ready" && report.instances[0].cost?.scope).toBe(
      "provider-account",
    );
    expect(() =>
      decodeReport({
        ...report,
        instances: [
          {
            ...report.instances[0],
            cost: {
              currencyCode: "USD",
              periodDays: 30,
              daily: [{ date: "2026-08-12", cost: -1 }],
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects negative window utilization and malformed reset timestamps", () => {
    const base = {
      contractVersion: 1,
      readAt: "2026-08-13T12:00:00.000Z",
      instances: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          state: "ready",
          windows: [{ id: "weekly", label: "Weekly", usedPercent: -1 }],
          details: [],
        },
      ],
    };
    expect(() => decodeReport(base)).toThrow();
    expect(() =>
      decodeReport({
        ...base,
        instances: [
          {
            ...base.instances[0],
            windows: [{ id: "weekly", label: "Weekly", usedPercent: 1, resetsAt: "tomorrow" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("requires freshness for ready data and forbids stale metadata on failures", () => {
    const identity = {
      instanceId: "codex",
      driver: "codex",
      displayName: "Codex",
      windows: [],
      details: [],
    };
    expect(() =>
      decodeReport({
        contractVersion: 1,
        readAt: "2026-08-13T12:00:00.000Z",
        instances: [
          {
            ...identity,
            state: "ready",
            fetchedAt: "2026-08-13T12:00:00.000Z",
            source: "provider-cli",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeReport({
        contractVersion: 1,
        readAt: "2026-08-13T12:00:00.000Z",
        instances: [{ ...identity, state: "error", freshness: "stale" }],
      }),
    ).toThrow();
  });

  it("accepts future integer versions for client-side degradation but rejects invalid versions", () => {
    expect(
      decodeReport({
        contractVersion: 2,
        readAt: "2026-08-13T12:00:00.000Z",
        instances: [],
      }).contractVersion,
    ).toBe(2);
    expect(() =>
      decodeReport({
        contractVersion: 1.5,
        readAt: "2026-08-13T12:00:00.000Z",
        instances: [],
      }),
    ).toThrow();
  });
});

describe("ProviderSubscriptionCredentialSetInput", () => {
  it("round-trips the RPC payload while keeping the in-memory value redacted", () => {
    const codec = Schema.toCodecJson(ProviderSubscriptionCredentialSetInput);
    const plaintext = "WorkosCursorSessionToken=secret-cookie";
    const encoded = Schema.encodeUnknownSync(codec)({
      instanceId: "cursor_work",
      secret: Redacted.make(plaintext),
    });
    const decoded = Schema.decodeUnknownSync(codec)(encoded);

    expect(Redacted.value(decoded.secret)).toBe(plaintext);
    expect(String(decoded.secret)).toBe("<redacted>");
    expect(String(decoded.secret)).not.toContain(plaintext);
  });

  it("does not include an invalid credential in schema errors", () => {
    const codec = Schema.toCodecJson(ProviderSubscriptionCredentialSetInput);
    const plaintext = " secret-that-must-not-appear ";
    let rendered = "";
    try {
      Schema.decodeUnknownSync(codec)({ instanceId: "cursor_work", secret: plaintext });
    } catch (error) {
      rendered = String(error);
    }
    expect(rendered).not.toContain(plaintext);
  });
});

describe("provider subscription usage client settings", () => {
  it("defaults polling to five minutes, alerts on, and transition memory empty", () => {
    const settings = decodeClientSettings({});
    expect(settings.providerUsageRefreshIntervalMinutes).toBe(5);
    expect(settings.providerUsageAlertsEnabled).toBe(true);
    expect(settings.providerUsageAlertTransitions).toEqual({});
  });

  it.each([null, 5, 15, 30, 60] as const)("accepts polling preset %s", (value) => {
    expect(
      decodeClientSettings({ providerUsageRefreshIntervalMinutes: value })
        .providerUsageRefreshIntervalMinutes,
    ).toBe(value);
  });

  it("rejects unsupported polling intervals", () => {
    expect(() => decodeClientSettings({ providerUsageRefreshIntervalMinutes: 10 })).toThrow();
  });

  it("persists an optional provider alert cooldown timestamp", () => {
    const marker = {
      cycleKey: "2026-08-20T12:00:00.000Z",
      lowNotified: true,
      exhausted: false,
      restorationNotified: false,
      lastUsedPercent: 96,
      lastNotifiedAt: 1_787_140_800_000,
    };
    const settings = decodeClientSettings({
      providerUsageAlertTransitions: { '["local","claude","weekly"]': marker },
    });

    expect(settings.providerUsageAlertTransitions['["local","claude","weekly"]']).toEqual(marker);
  });
});
