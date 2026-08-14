// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import type {
  ProviderSubscriptionUsageCost,
  UsageBucket,
  UsageProviderKind,
  UsageSummary,
} from "@vetra-code/contracts";
import * as Effect from "effect/Effect";

import type { UsageService } from "../../usage/UsageService.ts";

const safeAdd = (left: number, right: number): number | undefined => {
  const total = left + right;
  return Number.isSafeInteger(total) && total >= 0 ? total : undefined;
};

const bucketTokens = (bucket: UsageBucket): number | undefined => {
  let total = 0;
  for (const value of [
    bucket.totals.uncachedInputTokens,
    bucket.totals.cachedInputTokens,
    bucket.totals.cacheCreationTokens,
    bucket.totals.outputTokens,
  ]) {
    const next = safeAdd(total, value);
    if (next === undefined) return undefined;
    total = next;
  }
  return total;
};

interface MutableUsageTotal {
  cost: number;
  tokens: number | undefined;
  hasPricedUsage: boolean;
}

const addBucket = (total: MutableUsageTotal, bucket: UsageBucket): void => {
  const tokens = bucketTokens(bucket);
  total.tokens =
    total.tokens === undefined || tokens === undefined ? undefined : safeAdd(total.tokens, tokens);
  if (bucket.records > bucket.unpricedRecords) {
    const cost = total.cost + bucket.costUsd;
    if (Number.isFinite(cost) && cost >= 0) total.cost = cost;
    total.hasPricedUsage = true;
  }
};

const samePath = (left: string, right: string): boolean =>
  NodePath.resolve(left) === NodePath.resolve(right);

/**
 * Projects the existing transcript-usage snapshot into the compact card shape.
 * The resolved source path is mandatory so usage from another provider instance
 * can never be attached merely because its driver kind matches.
 */
export const summarizeProviderLocalUsageCost = (input: {
  readonly summary: UsageSummary;
  readonly provider: UsageProviderKind;
  readonly transcriptRoot: string;
}): ProviderSubscriptionUsageCost | undefined => {
  const source = input.summary.sources.find(
    (candidate) =>
      candidate.fingerprint.provider === input.provider &&
      samePath(candidate.fingerprint.resolvedHomePath, input.transcriptRoot),
  );
  if (!source || source.status === "missing" || source.status === "failed") return undefined;

  const buckets = input.summary.buckets.filter((bucket) => bucket.provider === input.provider);
  if (buckets.length === 0) return undefined;

  const byDay = new Map<string, MutableUsageTotal>();
  const byModel = new Map<string, MutableUsageTotal>();
  let records = 0;
  let unpricedRecords = 0;

  for (const bucket of buckets) {
    records += bucket.records;
    unpricedRecords += bucket.unpricedRecords;

    const day = byDay.get(bucket.day) ?? { cost: 0, tokens: 0, hasPricedUsage: false };
    addBucket(day, bucket);
    byDay.set(bucket.day, day);

    const model = byModel.get(bucket.model) ?? { cost: 0, tokens: 0, hasPricedUsage: false };
    addBucket(model, bucket);
    byModel.set(bucket.model, model);
  }

  const daily = [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, total]) => ({
      date,
      ...(total.hasPricedUsage ? { cost: total.cost } : {}),
      ...(total.tokens !== undefined ? { tokens: total.tokens } : {}),
    }));

  let periodTokens: number | undefined = 0;
  let periodCost = 0;
  let hasPricedUsage = false;
  for (const day of daily) {
    periodTokens =
      periodTokens === undefined || day.tokens === undefined
        ? undefined
        : safeAdd(periodTokens, day.tokens);
    if (day.cost !== undefined) {
      periodCost += day.cost;
      hasPricedUsage = true;
    }
  }

  const today = daily.find((day) => day.date === input.summary.untilDay);
  const latestTokens = daily.at(-1)?.tokens;
  const topModel = [...byModel.entries()].sort(([leftName, left], [rightName, right]) => {
    if (right.hasPricedUsage !== left.hasPricedUsage) return right.hasPricedUsage ? 1 : -1;
    const costDifference = right.cost - left.cost;
    if (costDifference !== 0) return costDifference;
    const tokenDifference = (right.tokens ?? -1) - (left.tokens ?? -1);
    return tokenDifference !== 0 ? tokenDifference : leftName.localeCompare(rightName);
  })[0]?.[0];
  const costCoverage =
    !hasPricedUsage || records === 0
      ? "unavailable"
      : unpricedRecords > 0 || source.status === "partial"
        ? "partial"
        : "complete";

  return {
    currencyCode: "USD",
    periodDays: 30,
    scope: "local-environment",
    costCoverage,
    ...(hasPricedUsage ? { periodCost, todayCost: today?.cost ?? 0 } : {}),
    ...(latestTokens !== undefined ? { latestTokens } : {}),
    ...(periodTokens !== undefined ? { periodTokens } : {}),
    ...(topModel ? { topModel } : {}),
    daily,
  };
};

export const readProviderLocalUsageCost = Effect.fn("readProviderLocalUsageCost")(
  function* (input: {
    readonly usage: UsageService["Service"];
    readonly provider: UsageProviderKind;
    readonly transcriptRoot: string;
  }) {
    const summary = yield* input.usage.readSubscriptionSummary;
    return summarizeProviderLocalUsageCost({
      summary,
      provider: input.provider,
      transcriptRoot: input.transcriptRoot,
    });
  },
  Effect.timeout("15 seconds"),
  Effect.orElseSucceed(() => undefined),
);
