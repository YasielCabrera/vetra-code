import { describe, expect, it } from "vite-plus/test";

import { turnUsageToTotals } from "./providerTurnPricing.ts";

describe("turnUsageToTotals", () => {
  it("splits cache reads and writes out of the inclusive input count", () => {
    expect(
      turnUsageToTotals({
        usageStatus: "complete",
        usageScope: "main_agent",
        hasSubagents: false,
        inputTokens: 1_000,
        cachedInputTokens: 600,
        cacheCreationTokens: 100,
        outputTokens: 50,
        reasoningTokens: 20,
      }),
    ).toEqual({
      uncachedInputTokens: 300,
      cachedInputTokens: 600,
      cacheCreationTokens: 100,
      outputTokens: 50,
      reasoningTokens: 20,
    });
  });

  it("clamps drifting subsets instead of pricing negative tokens", () => {
    expect(
      turnUsageToTotals({
        usageStatus: "partial",
        usageScope: "main_agent",
        hasSubagents: false,
        inputTokens: 100,
        cachedInputTokens: 150,
        outputTokens: 10,
        reasoningTokens: 40,
      }),
    ).toEqual({
      uncachedInputTokens: 0,
      cachedInputTokens: 100,
      cacheCreationTokens: 0,
      outputTokens: 10,
      reasoningTokens: 10,
    });
  });

  it("has nothing to price for a turn without usage", () => {
    expect(
      turnUsageToTotals({
        usageStatus: "unavailable",
        usageScope: "main_agent",
        hasSubagents: false,
      }),
    ).toBeNull();
  });
});
