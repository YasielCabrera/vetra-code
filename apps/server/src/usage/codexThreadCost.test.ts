import { describe, expect, it } from "vite-plus/test";

import {
  applyPricedDelta,
  codexBreakdownToUsageTotals,
  createCodexThreadCostState,
  nextChildBillableTotals,
  nextParentBillableTotals,
  subtractUsageTotals,
} from "./codexThreadCost.ts";

describe("codexThreadCost", () => {
  it("treats Codex input as inclusive of cache read and cache write", () => {
    expect(
      codexBreakdownToUsageTotals({
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 10,
        outputTokens: 5,
        reasoningOutputTokens: 2,
      }),
    ).toEqual({
      uncachedInputTokens: 50,
      cachedInputTokens: 40,
      cacheCreationTokens: 10,
      outputTokens: 5,
      reasoningTokens: 2,
    });
  });

  it("prices cumulative total on the first parent event", () => {
    const state = createCodexThreadCostState();
    const totals = nextParentBillableTotals(
      state,
      {
        inputTokens: 120,
        cachedInputTokens: 0,
        outputTokens: 6,
      },
      {
        inputTokens: 11_833,
        cachedInputTokens: 3456,
        outputTokens: 6,
      },
    );

    expect(totals).toEqual({
      uncachedInputTokens: 8377,
      cachedInputTokens: 3456,
      cacheCreationTokens: 0,
      outputTokens: 6,
      reasoningTokens: 0,
    });
  });

  it("skips a duplicate last payload on later parent events", () => {
    const state = createCodexThreadCostState();
    const last = {
      inputTokens: 120,
      cachedInputTokens: 0,
      outputTokens: 6,
    };
    nextParentBillableTotals(state, last, last);
    expect(nextParentBillableTotals(state, last, last)).toBeNull();
  });

  it("prices last-request deltas after the first parent event", () => {
    const state = createCodexThreadCostState();
    nextParentBillableTotals(
      state,
      { inputTokens: 10, outputTokens: 1 },
      { inputTokens: 10, outputTokens: 1 },
    );
    const delta = nextParentBillableTotals(
      state,
      { inputTokens: 50, cachedInputTokens: 20, outputTokens: 8 },
      { inputTokens: 60, cachedInputTokens: 20, outputTokens: 9 },
    );
    expect(delta).toEqual({
      uncachedInputTokens: 30,
      cachedInputTokens: 20,
      cacheCreationTokens: 0,
      outputTokens: 8,
      reasoningTokens: 0,
    });
  });

  it("does not re-price cumulative total when a baseline was seeded", () => {
    const state = createCodexThreadCostState({ baselineCostUsd: 1.25 });
    const last = {
      inputTokens: 120,
      cachedInputTokens: 0,
      outputTokens: 6,
    };
    const totals = nextParentBillableTotals(state, last, {
      inputTokens: 11_833,
      cachedInputTokens: 3456,
      outputTokens: 6,
    });
    expect(totals).toEqual({
      uncachedInputTokens: 120,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 6,
      reasoningTokens: 0,
    });
  });

  it("prices only the child's own growth, not the copied parent burst", () => {
    const state = createCodexThreadCostState();
    const first = nextChildBillableTotals(state, "child-a", {
      inputTokens: 40,
      outputTokens: 2,
    });
    expect(first).toEqual({
      uncachedInputTokens: 40,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2,
      reasoningTokens: 0,
    });

    const second = nextChildBillableTotals(state, "child-a", {
      inputTokens: 55,
      outputTokens: 4,
    });
    expect(second).toEqual({
      uncachedInputTokens: 15,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2,
      reasoningTokens: 0,
    });
  });

  it("subtracts disjoint token buckets without going negative", () => {
    expect(
      subtractUsageTotals(
        {
          uncachedInputTokens: 10,
          cachedInputTokens: 4,
          cacheCreationTokens: 1,
          outputTokens: 3,
          reasoningTokens: 1,
        },
        {
          uncachedInputTokens: 12,
          cachedInputTokens: 1,
          cacheCreationTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
        },
      ),
    ).toEqual({
      uncachedInputTokens: 0,
      cachedInputTokens: 3,
      cacheCreationTokens: 1,
      outputTokens: 2,
      reasoningTokens: 1,
    });
  });

  it("applies a pending baseline only when Codex starts a fresh thread", () => {
    const last = { inputTokens: 10, outputTokens: 1 };
    const total = { inputTokens: 11_833, outputTokens: 6 };

    const failedResume = createCodexThreadCostState({
      pendingBaselineUsd: 1.25,
      resumeThreadId: "old-codex-thread",
    });
    expect(nextParentBillableTotals(failedResume, last, total, "new-codex-thread")).toEqual({
      uncachedInputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    });
    expect(failedResume.runningCostUsd).toBe(1.25);

    const sameThread = createCodexThreadCostState({
      pendingBaselineUsd: 1.25,
      resumeThreadId: "codex-thread",
    });
    expect(nextParentBillableTotals(sameThread, last, total, "codex-thread")).toEqual({
      uncachedInputTokens: 11_833,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 6,
      reasoningTokens: 0,
    });
    expect(sameThread.runningCostUsd).toBe(0);
  });

  it("accumulates only positive priced deltas", () => {
    const state = createCodexThreadCostState();
    applyPricedDelta(state, 0.4);
    applyPricedDelta(state, 0);
    applyPricedDelta(state, Number.NaN);
    expect(state.runningCostUsd).toBe(0.4);
    expect(state.costSource).toBe("modelPriced");
  });
});
