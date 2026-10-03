/**
 * Prices each finished provider turn with the same rate table the Usage page
 * uses, so the composer meter can show what a thread's work has cost so far.
 * The meter sums turns, which is what keeps the figure stable across compaction,
 * provider restarts, and server restarts: every turn's price is persisted with it.
 *
 * @module providerTurnPricing
 */
import type { TurnTokenUsage, UsageTokenTotals } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderTurnPricing } from "../orchestration-v2/ProviderEventIngestor.ts";
import * as UsageService from "./UsageService.ts";
import { totalTokens } from "./usageTranscripts.ts";

/** Turn usage counts input inclusive of cache reads and writes; pricing wants them apart. */
export function turnUsageToTotals(usage: TurnTokenUsage): UsageTokenTotals | null {
  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = Math.min(inputTokens, usage.cachedInputTokens ?? 0);
  const cacheCreationTokens = Math.min(
    inputTokens - cachedInputTokens,
    usage.cacheCreationTokens ?? 0,
  );
  const outputTokens = usage.outputTokens ?? 0;
  const totals: UsageTokenTotals = {
    uncachedInputTokens: inputTokens - cachedInputTokens - cacheCreationTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens: Math.min(outputTokens, usage.reasoningTokens ?? 0),
  };
  return totalTokens(totals) === 0 ? null : totals;
}

export const layer = Layer.effect(
  ProviderTurnPricing,
  Effect.gen(function* () {
    const usage = yield* UsageService.UsageService;
    // Starts loading the rate table now, so the first turn to finish is priced.
    yield* usage.priceCached("", {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
    return {
      price: (modelSelection, turnUsage) => {
        const totals = turnUsageToTotals(turnUsage);
        if (totals === null) return Effect.succeed(null);
        // The turn's event is persisted after this returns, so pricing must
        // never wait on a rate fetch.
        return usage
          .priceCached(modelSelection.model, totals)
          .pipe(
            Effect.map((priced) =>
              priced === null || priced.costSource === "unpriced" || !(priced.costUsd > 0)
                ? null
                : priced.costUsd,
            ),
          );
      },
    };
  }),
);
