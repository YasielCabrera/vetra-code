import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageInstanceResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { parseClaudeSubscriptionUsage } from "./ClaudeSubscriptionUsage.ts";
import { parseCodexSubscriptionUsage } from "./CodexSubscriptionUsage.ts";
import {
  parseCursorAppAccessToken,
  parseCursorSubscriptionUsage,
} from "./CursorSubscriptionUsage.ts";
import { parseGrokSubscriptionUsage } from "./GrokSubscriptionUsage.ts";
import {
  normalizeOpenCodeWorkspaceId,
  parseOpenCodeGoSubscriptionUsage,
  parseOpenCodeWorkspaceIds,
  parseOpenCodeZenBalance,
} from "./OpenCodeSubscriptionUsage.ts";

const FETCHED_AT = "2026-08-13T12:00:00.000Z";
const identity = (driver: "codex" | "claudeAgent" | "cursor" | "grok" | "opencode") => ({
  instanceId: ProviderInstanceId.make(`${driver}_work`),
  driver: ProviderDriverKind.make(driver),
  displayName: `${driver} work`,
});
const readyWindows = (result: ProviderSubscriptionUsageInstanceResult) => {
  expect(result.state).toBe("ready");
  return result.windows;
};

describe("provider subscription usage parsers", () => {
  it("uses CodexBar's top-level normalization and names supplemental windows", () => {
    const result = parseCodexSubscriptionUsage({
      identity: identity("codex"),
      fetchedAt: FETCHED_AT,
      account: { type: "chatgpt", email: "work@example.com", planType: "plus" },
      response: {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 40, windowDurationMins: 10_080 },
          secondary: { usedPercent: 125, windowDurationMins: 300, resetsAt: 1_786_622_400 },
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 0, windowDurationMins: 10_080 },
            secondary: { usedPercent: 13, windowDurationMins: 10_080 },
            credits: { hasCredits: true, unlimited: false, balance: "12.50" },
            individualLimit: {
              used: "$2.00",
              limit: "$20.00",
              remainingPercent: 90,
              resetsAt: 1_786_622_400,
            },
            rateLimitReachedType: "rate_limit_reached",
          },
          review: {
            limitId: "review",
            limitName: "Code review",
            primary: { usedPercent: 12 },
          },
        },
        rateLimitResetCredits: {
          availableCount: 2,
          credits: [
            {
              id: "credit-1",
              resetType: "codexRateLimits",
              status: "available",
              grantedAt: 1_786_000_000,
              expiresAt: 1_786_622_400,
              title: "Full reset",
              description: "Ready to redeem",
            },
          ],
        },
      },
    });

    expect(readyWindows(result).map((window) => [window.label, window.usedPercent])).toEqual([
      ["5-hour", 125],
      ["Weekly", 40],
      ["Code review", 12],
    ]);
    expect(result.windows.map((window) => window.id)).toEqual([
      "codex:primary",
      "codex:secondary",
      "review:primary",
    ]);
    expect(
      result.windows.find((window) => window.id === "codex:secondary")?.resetsAt,
    ).toBeUndefined();
    expect(result.details.map((detail) => detail.id)).toEqual(
      expect.arrayContaining([
        "codex:credits",
        "codex:spend-used",
        "codex:spend-remaining",
        "codex:spend-reset",
        "codex:limit-state",
        "reset-credits",
        "reset-credit:credit-1",
      ]),
    );
    expect(result.accountLabel).toBe("work@example.com");
    expect(result.planLabel).toBe("plus");
  });

  it("maps a lone Codex weekly app-server slot to one weekly bar", () => {
    const result = parseCodexSubscriptionUsage({
      identity: identity("codex"),
      fetchedAt: FETCHED_AT,
      account: { type: "chatgpt", email: "work@example.com", planType: "plus" },
      response: {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 13, windowDurationMins: 10_080 },
        },
      },
    });

    expect(readyWindows(result).map((window) => [window.label, window.usedPercent])).toEqual([
      ["Weekly", 13],
    ]);
  });

  it("distinguishes the current Codex and Codex Spark weekly buckets", () => {
    const result = parseCodexSubscriptionUsage({
      identity: identity("codex"),
      fetchedAt: FETCHED_AT,
      account: { type: "chatgpt", email: "work@example.com", planType: "pro" },
      response: {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 15, windowDurationMins: 10_080 },
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            primary: { usedPercent: 15, windowDurationMins: 10_080 },
          },
          codex_bengalfox: {
            limitId: "codex_bengalfox",
            limitName: "GPT-5.3-Codex-Spark",
            primary: { usedPercent: 0, windowDurationMins: 10_080 },
          },
        },
      },
    });

    expect(readyWindows(result).map((window) => [window.id, window.label])).toEqual([
      ["codex:secondary", "Weekly"],
      ["codex-spark-weekly", "Codex Spark Weekly"],
    ]);
  });

  it("maps Claude plan windows, per-model limits, and extra usage", () => {
    const response: SDKControlGetUsageResponse = {
      session: {
        total_cost_usd: 0,
        total_api_duration_ms: 0,
        total_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        model_usage: {},
      },
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 98, resets_at: "2026-08-13T15:00:00.000Z" },
        seven_day: { utilization: 105, resets_at: null },
        seven_day_opus: { utilization: 50, resets_at: null },
        extra_usage: {
          is_enabled: true,
          monthly_limit: 100,
          used_credits: 25,
          utilization: 25,
          currency: "USD",
        },
      },
      behaviors: null,
    };
    const result = parseClaudeSubscriptionUsage({
      identity: identity("claudeAgent"),
      fetchedAt: FETCHED_AT,
      accountEmail: "claude@example.com",
      response,
    });

    expect(readyWindows(result).map((window) => window.label)).toEqual([
      "Session",
      "Weekly",
      "Opus only",
      "Extra usage",
    ]);
    expect(readyWindows(result).find((window) => window.id === "seven-day")?.usedPercent).toBe(105);
    expect(result.windows.find((window) => window.id === "seven-day")?.resetsAt).toBeUndefined();
    expect(result.details.find((detail) => detail.id === "extra-usage-status")?.value).toBe(
      "Enabled",
    );
    expect(result.details.find((detail) => detail.id === "extra-usage-used")?.value).toBe("$0.25");
    expect(result.details.find((detail) => detail.id === "extra-usage-limit")?.value).toBe("$1.00");
  });

  it("honestly reports Claude sessions without subscription rate limits", () => {
    const result = parseClaudeSubscriptionUsage({
      identity: identity("claudeAgent"),
      fetchedAt: FETCHED_AT,
      response: {
        session: {
          total_cost_usd: 0,
          total_api_duration_ms: 0,
          total_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
          model_usage: {},
        },
        subscription_type: null,
        rate_limits_available: false,
        rate_limits: null,
        behaviors: null,
      },
    });
    expect(result.state).toBe("unsupported");
    expect(result.windows).toEqual([]);
  });

  it("maps Claude scoped model and Daily Routines windows when a newer CLI forwards them", () => {
    const response = {
      session: {
        total_cost_usd: 0,
        total_api_duration_ms: 0,
        total_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        model_usage: {},
      },
      subscription_type: "team",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 0, resets_at: "2026-08-13T15:00:00.000Z" },
        seven_day: { utilization: 47, resets_at: "2026-08-17T15:00:00.000Z" },
        limits: [
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 1,
            resets_at: "2026-08-17T15:00:00.000Z",
            scope: { model: { id: "claude-fable", display_name: "Fable" } },
          },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 50,
            scope: { model: { id: "all-models", display_name: "All models" } },
          },
        ],
        seven_day_routines: { utilization: 0, resets_at: null },
      },
      behaviors: null,
    } as unknown as SDKControlGetUsageResponse;

    const result = parseClaudeSubscriptionUsage({
      identity: identity("claudeAgent"),
      fetchedAt: FETCHED_AT,
      response,
    });

    expect(readyWindows(result).map((window) => [window.id, window.label])).toEqual([
      ["five-hour", "Session"],
      ["seven-day", "Weekly"],
      ["claude-weekly-scoped-claude-fable", "Fable only"],
      ["claude-routines", "Daily Routines"],
    ]);
  });

  it("uses CursorBar's legacy request quota instead of incompatible token lanes", () => {
    const result = parseCursorSubscriptionUsage({
      identity: identity("cursor"),
      fetchedAt: FETCHED_AT,
      source: "provider-app",
      summary: {
        billingCycleStart: "2026-08-01T00:00:00Z",
        billingCycleEnd: "2026-09-01T00:00:00Z",
        membershipType: "pro",
        individualUsage: {
          plan: {
            used: 12500,
            limit: 10000,
            totalPercentUsed: 125,
            autoPercentUsed: 0.36,
            apiPercentUsed: 75,
          },
          onDemand: { used: 500, limit: 2000 },
        },
        teamUsage: { onDemand: { used: 1000, limit: 5000 } },
      },
      userInfo: { email: "cursor@example.com", sub: "user-1" },
      legacyUsage: { "gpt-4": { numRequestsTotal: 80, maxRequestUsage: 100 } },
    });
    const windows = readyWindows(result);
    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["legacy-request-quota", 80],
    ]);
    expect(result.details.map((detail) => detail.id)).toEqual(
      expect.arrayContaining(["personal-on-demand", "team-on-demand"]),
    );
  });

  it("maps Cursor usage-summary percentage units without scaling fractional percentages", () => {
    const result = parseCursorSubscriptionUsage({
      identity: identity("cursor"),
      fetchedAt: FETCHED_AT,
      source: "provider-app",
      summary: {
        billingCycleStart: "2026-08-01T00:00:00Z",
        billingCycleEnd: "2026-09-01T00:00:00Z",
        individualUsage: {
          plan: {
            used: 12_500,
            limit: 10_000,
            totalPercentUsed: 125,
            autoPercentUsed: 0.36,
            apiPercentUsed: 75,
          },
        },
      },
      cost: {
        currencyCode: "USD",
        periodDays: 30,
        meteredCost: 12.5,
        todayCost: 1,
        periodCost: 20,
        latestTokens: 1_000,
        periodTokens: 5_000,
        topModel: "cursor-model",
        daily: [{ date: "2026-08-13", cost: 1, tokens: 1_000 }],
      },
    });

    expect(
      readyWindows(result).map((window) => [window.id, window.label, window.usedPercent]),
    ).toEqual([
      ["monthly-included", "Total", 125],
      ["auto-composer", "Auto", 0.36],
      ["api-models", "API", 75],
    ]);
    expect(result.state === "ready" && result.cost?.topModel).toBe("cursor-model");
  });

  it("derives a Cursor app cookie only from a valid, unexpired JWT", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "workos|cursor-user", exp: 2_000_000_000 }),
    ).toString("base64url");
    const token = `header.${payload}.signature`;
    expect(parseCursorAppAccessToken(token, 1_900_000_000)?.cookieHeader).toBe(
      `WorkosCursorSessionToken=cursor-user%3A%3A${token}`,
    );
    expect(parseCursorAppAccessToken(token, 2_000_000_000)).toBeUndefined();
    expect(parseCursorAppAccessToken("not-a-jwt", 0)).toBeUndefined();
  });

  it("maps Grok total monthly allowance and on-demand details without clamping", () => {
    const result = parseGrokSubscriptionUsage({
      identity: identity("grok"),
      fetchedAt: FETCHED_AT,
      response: {
        billingCycle: {
          billingPeriodStart: "2026-08-01T00:00:00Z",
          billingPeriodEnd: "2026-09-01T00:00:00Z",
        },
        monthlyLimit: { val: 10_000 },
        onDemandCap: { val: 5_000 },
        on_demand_enabled: true,
        usage: {
          includedUsed: { val: 9_000 },
          onDemandUsed: { val: 6_000 },
          totalUsed: { val: 15_000 },
        },
      },
    });
    expect(readyWindows(result)[0]?.usedPercent).toBe(150);
    expect(result.details.find((detail) => detail.id === "on-demand")?.value).toContain("$60.00");
  });

  it("parses OpenCode Go rolling, weekly, monthly, absent resets, workspace, and Zen data", () => {
    const result = parseOpenCodeGoSubscriptionUsage({
      identity: identity("opencode"),
      fetchedAt: FETCHED_AT,
      nowMs: 1_700_000_000_000,
      text: `rollingUsage:{usagePercent:125},weeklyUsage:{usagePercent:25,resetInSec:600},monthlyUsage:{usagePercent:10,resetInSec:1200}`,
      zenBalance: 12.5,
    });
    expect(result).toBeDefined();
    expect(result?.windows.find((window) => window.id === "five-hour")?.usedPercent).toBe(125);
    expect(result?.windows.find((window) => window.id === "five-hour")?.resetsAt).toBeUndefined();
    expect(result?.windows.map((window) => window.id)).toEqual(["five-hour", "weekly", "monthly"]);
    expect(result?.details[0]?.value).toBe("$12.50");
    expect(normalizeOpenCodeWorkspaceId("https://opencode.ai/workspace/wrk_abc123/go")).toBe(
      "wrk_abc123",
    );
    expect(parseOpenCodeWorkspaceIds('{"workspace":{"id":"wrk_one"}} wrk_two')).toEqual([
      "wrk_one",
      "wrk_two",
    ]);
    expect(parseOpenCodeZenBalance('{"currentBalanceUSD": 7.25}')).toBe(7.25);
  });

  it("normalizes OpenCode Go ratio percentages without clamping provider overages", () => {
    const result = parseOpenCodeGoSubscriptionUsage({
      identity: identity("opencode"),
      fetchedAt: FETCHED_AT,
      nowMs: 1_700_000_000_000,
      text: `rollingUsage:{usagePercent:0.25},weeklyUsage:{usagePercent:175}`,
    });
    expect(result?.windows.find((window) => window.id === "five-hour")?.usedPercent).toBe(25);
    expect(result?.windows.find((window) => window.id === "weekly")?.usedPercent).toBe(175);
  });

  it("rejects OpenCode schema drift instead of inventing a quota", () => {
    expect(
      parseOpenCodeGoSubscriptionUsage({
        identity: identity("opencode"),
        fetchedAt: FETCHED_AT,
        text: "futurePayload:{somethingElse:42}",
      }),
    ).toBeUndefined();
  });
});
