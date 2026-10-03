import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  canPriceThreadCost,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  sumProviderTurnCostUsd,
  withThreadCost,
} from "./contextWindow";

describe("V2 context window presentation", () => {
  it("uses retained compaction token data when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      {
        item: {
          id: "compaction-1" as never,
          threadId: "thread-1" as never,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: null,
          completedAt: null,
          updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
          type: "compaction",
          driver: null,
          beforeTokenCount: 10_000,
          afterTokenCount: 2_000,
        },
      },
    ]);
    expect(snapshot?.usedTokens).toBe(2_000);
    expect(snapshot?.totalProcessedTokens).toBe(10_000);
  });

  it("prefers current provider usage and preserves ACP cost", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
      contextUsage: {
        usedTokens: 2_500,
        maxTokens: 10_000,
        cost: { amount: 0.42, currency: "USD" },
      },
      updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      usedTokens: 2_500,
      maxTokens: 10_000,
      remainingTokens: 7_500,
      usedPercentage: 25,
      cost: { amount: 0.42, currency: "USD" },
    });
  });

  it("carries the thread's API-equivalent cost from provider usage", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
      contextUsage: {
        usedTokens: 4_000,
        maxTokens: 200_000,
        costUsd: 1.25,
        costSource: "providerReported",
      },
      updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
    });

    expect(snapshot?.costUsd).toBe(1.25);
    expect(snapshot?.costSource).toBe("providerReported");
  });

  it("formats compact token values", () => {
    expect(formatContextWindowTokens(1_500)).toBe("1.5k");
  });

  it("only prices Claude and Codex thread cost", () => {
    expect(canPriceThreadCost("claudeAgent")).toBe(true);
    expect(canPriceThreadCost("codex")).toBe(true);
    expect(canPriceThreadCost("cursor")).toBe(false);
    expect(canPriceThreadCost("opencode")).toBe(false);
  });
});

describe("live provider-turn usage (#8144)", () => {
  it("prefers the provider's live report over compaction items", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      maxTokens: 200_000,
      inputTokens: 40_000,
      outputTokens: 2_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(42_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(158_000);
    expect(snapshot?.usedPercentage).toBe(21);
  });

  it("handles a report without a known context window", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot?.maxTokens).toBeNull();
    expect(snapshot?.usedPercentage).toBeNull();
  });
});

describe("thread cost", () => {
  it("sums the priced turns and ignores unpriced ones", () => {
    expect(
      sumProviderTurnCostUsd([
        { turnTokenUsage: { costUsd: 0.25 } },
        { turnTokenUsage: {} },
        {},
        { turnTokenUsage: { costUsd: 1.5 } },
      ]),
    ).toBe(1.75);
  });

  it("adds the thread cost only where the snapshot has none of its own", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 1_000,
      maxTokens: 10_000,
      updatedAt: "2026-09-09T12:00:00.000Z",
    });
    expect(withThreadCost(snapshot, 1.75)).toMatchObject({
      costUsd: 1.75,
      costSource: "modelPriced",
    });
    expect(withThreadCost(snapshot, 0)?.costUsd).toBeNull();
    expect(withThreadCost(null, 1.75)).toBeNull();
  });
});
