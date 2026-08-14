/**
 * Live subscription-limit reporting for materialized provider instances.
 *
 * Unlike transcript usage, these values come from a provider-owned quota
 * surface. Results are deliberately instance-scoped so clients never merge
 * accounts across environments or provider configurations.
 *
 * @module providerSubscriptionUsage
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION = 1 as const;

export const ProviderSubscriptionUsageSource = Schema.Literals([
  "provider-cli",
  "provider-app",
  "manual-credential",
]);
export type ProviderSubscriptionUsageSource = typeof ProviderSubscriptionUsageSource.Type;

export const ProviderSubscriptionUsageState = Schema.Literals([
  "ready",
  "needs-auth",
  "unsupported",
  "error",
]);
export type ProviderSubscriptionUsageState = typeof ProviderSubscriptionUsageState.Type;

export const ProviderSubscriptionUsageFreshness = Schema.Literals(["fresh", "stale"]);
export type ProviderSubscriptionUsageFreshness = typeof ProviderSubscriptionUsageFreshness.Type;

const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const ProviderSubscriptionIsoDateTime = IsoDateTime.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/u),
);

export const ProviderSubscriptionUsageWindow = Schema.Struct({
  /** Stable within this provider adapter and account. */
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  /** Raw provider value. Values over 100 are preserved for diagnostics and text. */
  usedPercent: NonNegativeNumber,
  durationMinutes: Schema.optionalKey(NonNegativeInt),
  resetsAt: Schema.optionalKey(ProviderSubscriptionIsoDateTime),
});
export type ProviderSubscriptionUsageWindow = typeof ProviderSubscriptionUsageWindow.Type;

/** Provider-specific values that are useful but are not percentage windows. */
export const ProviderSubscriptionUsageDetail = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
  description: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProviderSubscriptionUsageDetail = typeof ProviderSubscriptionUsageDetail.Type;

export const ProviderSubscriptionUsageCostDay = Schema.Struct({
  /** Provider-local calendar day in YYYY-MM-DD form. */
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  /** API-rate cost for this day. Missing means the provider omitted pricing. */
  cost: Schema.optionalKey(NonNegativeNumber),
  tokens: Schema.optionalKey(NonNegativeInt),
});
export type ProviderSubscriptionUsageCostDay = typeof ProviderSubscriptionUsageCostDay.Type;

export const ProviderSubscriptionUsageCostScope = Schema.Literals([
  "provider-account",
  "local-environment",
]);
export type ProviderSubscriptionUsageCostScope = typeof ProviderSubscriptionUsageCostScope.Type;

export const ProviderSubscriptionUsageCostCoverage = Schema.Literals([
  "complete",
  "partial",
  "unavailable",
]);
export type ProviderSubscriptionUsageCostCoverage =
  typeof ProviderSubscriptionUsageCostCoverage.Type;

/** Optional cost and token history shown alongside subscription allowances. */
export const ProviderSubscriptionUsageCost = Schema.Struct({
  currencyCode: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/u)),
  periodDays: PositiveInt.check(Schema.isLessThanOrEqualTo(365)),
  /** Whether the history covers the provider account or only this environment's local logs. */
  scope: Schema.optionalKey(ProviderSubscriptionUsageCostScope),
  /** Whether every usage record had pricing available for the displayed cost totals. */
  costCoverage: Schema.optionalKey(ProviderSubscriptionUsageCostCoverage),
  /** What the provider actually deducted over the period, when reported completely. */
  meteredCost: Schema.optionalKey(NonNegativeNumber),
  todayCost: Schema.optionalKey(NonNegativeNumber),
  periodCost: Schema.optionalKey(NonNegativeNumber),
  latestTokens: Schema.optionalKey(NonNegativeInt),
  periodTokens: Schema.optionalKey(NonNegativeInt),
  topModel: Schema.optionalKey(TrimmedNonEmptyString),
  daily: Schema.Array(ProviderSubscriptionUsageCostDay).check(Schema.isMaxLength(365)),
});
export type ProviderSubscriptionUsageCost = typeof ProviderSubscriptionUsageCost.Type;

const ProviderSubscriptionUsageInstanceFields = {
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: TrimmedNonEmptyString,
  source: Schema.optionalKey(ProviderSubscriptionUsageSource),
  accountLabel: Schema.optionalKey(TrimmedNonEmptyString),
  planLabel: Schema.optionalKey(TrimmedNonEmptyString),
  message: Schema.optionalKey(TrimmedNonEmptyString),
  windows: Schema.Array(ProviderSubscriptionUsageWindow),
  details: Schema.Array(ProviderSubscriptionUsageDetail),
} as const;

const ProviderSubscriptionUsageReadyResult = Schema.Struct({
  ...ProviderSubscriptionUsageInstanceFields,
  state: Schema.Literal("ready"),
  freshness: ProviderSubscriptionUsageFreshness,
  /** Timestamp of the provider read that produced the displayed data. */
  fetchedAt: ProviderSubscriptionIsoDateTime,
  source: ProviderSubscriptionUsageSource,
  cost: Schema.optionalKey(ProviderSubscriptionUsageCost),
});

const ProviderSubscriptionUsageUnavailableResult = Schema.Struct({
  ...ProviderSubscriptionUsageInstanceFields,
  state: Schema.Literals(["needs-auth", "unsupported", "error"]),
  /** Non-ready results cannot masquerade as a cached ready snapshot. */
  freshness: Schema.optionalKey(Schema.Never),
  fetchedAt: Schema.optionalKey(Schema.Never),
});

export const ProviderSubscriptionUsageInstanceResult = Schema.Union([
  ProviderSubscriptionUsageReadyResult,
  ProviderSubscriptionUsageUnavailableResult,
]);
export type ProviderSubscriptionUsageInstanceResult =
  typeof ProviderSubscriptionUsageInstanceResult.Type;

export const ProviderSubscriptionUsageReport = Schema.Struct({
  contractVersion: NonNegativeInt,
  readAt: ProviderSubscriptionIsoDateTime,
  instances: Schema.Array(ProviderSubscriptionUsageInstanceResult),
});
export type ProviderSubscriptionUsageReport = typeof ProviderSubscriptionUsageReport.Type;

export const ProviderSubscriptionUsageReadInput = Schema.Struct({
  forceRefresh: Schema.optionalKey(Schema.Boolean),
});
export type ProviderSubscriptionUsageReadInput = typeof ProviderSubscriptionUsageReadInput.Type;

export const ProviderSubscriptionCredentialInput = Schema.Struct({
  instanceId: ProviderInstanceId,
});
export type ProviderSubscriptionCredentialInput = typeof ProviderSubscriptionCredentialInput.Type;

export const ProviderSubscriptionCredentialRequirement = Schema.Literals([
  "none",
  "optional",
  "required",
]);
export type ProviderSubscriptionCredentialRequirement =
  typeof ProviderSubscriptionCredentialRequirement.Type;

export const ProviderSubscriptionCredentialStatus = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  requirement: ProviderSubscriptionCredentialRequirement,
  configured: Schema.Boolean,
  detail: TrimmedNonEmptyString,
});
export type ProviderSubscriptionCredentialStatus = typeof ProviderSubscriptionCredentialStatus.Type;

export const ProviderSubscriptionCredentialSetInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  // Redaction is part of the wire contract so validation, defects, and tracing
  // cannot render the credential value while it crosses Effect RPC.
  secret: Schema.Redacted(TrimmedNonEmptyString.check(Schema.isMaxLength(32_768))),
});
export type ProviderSubscriptionCredentialSetInput =
  typeof ProviderSubscriptionCredentialSetInput.Type;

export class ProviderSubscriptionUsageError extends Schema.TaggedErrorClass<ProviderSubscriptionUsageError>()(
  "ProviderSubscriptionUsageError",
  {
    reason: Schema.Literals([
      "unknown-instance",
      "unsupported",
      "invalid-credential",
      "read-failed",
      "write-failed",
    ]),
    /** Stable, sanitized message. Provider response bodies and secrets never cross the wire. */
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Provider subscription usage failed (${this.reason}): ${this.detail}`;
  }
}
