import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSubscriptionUsageCost,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@vetra-code/contracts";
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import type { ProviderSubscriptionUsageProbe } from "../ProviderDriver.ts";

export interface ProviderSubscriptionUsageIdentity {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
}

/** Wraps a settled read. Nothing here is eligible for last-good stale fallback. */
export const settledProbe = (
  result: ProviderSubscriptionUsageInstanceResult,
): ProviderSubscriptionUsageProbe => ({ result });

/**
 * Wraps a failed read, marking it for last-good stale fallback when the cause
 * looks temporary. Only an `error` result can ever be marked: an authentication
 * failure or an unsupported account must not resurrect stale quota data.
 */
export const failureProbe = (
  result: ProviderSubscriptionUsageInstanceResult,
  cause: unknown,
): ProviderSubscriptionUsageProbe =>
  result.state === "error" && providerSubscriptionUsageFailureLooksTransient(cause)
    ? { result, transient: true }
    : { result };

/** Conservative classifier shared by CLI and HTTP-backed probes. */
export const providerSubscriptionUsageFailureLooksTransient = (cause: unknown): boolean => {
  if (typeof cause === "object" && cause !== null && "kind" in cause) {
    const kind = (cause as { readonly kind?: unknown }).kind;
    if (["network", "timeout", "rate-limit", "server"].includes(String(kind))) return true;
  }
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  return /(?:timed?\s*out|timeout|rate.?limit|too many requests|\b429\b|\b5\d\d\b|service unavailable|temporar(?:y|ily)|network|econn|connection reset|fetch failed)/u.test(
    message,
  );
};

export const configFingerprint = (input: unknown): string =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");

type ProviderSubscriptionUsageResultBody =
  ProviderSubscriptionUsageInstanceResult extends infer Result
    ? Result extends ProviderSubscriptionUsageInstanceResult
      ? Omit<Result, "instanceId" | "driver" | "displayName">
      : never
    : never;

export const settledResult = (
  identity: ProviderSubscriptionUsageIdentity,
  result: ProviderSubscriptionUsageResultBody,
): ProviderSubscriptionUsageInstanceResult =>
  ({
    ...identity,
    ...result,
  }) as ProviderSubscriptionUsageInstanceResult;

/** Adds optional history without letting a local scan downgrade live quota data. */
export const withProviderSubscriptionUsageCost = (
  probe: ProviderSubscriptionUsageProbe,
  cost: ProviderSubscriptionUsageCost | undefined,
): ProviderSubscriptionUsageProbe =>
  probe.result.state === "ready" && cost ? { ...probe, result: { ...probe.result, cost } } : probe;

export const epochSecondsToIso = (value: number | null | undefined): string | undefined => {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Option.match(DateTime.make(value * 1_000), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
};

export const durationWindowLabel = (
  durationMinutes: number | null | undefined,
  fallback: string,
): string => {
  if (durationMinutes === 300) return "5-hour";
  if (durationMinutes === 1_440) return "Daily";
  if (durationMinutes === 10_080) return "Weekly";
  if (durationMinutes && durationMinutes >= 40_000 && durationMinutes <= 46_000) return "Monthly";
  return fallback;
};

export const percentageWindow = (input: {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly durationMinutes?: number | null | undefined;
  readonly resetsAt?: string | undefined;
}): ProviderSubscriptionUsageWindow | undefined => {
  if (!Number.isFinite(input.usedPercent) || input.usedPercent < 0) return undefined;
  return {
    id: input.id,
    label: input.label,
    usedPercent: input.usedPercent,
    ...(input.durationMinutes !== undefined && input.durationMinutes !== null
      ? { durationMinutes: Math.max(0, Math.trunc(input.durationMinutes)) }
      : {}),
    ...(input.resetsAt ? { resetsAt: input.resetsAt } : {}),
  };
};

export const formatMoney = (value: number, currency = "USD"): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
