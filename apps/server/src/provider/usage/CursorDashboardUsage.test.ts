import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect } from "vite-plus/test";

import {
  fetchCursorDashboardUsage,
  parseCursorDashboardUsagePage,
  summarizeCursorDashboardUsage,
} from "./CursorDashboardUsage.ts";

const NOW = Date.parse("2026-08-14T15:00:00.000Z");

const pagePayload = {
  totalUsageEventsCount: "3",
  usageEventsDisplay: [
    {
      timestamp: String(Date.parse("2026-08-14T14:00:00.000Z")),
      model: "cursor-small",
      chargedCents: "10",
      tokenUsage: {
        inputTokens: "600",
        outputTokens: 400,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalCents: "50",
      },
    },
    {
      timestamp: Date.parse("2026-08-13T14:00:00.000Z"),
      model: "cursor-large",
      chargedCents: 25,
      tokenUsage: {
        inputTokens: 2_000_000,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalCents: 200,
      },
    },
    {
      timestamp: Date.parse("2026-08-14T13:00:00.000Z"),
      model: "metered-only",
      chargedCents: 15,
    },
  ],
};

describe("Cursor dashboard usage", () => {
  it("maps Cursor's lenient event numbers into CodexBar-style cost totals", () => {
    const page = parseCursorDashboardUsagePage(pagePayload);
    expect(page?.totalCount).toBe(3);
    const cost = summarizeCursorDashboardUsage({ events: page?.events ?? [], nowMs: NOW });

    expect(cost).toMatchObject({
      currencyCode: "USD",
      periodDays: 30,
      scope: "provider-account",
      costCoverage: "complete",
      meteredCost: 0.5,
      todayCost: 0.5,
      periodCost: 2.5,
      latestTokens: 1_000,
      periodTokens: 2_001_000,
      topModel: "cursor-large",
    });
    expect(cost?.daily.map((day) => [day.date, day.cost, day.tokens])).toEqual([
      ["2026-08-13", 2, 2_000_000],
      ["2026-08-14", 0.5, 1_000],
    ]);
  });

  it("omits a metered total when any valid event lacks Cursor's charged amount", () => {
    const page = parseCursorDashboardUsagePage({
      totalUsageEventsCount: 1,
      usageEventsDisplay: [
        {
          timestamp: NOW - 1_000,
          model: "cursor-small",
          tokenUsage: { inputTokens: 10, totalCents: 1 },
        },
      ],
    });
    const cost = summarizeCursorDashboardUsage({ events: page?.events ?? [], nowMs: NOW });

    expect(cost?.periodCost).toBe(0.01);
    expect(cost?.meteredCost).toBeUndefined();
  });

  it("rejects malformed page counts and event rows", () => {
    expect(
      parseCursorDashboardUsagePage({
        totalUsageEventsCount: -1,
        usageEventsDisplay: [],
      }),
    ).toBeUndefined();
    expect(
      parseCursorDashboardUsagePage({ totalUsageEventsCount: 1, usageEventsDisplay: [null] }),
    ).toBeUndefined();
  });

  it.effect("posts the fixed 30-day dashboard query with the Cursor session", () => {
    const requests: Array<{
      readonly method: string;
      readonly url: string;
      readonly cookie: string | undefined;
      readonly origin: string | undefined;
      readonly body: string;
    }> = [];
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        requests.push({
          method: request.method,
          url: request.url,
          cookie: request.headers.cookie,
          origin: request.headers.origin,
          body,
        });
        return HttpClientResponse.fromWeb(request, Response.json(pagePayload));
      }),
    );

    return Effect.gen(function* () {
      const cost = yield* fetchCursorDashboardUsage({
        client,
        cookieHeader: "WorkosCursorSessionToken=test",
        nowMs: NOW,
      });
      expect(cost?.periodCost).toBe(2.5);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "POST",
        url: "https://cursor.com/api/dashboard/get-filtered-usage-events",
        cookie: "WorkosCursorSessionToken=test",
        origin: "https://cursor.com",
      });
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({ page: 1, pageSize: 1_000 });
    });
  });
});
