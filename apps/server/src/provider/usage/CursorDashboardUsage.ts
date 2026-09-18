import type { ProviderSubscriptionUsageCost } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/unstable/http";

import { ProviderUsageHttpError, providerUsageHttpRequest } from "./ProviderUsageHttpClient.ts";

const CURSOR_ORIGIN = "https://cursor.com";
const DEFAULT_PERIOD_DAYS = 30;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 200;

type UnknownRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const finiteNumber = (value: unknown): number | undefined => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const integer = (value: unknown, fallback = 0): number => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : fallback;
};

const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizePeriodDays = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.min(365, Math.trunc(value)))
    : DEFAULT_PERIOD_DAYS;

export interface CursorDashboardTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  readonly totalCents?: number;
}

export interface CursorDashboardUsageEvent {
  readonly timestampMs?: number;
  readonly model?: string;
  readonly tokenUsage?: CursorDashboardTokenUsage;
  readonly chargedCents?: number;
  readonly fingerprint: string;
}

export interface CursorDashboardUsagePage {
  readonly totalCount?: number;
  readonly events: readonly CursorDashboardUsageEvent[];
}

const parseTokenUsage = (value: unknown): CursorDashboardTokenUsage | undefined => {
  const usage = record(value);
  if (!usage) return undefined;
  const totalCents = finiteNumber(usage.totalCents);
  return {
    inputTokens: integer(usage.inputTokens),
    outputTokens: integer(usage.outputTokens),
    cacheWriteTokens: integer(usage.cacheWriteTokens),
    cacheReadTokens: integer(usage.cacheReadTokens),
    ...(totalCents !== undefined ? { totalCents } : {}),
  };
};

const parseEvent = (value: unknown): CursorDashboardUsageEvent | undefined => {
  const event = record(value);
  if (!event) return undefined;
  const timestampMs = finiteNumber(event.timestamp);
  const tokenUsage = parseTokenUsage(event.tokenUsage);
  const chargedCents = finiteNumber(event.chargedCents);
  const model = optionalText(event.model);
  return {
    ...(timestampMs !== undefined && Number.isSafeInteger(timestampMs) ? { timestampMs } : {}),
    ...(model ? { model } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(chargedCents !== undefined ? { chargedCents } : {}),
    fingerprint: JSON.stringify(value),
  };
};

export const parseCursorDashboardUsagePage = (
  value: unknown,
): CursorDashboardUsagePage | undefined => {
  const page = record(value);
  if (!page || !Array.isArray(page.usageEventsDisplay)) return undefined;
  const rawTotal = page.totalUsageEventsCount;
  const hasTotal = rawTotal !== undefined && rawTotal !== null;
  const totalCount = hasTotal ? finiteNumber(rawTotal) : undefined;
  if (
    hasTotal &&
    (totalCount === undefined || !Number.isSafeInteger(totalCount) || totalCount < 0)
  ) {
    return undefined;
  }
  const events: CursorDashboardUsageEvent[] = [];
  for (const rawEvent of page.usageEventsDisplay) {
    const event = parseEvent(rawEvent);
    if (!event) return undefined;
    events.push(event);
  }
  return {
    ...(totalCount !== undefined ? { totalCount } : {}),
    events,
  };
};

const checkedTokenTotal = (usage: CursorDashboardTokenUsage): number | undefined => {
  let total = 0;
  for (const value of [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheWriteTokens,
    usage.cacheReadTokens,
  ]) {
    if (value < 0 || !Number.isSafeInteger(value)) return undefined;
    const next = total + value;
    if (!Number.isSafeInteger(next)) return undefined;
    total = next;
  }
  return total;
};

const addTokens = (left: number | undefined, right: number | undefined): number | undefined => {
  if (left === undefined || right === undefined) return undefined;
  const total = left + right;
  return Number.isSafeInteger(total) && total >= 0 ? total : undefined;
};

const addCost = (left: number | undefined, rightCents: number | undefined): number | undefined => {
  if (left === undefined || rightCents === undefined || rightCents < 0) return undefined;
  const total = left + rightCents / 100;
  return Number.isFinite(total) && total >= 0 ? total : undefined;
};

const addUsd = (left: number | undefined, right: number | undefined): number | undefined => {
  if (left === undefined || right === undefined) return undefined;
  const total = left + right;
  return Number.isFinite(total) && total >= 0 ? total : undefined;
};

const localDayKey = (milliseconds: number): string => {
  const parts = DateTime.toParts(
    DateTime.makeZonedUnsafe(milliseconds, { timeZone: DateTime.zoneMakeLocal() }),
  );
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const cursorDashboardPeriodStart = (
  nowMs: number,
  periodDays = DEFAULT_PERIOD_DAYS,
): number => {
  const normalizedDays = normalizePeriodDays(periodDays);
  return DateTime.makeZonedUnsafe(nowMs, { timeZone: DateTime.zoneMakeLocal() }).pipe(
    DateTime.startOf("day"),
    DateTime.subtract({ days: normalizedDays - 1 }),
    DateTime.toEpochMillis,
  );
};

interface ModelAccumulator {
  tokens: number | undefined;
  cost: number | undefined;
}

export const summarizeCursorDashboardUsage = (input: {
  readonly events: readonly CursorDashboardUsageEvent[];
  readonly nowMs: number;
  readonly periodDays?: number;
}): ProviderSubscriptionUsageCost | undefined => {
  const periodDays = normalizePeriodDays(input.periodDays);
  const periodStart = cursorDashboardPeriodStart(input.nowMs, periodDays);
  const days = new Map<string, Map<string, ModelAccumulator>>();
  const models = new Map<string, ModelAccumulator>();
  let meteredCostCents = 0;
  let meteredCostComplete = true;
  let sawValidEvent = false;

  for (const event of input.events) {
    const timestampMs = event.timestampMs;
    if (
      timestampMs === undefined ||
      timestampMs <= 0 ||
      timestampMs < periodStart ||
      timestampMs > input.nowMs
    ) {
      continue;
    }
    sawValidEvent = true;
    if (event.chargedCents === undefined || event.chargedCents < 0) {
      meteredCostComplete = false;
    } else {
      const nextMetered = meteredCostCents + event.chargedCents;
      if (Number.isFinite(nextMetered)) meteredCostCents = nextMetered;
      else meteredCostComplete = false;
    }

    const usage = event.tokenUsage;
    if (!usage) continue;
    const tokens = checkedTokenTotal(usage);
    if (tokens === undefined || tokens <= 0) continue;
    const model = event.model ?? "unknown";
    const dayKey = localDayKey(timestampMs);
    const dayModels = days.get(dayKey) ?? new Map<string, ModelAccumulator>();
    const dayModel = dayModels.get(model) ?? { tokens: 0, cost: 0 };
    dayModels.set(model, {
      tokens: addTokens(dayModel.tokens, tokens),
      cost: addCost(dayModel.cost, usage.totalCents),
    });
    days.set(dayKey, dayModels);

    const periodModel = models.get(model) ?? { tokens: 0, cost: 0 };
    models.set(model, {
      tokens: addTokens(periodModel.tokens, tokens),
      cost: addCost(periodModel.cost, usage.totalCents),
    });
  }

  const daily = [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dayModels]) => {
      let tokens: number | undefined = 0;
      let cost: number | undefined = 0;
      for (const model of dayModels.values()) {
        tokens = addTokens(tokens, model.tokens);
        cost = addUsd(cost, model.cost);
      }
      return {
        date,
        ...(cost !== undefined && Number.isFinite(cost) ? { cost } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
      };
    });

  const periodTokens =
    daily.length > 0
      ? daily.reduce<number | undefined>((total, day) => addTokens(total, day.tokens), 0)
      : undefined;
  const periodCost =
    daily.length > 0
      ? daily.reduce<number | undefined>((total, day) => addUsd(total, day.cost), 0)
      : undefined;
  const today = daily.find((day) => day.date === localDayKey(input.nowMs));
  const todayCost = today ? today.cost : daily.length > 0 ? 0 : undefined;
  const latestTokens = daily.at(-1)?.tokens;
  const topModel = [...models.entries()].sort(([leftName, left], [rightName, right]) => {
    const costDifference = (right.cost ?? -1) - (left.cost ?? -1);
    if (costDifference !== 0) return costDifference;
    if (right.tokens !== left.tokens) return (right.tokens ?? -1) - (left.tokens ?? -1);
    return leftName.localeCompare(rightName);
  })[0]?.[0];
  const meteredCost = sawValidEvent && meteredCostComplete ? meteredCostCents / 100 : undefined;

  if (daily.length === 0 && meteredCost === undefined) return undefined;
  return {
    currencyCode: "USD",
    periodDays,
    scope: "provider-account",
    costCoverage: periodCost === undefined ? "unavailable" : "complete",
    ...(meteredCost !== undefined ? { meteredCost } : {}),
    ...(todayCost !== undefined ? { todayCost } : {}),
    ...(periodCost !== undefined ? { periodCost } : {}),
    ...(latestTokens !== undefined ? { latestTokens } : {}),
    ...(periodTokens !== undefined ? { periodTokens } : {}),
    ...(topModel ? { topModel } : {}),
    daily,
  };
};

const responseError = () => new ProviderUsageHttpError({ kind: "response" });

const requestBody = (input: {
  readonly page: number;
  readonly startDate: string;
  readonly endDate: string;
}): string =>
  JSON.stringify({
    page: input.page,
    pageSize: PAGE_SIZE,
    startDate: input.startDate,
    endDate: input.endDate,
  });

const parseJson = (value: string): unknown | undefined => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const boundaryOverlap = (
  previousPage: readonly CursorDashboardUsageEvent[],
  currentPage: readonly CursorDashboardUsageEvent[],
): number => {
  const limit = Math.min(previousPage.length, currentPage.length);
  for (let count = limit; count > 0; count -= 1) {
    const previousStart = previousPage.length - count;
    let matches = true;
    for (let index = 0; index < count; index += 1) {
      if (previousPage[previousStart + index]?.fingerprint !== currentPage[index]?.fingerprint) {
        matches = false;
        break;
      }
    }
    if (matches) return count;
  }
  return 0;
};

export const fetchCursorDashboardUsage = Effect.fn("fetchCursorDashboardUsage")(function* (input: {
  readonly client: HttpClient.HttpClient;
  readonly cookieHeader: string;
  readonly nowMs: number;
  readonly periodDays?: number;
}) {
  const periodDays = normalizePeriodDays(input.periodDays);
  const startDate = String(cursorDashboardPeriodStart(input.nowMs, periodDays));
  const endDate = String(Math.round(input.nowMs));
  const pages: ReadonlyArray<CursorDashboardUsageEvent>[] = [];
  let expectedTotal: number | undefined;
  let completed = false;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const response = yield* providerUsageHttpRequest({
      client: input.client,
      allowedOrigin: CURSOR_ORIGIN,
      url: `${CURSOR_ORIGIN}/api/dashboard/get-filtered-usage-events`,
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: input.cookieHeader,
        Origin: CURSOR_ORIGIN,
      },
      body: requestBody({ page: pageNumber, startDate, endDate }),
    });
    const payload = parseJson(response.body);
    const page = payload === undefined ? undefined : parseCursorDashboardUsagePage(payload);
    if (!page) return yield* responseError();
    if (page.totalCount !== undefined) {
      if (expectedTotal !== undefined && expectedTotal !== page.totalCount) {
        return yield* responseError();
      }
      expectedTotal = page.totalCount;
    }
    if (page.events.length === 0) {
      completed = true;
      break;
    }
    pages.push(page.events);
    if (page.events.length < PAGE_SIZE) {
      completed = true;
      break;
    }
  }

  const rawEvents = pages.flatMap((page) => page);
  if (!completed) return yield* responseError();
  if (expectedTotal === undefined) {
    return summarizeCursorDashboardUsage({ events: rawEvents, nowMs: input.nowMs, periodDays });
  }
  if (rawEvents.length < expectedTotal) return yield* responseError();
  if (rawEvents.length === expectedTotal) {
    return summarizeCursorDashboardUsage({ events: rawEvents, nowMs: input.nowMs, periodDays });
  }

  let removalsRemaining = rawEvents.length - expectedTotal;
  const reconciled = [...(pages[0] ?? [])];
  for (let index = 1; index < pages.length; index += 1) {
    const previous = pages[index - 1] ?? [];
    const current = pages[index] ?? [];
    const removalCount = Math.min(boundaryOverlap(previous, current), removalsRemaining);
    reconciled.push(...current.slice(removalCount));
    removalsRemaining -= removalCount;
  }
  if (removalsRemaining !== 0 || reconciled.length !== expectedTotal) {
    return yield* responseError();
  }
  return summarizeCursorDashboardUsage({ events: reconciled, nowMs: input.nowMs, periodDays });
});
