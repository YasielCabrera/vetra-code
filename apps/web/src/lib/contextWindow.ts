import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";

/**
 * API-equivalent USD for a thread's finished provider turns. The server prices
 * each turn as it ends, so the sum only grows: compaction shrinks occupancy,
 * never this.
 */
export function sumProviderTurnCostUsd(
  providerTurns: ReadonlyArray<{
    readonly turnTokenUsage?: { readonly costUsd?: number | undefined } | undefined;
  }>,
): number {
  let total = 0;
  for (const turn of providerTurns) {
    const cost = turn.turnTokenUsage?.costUsd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) total += cost;
  }
  return total;
}

/** Puts the thread's running cost on a snapshot that came from a source without one. */
export function withThreadCost(
  snapshot: ContextWindowSnapshot | null,
  costUsd: number,
): ContextWindowSnapshot | null {
  if (snapshot === null || !(costUsd > 0) || snapshot.costUsd !== null) return snapshot;
  return { ...snapshot, costUsd, costSource: "modelPriced" };
}

/** Providers whose live usage we can turn into API-equivalent dollars. */
export function canPriceThreadCost(provider: string | null | undefined): boolean {
  switch (provider) {
    case "claudeAgent":
    case "claude":
    case "codex":
      return true;
    default:
      return false;
  }
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 999_500) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
