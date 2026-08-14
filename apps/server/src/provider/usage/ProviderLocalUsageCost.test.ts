import {
  USAGE_CONTRACT_VERSION,
  UsageDay,
  type UsageBucket,
  type UsageProviderKind,
  type UsageSummary,
} from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeProviderLocalUsageCost } from "./ProviderLocalUsageCost.ts";

const totals = (input: number, cached: number, output: number) => ({
  uncachedInputTokens: input,
  cachedInputTokens: cached,
  cacheCreationTokens: 0,
  outputTokens: output,
  reasoningTokens: 0,
});

const bucket = (input: {
  readonly day: string;
  readonly provider: UsageProviderKind;
  readonly model: string;
  readonly costUsd: number;
  readonly tokens: ReturnType<typeof totals>;
  readonly records?: number;
  readonly unpricedRecords?: number;
}): UsageBucket => ({
  day: UsageDay.make(input.day),
  provider: input.provider,
  model: input.model,
  totals: input.tokens,
  costUsd: input.costUsd,
  cacheSavingsUsd: 0,
  costSource: input.unpricedRecords ? "unpriced" : "modelPriced",
  records: input.records ?? 1,
  unpricedRecords: input.unpricedRecords ?? 0,
  sessions: 1,
});

const summary = (input: {
  readonly provider?: UsageProviderKind;
  readonly transcriptRoot?: string;
  readonly status?: UsageSummary["sources"][number]["status"];
  readonly buckets: readonly UsageBucket[];
}): UsageSummary => ({
  contractVersion: USAGE_CONTRACT_VERSION,
  readAt: "2026-08-14T12:00:00.000Z",
  timeZone: "America/New_York",
  sinceDay: UsageDay.make("2026-07-16"),
  untilDay: UsageDay.make("2026-08-14"),
  buckets: input.buckets,
  sources: [
    {
      fingerprint: {
        hostId: "test-host",
        provider: input.provider ?? "claude",
        resolvedHomePath: input.transcriptRoot ?? "/tmp/claude/projects",
        volumeId: "1:2",
      },
      status: input.status ?? "ok",
      scannedFiles: 2,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
    },
  ],
  pricing: {
    status: "fresh",
    source: "test-rates",
    fetchedAt: "2026-08-14T12:00:00.000Z",
    knownModels: 2,
  },
  scanDurationMs: 5,
});

describe("local provider usage card projection", () => {
  it("aggregates only the requested provider into daily and model totals", () => {
    const result = summarizeProviderLocalUsageCost({
      provider: "claude",
      transcriptRoot: "/tmp/claude/projects",
      summary: summary({
        buckets: [
          bucket({
            day: "2026-08-13",
            provider: "claude",
            model: "claude-opus-4-1",
            costUsd: 4,
            tokens: totals(100, 20, 30),
          }),
          bucket({
            day: "2026-08-14",
            provider: "claude",
            model: "claude-opus-4-1",
            costUsd: 2,
            tokens: totals(50, 10, 15),
          }),
          bucket({
            day: "2026-08-14",
            provider: "codex",
            model: "gpt-5.6",
            costUsd: 100,
            tokens: totals(1_000, 0, 1_000),
          }),
        ],
      }),
    });

    expect(result).toMatchObject({
      currencyCode: "USD",
      periodDays: 30,
      scope: "local-environment",
      costCoverage: "complete",
      periodCost: 6,
      todayCost: 2,
      latestTokens: 75,
      periodTokens: 225,
      topModel: "claude-opus-4-1",
    });
    expect(result?.daily).toEqual([
      { date: "2026-08-13", cost: 4, tokens: 150 },
      { date: "2026-08-14", cost: 2, tokens: 75 },
    ]);
  });

  it("marks mixed pricing as partial and preserves unpriced token totals", () => {
    const result = summarizeProviderLocalUsageCost({
      provider: "claude",
      transcriptRoot: "/tmp/claude/projects",
      summary: summary({
        status: "partial",
        buckets: [
          bucket({
            day: "2026-08-14",
            provider: "claude",
            model: "claude-known",
            costUsd: 1.5,
            tokens: totals(10, 0, 5),
          }),
          bucket({
            day: "2026-08-14",
            provider: "claude",
            model: "claude-future",
            costUsd: 0,
            tokens: totals(20, 0, 5),
            unpricedRecords: 1,
          }),
        ],
      }),
    });

    expect(result?.costCoverage).toBe("partial");
    expect(result?.periodCost).toBe(1.5);
    expect(result?.periodTokens).toBe(40);
  });

  it("does not attach another provider instance's transcript history", () => {
    const result = summarizeProviderLocalUsageCost({
      provider: "claude",
      transcriptRoot: "/tmp/claude-work/projects",
      summary: summary({
        buckets: [
          bucket({
            day: "2026-08-14",
            provider: "claude",
            model: "claude-opus-4-1",
            costUsd: 2,
            tokens: totals(50, 0, 10),
          }),
        ],
      }),
    });

    expect(result).toBeUndefined();
  });
});
