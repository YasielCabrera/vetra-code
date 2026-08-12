/**
 * Codex live-thread cost accounting.
 *
 * The Usage page prices each Codex `last_token_usage` delta against LiteLLM.
 * The composer meter uses the same totals shape and the same `priceUsage`
 * function; this module only decides *which* delta to price next so compact
 * and follow-ups cannot shrink the running total.
 *
 * @module codexThreadCost
 */
import type { UsageTokenTotals } from "@vetra-code/contracts";

import { totalTokens } from "./usageTranscripts.ts";

export type CodexUsageBreakdown = {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
};

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Codex reports `inputTokens` inclusive of the cached portion, matching the
 * transcript scanner in `usageTranscripts`.
 */
export function codexBreakdownToUsageTotals(
  breakdown: CodexUsageBreakdown,
): UsageTokenTotals | null {
  const inputTokens = int(breakdown.inputTokens);
  const cachedInputTokens = int(breakdown.cachedInputTokens);
  const cacheCreationTokens = int(breakdown.cacheWriteInputTokens);
  const outputTokens = int(breakdown.outputTokens);
  const totals: UsageTokenTotals = {
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, int(breakdown.reasoningOutputTokens)),
  };
  return totalTokens(totals) === 0 ? null : totals;
}

export function usageTotalsSignature(totals: UsageTokenTotals): string {
  return [
    totals.uncachedInputTokens,
    totals.cachedInputTokens,
    totals.cacheCreationTokens,
    totals.outputTokens,
    totals.reasoningTokens,
  ].join(":");
}

export function subtractUsageTotals(
  current: UsageTokenTotals,
  previous: UsageTokenTotals | undefined,
): UsageTokenTotals | null {
  if (previous === undefined) {
    return current;
  }
  const delta: UsageTokenTotals = {
    uncachedInputTokens: Math.max(0, current.uncachedInputTokens - previous.uncachedInputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - previous.cacheCreationTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningTokens: Math.max(0, current.reasoningTokens - previous.reasoningTokens),
  };
  return totalTokens(delta) === 0 ? null : delta;
}

export interface CodexThreadCostState {
  runningCostUsd: number;
  costSource: "modelPriced" | undefined;
  parentInitialized: boolean;
  lastParentSignature: string | null;
  readonly childTotals: Map<string, UsageTokenTotals>;
  pendingBaselineUsd: number;
  resumeThreadId: string | undefined;
}

export function createCodexThreadCostState(input?: {
  readonly baselineCostUsd?: number;
  readonly pendingBaselineUsd?: number;
  readonly resumeThreadId?: string;
}): CodexThreadCostState {
  const seeded =
    typeof input?.baselineCostUsd === "number" && Number.isFinite(input.baselineCostUsd)
      ? Math.max(0, input.baselineCostUsd)
      : 0;
  const pendingBaselineUsd =
    typeof input?.pendingBaselineUsd === "number" && Number.isFinite(input.pendingBaselineUsd)
      ? Math.max(0, input.pendingBaselineUsd)
      : 0;
  return {
    runningCostUsd: seeded,
    costSource: seeded > 0 ? "modelPriced" : undefined,
    parentInitialized: false,
    lastParentSignature: null,
    childTotals: new Map(),
    pendingBaselineUsd,
    resumeThreadId: input?.resumeThreadId,
  };
}

/**
 * First parent event: price cumulative `total` so a resumed Codex thread is
 * not missing history. Later events: price `last` and skip consecutive
 * duplicates (Codex re-emits an unchanged last on some stream boundaries).
 *
 * A pending baseline from a prior Vetra session is applied only when Codex
 * started a *fresh* thread (failed resume). Same-thread resume keeps
 * `usage.total` as the source of truth so the baseline is not double-counted.
 */
export function nextParentBillableTotals(
  state: CodexThreadCostState,
  last: CodexUsageBreakdown,
  total: CodexUsageBreakdown,
  eventThreadId?: string,
): UsageTokenTotals | null {
  const lastTotals = codexBreakdownToUsageTotals(last);
  const lastSig = lastTotals === null ? null : usageTotalsSignature(lastTotals);

  if (!state.parentInitialized) {
    state.parentInitialized = true;
    state.lastParentSignature = lastSig;
    const isSameResumedThread =
      state.resumeThreadId !== undefined &&
      eventThreadId !== undefined &&
      eventThreadId === state.resumeThreadId;
    if (state.pendingBaselineUsd > 0 && !isSameResumedThread) {
      state.runningCostUsd += state.pendingBaselineUsd;
      state.costSource = "modelPriced";
      state.pendingBaselineUsd = 0;
      return lastTotals;
    }
    if (state.runningCostUsd > 0) {
      return lastTotals;
    }
    return codexBreakdownToUsageTotals(total) ?? lastTotals;
  }

  if (lastSig === null || lastSig === state.lastParentSignature) {
    return null;
  }
  state.lastParentSignature = lastSig;
  return lastTotals;
}

export function nextChildBillableTotals(
  state: CodexThreadCostState,
  childId: string,
  total: CodexUsageBreakdown,
): UsageTokenTotals | null {
  const current = codexBreakdownToUsageTotals(total);
  if (current === null) {
    return null;
  }
  const previous = state.childTotals.get(childId);
  state.childTotals.set(childId, current);
  return subtractUsageTotals(current, previous);
}

export function applyPricedDelta(state: CodexThreadCostState, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) {
    return;
  }
  state.runningCostUsd += costUsd;
  state.costSource = "modelPriced";
}
