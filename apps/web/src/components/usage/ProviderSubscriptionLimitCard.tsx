import type {
  ProviderSubscriptionUsageCost,
  ProviderSubscriptionUsageDetail,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type ReadySubscriptionUsage = Extract<
  ProviderSubscriptionUsageInstanceResult,
  { readonly state: "ready" }
>;

export interface ProviderSubscriptionPresentation {
  readonly accentColor: string;
  readonly name: string;
}

const CURSOR_ACCENT_COLOR = "#00bfa5";
const PRESENTATIONS: Readonly<Record<string, ProviderSubscriptionPresentation>> = {
  claudeAgent: { accentColor: "#cc7c5e", name: "Claude" },
  codex: { accentColor: "#49a3b0", name: "Codex" },
  cursor: { accentColor: CURSOR_ACCENT_COLOR, name: "Cursor" },
  grok: { accentColor: "#10a37f", name: "Grok" },
  opencode: { accentColor: "#3b82f6", name: "OpenCode" },
};
const FALLBACK_PRESENTATION: ProviderSubscriptionPresentation = {
  accentColor: "#94a3b8",
  name: "Provider",
};
const CURSOR_CREDIT_IDS = new Set(["personal-on-demand", "team-on-demand"]);

const percentage = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const moneyFormatters = new Map<string, Intl.NumberFormat>();
const compactMoneyFormatters = new Map<string, Intl.NumberFormat>();
const tokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const absoluteDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const providerSubscriptionPresentationFor = (
  driver: ReadySubscriptionUsage["driver"],
): ProviderSubscriptionPresentation => PRESENTATIONS[driver] ?? FALLBACK_PRESENTATION;

const moneyFormatter = (currencyCode: string) => {
  const existing = moneyFormatters.get(currencyCode);
  if (existing) return existing;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  moneyFormatters.set(currencyCode, formatter);
  return formatter;
};

const compactMoneyFormatter = (currencyCode: string, maximumFractionDigits: number) => {
  const key = `${currencyCode}:${maximumFractionDigits}`;
  const existing = compactMoneyFormatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits,
  });
  compactMoneyFormatters.set(key, formatter);
  return formatter;
};

const formatMoney = (value: number, currencyCode: string): string =>
  moneyFormatter(currencyCode).format(value);

const formatCompactMoney = (value: number, currencyCode: string): string =>
  compactMoneyFormatter(currencyCode, value >= 100 ? 0 : value >= 10 ? 1 : 2).format(value);

const formatTokens = (value: number): string => tokenFormatter.format(value);

const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
};

const formatUpdated = (value: string, now: Date): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const age = Math.max(0, now.getTime() - timestamp);
  if (age < 30_000) return "just now";
  if (age < 60 * 60_000) return `${Math.round(age / 60_000)}m ago`;
  if (age < 24 * 60 * 60_000) return `${Math.round(age / (60 * 60_000))}h ago`;
  return `${Math.round(age / (24 * 60 * 60_000))}d ago`;
};

const sourceLabel = (source: ReadySubscriptionUsage["source"]): string => {
  switch (source) {
    case "provider-app":
      return "Provider app";
    case "manual-credential":
      return "Saved credential";
    case "provider-cli":
      return "Provider CLI";
  }
};

const titleCase = (value: string): string =>
  value
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");

const formatPlan = (
  driver: ReadySubscriptionUsage["driver"],
  value: string | undefined,
): string | undefined => {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]+/gu, " ");
  if (driver === "codex") {
    if (normalized === "pro") return "Pro 20x";
    if (normalized === "prolite" || normalized === "pro lite") return "Pro 5x";
  }
  if (driver === "opencode" && normalized.startsWith("opencode ")) {
    return `OpenCode ${titleCase(normalized.slice("opencode ".length))}`;
  }
  const title = titleCase(value);
  return driver === "cursor" && !/^cursor\b/iu.test(title) ? `Cursor ${title}` : title;
};

interface PacePresentation {
  readonly markerPercent: number;
  readonly label: string;
  readonly forecast: string;
  readonly isDeficit: boolean;
}

const windowPace = (
  window: ProviderSubscriptionUsageWindow,
  now: Date,
): PacePresentation | undefined => {
  if (!window.durationMinutes || !window.resetsAt) return undefined;
  const resetsAt = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAt)) return undefined;
  const duration = window.durationMinutes * 60_000;
  const remainingTime = resetsAt - now.getTime();
  if (duration <= 0 || remainingTime <= 0 || remainingTime > duration) return undefined;
  const elapsed = Math.max(0, Math.min(duration, duration - remainingTime));
  const expectedUsed = (elapsed / duration) * 100;
  const actualUsed = Math.max(0, Math.min(100, window.usedPercent));
  if (elapsed === 0 && actualUsed > 0) return undefined;
  const delta = actualUsed - expectedUsed;
  const roundedDelta = Math.round(Math.abs(delta));
  const label =
    Math.abs(delta) <= 2
      ? "On pace"
      : delta > 0
        ? `${roundedDelta}% in deficit`
        : `${roundedDelta}% in reserve`;

  let forecast: string | undefined;
  if (actualUsed >= 100) {
    forecast = "Runs out now";
  } else if (elapsed > 0 && actualUsed > 0) {
    const projectedEmptyIn = (100 - actualUsed) / (actualUsed / elapsed);
    forecast =
      projectedEmptyIn >= remainingTime
        ? "Lasts until reset"
        : `Runs out in ${formatDuration(projectedEmptyIn)}`;
  } else if (elapsed > 0 && actualUsed === 0) {
    forecast = "Lasts until reset";
  }
  if (!forecast) return undefined;
  return {
    markerPercent: Math.max(0, Math.min(100, 100 - expectedUsed)),
    label,
    forecast,
    isDeficit: delta > 0,
  };
};

const resetText = (window: ProviderSubscriptionUsageWindow, now: Date): string | undefined => {
  if (!window.resetsAt) return undefined;
  const resetsAt = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAt)) return undefined;
  const remaining = resetsAt - now.getTime();
  return remaining > 0 ? `Resets in ${formatDuration(remaining)}` : "Reset due";
};

export function ProviderSubscriptionWindow({
  window,
  now,
  idPrefix = "provider",
  accentColor = CURSOR_ACCENT_COLOR,
}: {
  readonly window: ProviderSubscriptionUsageWindow;
  readonly now: Date;
  readonly idPrefix?: string;
  readonly accentColor?: string;
}) {
  const remaining = Math.max(0, 100 - window.usedPercent);
  const clampedRemaining = Math.min(100, remaining);
  const pace = windowPace(window, now);
  const reset = resetText(window, now);
  const exhausted = window.usedPercent >= 100;
  const headingId = `${idPrefix}-window-${window.id}`;
  return (
    <section className="space-y-1.5" aria-labelledby={headingId}>
      <h4 id={headingId} className="text-sm font-semibold text-foreground">
        {window.label}
      </h4>
      <div
        role="progressbar"
        aria-label={`${window.label} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedRemaining}
        aria-valuetext={`${percentage.format(remaining)} percent left, ${percentage.format(window.usedPercent)} percent used`}
        className="relative h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn("block h-full rounded-full", exhausted && "bg-destructive")}
          style={{
            width: `${clampedRemaining}%`,
            ...(exhausted ? {} : { backgroundColor: accentColor }),
          }}
        />
        {[50, 20].map((marker) => (
          <span
            key={marker}
            aria-hidden
            className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-card/90 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-muted-foreground/55"
            style={{ left: `${marker}%` }}
          />
        ))}
        {pace && Math.abs(pace.markerPercent - 50) > 1 && Math.abs(pace.markerPercent - 20) > 1 ? (
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-0 w-[5px] -translate-x-1/2 bg-card/90 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2",
              pace.isDeficit ? "after:bg-destructive" : "after:bg-success",
            )}
            style={{ left: `${pace.markerPercent}%` }}
          />
        ) : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-2xs leading-4 tabular-nums">
        <span className="font-medium text-foreground">{percentage.format(remaining)}% left</span>
        {reset ? <span className="text-right text-muted-foreground">{reset}</span> : <span />}
        {pace ? (
          <>
            <span className="font-medium text-foreground/85">{pace.label}</span>
            <span className="text-right text-muted-foreground">{pace.forecast}</span>
          </>
        ) : null}
      </div>
    </section>
  );
}

const parseDay = (value: string): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isFinite(date.getTime()) ? date : undefined;
};

const dayKey = (date: Date): string =>
  `${date.getUTCFullYear().toString().padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

const chartPoints = (cost: ProviderSubscriptionUsageCost, now: Date) => {
  const periodDays = Math.max(1, Math.min(365, cost.periodDays));
  const byDay = new Map(cost.daily.map((day) => [day.date, day] as const));
  const latestReported = cost.daily.at(-1)?.date;
  const localToday = dayKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const endKey = latestReported && latestReported > localToday ? latestReported : localToday;
  const end = parseDay(endKey);
  if (!end) return [];
  const points: Array<{
    readonly date: string;
    readonly cost: number | undefined;
    readonly tokens: number | undefined;
  }> = [];
  for (let offset = periodDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    const dateKey = dayKey(date);
    const reported = byDay.get(dateKey);
    points.push({ date: dateKey, cost: reported?.cost, tokens: reported?.tokens });
  }
  return points;
};

function ProviderCostDashboard({
  cost,
  now,
  presentation,
}: {
  readonly cost: ProviderSubscriptionUsageCost;
  readonly now: Date;
  readonly presentation: ProviderSubscriptionPresentation;
}) {
  // One tooltip for the whole chart, re-anchored to the bar under the pointer.
  // A period can run to 365 bars, and a tooltip root per bar is a real cost.
  const [hoveredBar, setHoveredBar] = useState<{
    readonly element: HTMLElement;
    readonly label: string;
  } | null>(null);
  const points = chartPoints(cost, now);
  const maxCost = points.reduce((maximum, point) => Math.max(maximum, point.cost ?? 0), 0);
  const maxTokens = points.reduce((maximum, point) => Math.max(maximum, point.tokens ?? 0), 0);
  const chartKind = maxCost > 0 ? "cost" : maxTokens > 0 ? "tokens" : undefined;
  const partialSuffix = cost.costCoverage === "partial" ? "*" : "";
  const metrics = [
    cost.meteredCost === undefined
      ? undefined
      : {
          label: `${presentation.name}-metered`,
          value: formatMoney(cost.meteredCost, cost.currencyCode),
        },
    cost.todayCost === undefined
      ? undefined
      : { label: "Today", value: formatMoney(cost.todayCost, cost.currencyCode) },
    cost.periodCost === undefined
      ? undefined
      : {
          label: `${cost.periodDays}d cost${partialSuffix}`,
          value: formatMoney(cost.periodCost, cost.currencyCode),
        },
    cost.latestTokens === undefined
      ? undefined
      : { label: "Latest tokens", value: formatTokens(cost.latestTokens) },
    cost.periodTokens === undefined
      ? undefined
      : { label: `${cost.periodDays}d tokens`, value: formatTokens(cost.periodTokens) },
  ].filter((metric): metric is { readonly label: string; readonly value: string } =>
    Boolean(metric),
  );
  const chartMaximum = chartKind === "cost" ? maxCost : maxTokens;

  return (
    <section className="space-y-2.5" aria-label={`${presentation.name} cost and token usage`}>
      {metrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <dt className="truncate text-2xs font-medium text-muted-foreground">
                {metric.label}
              </dt>
              <dd className="truncate text-sm font-semibold text-foreground tabular-nums">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {chartKind ? (
        <figure
          aria-label={`${cost.periodDays}-day ${presentation.name} ${chartKind} history`}
          className="space-y-1"
        >
          <figcaption className="text-right text-3xs text-muted-foreground tabular-nums">
            {chartKind === "cost"
              ? formatCompactMoney(chartMaximum, cost.currencyCode)
              : formatTokens(chartMaximum)}
          </figcaption>
          <div
            className="grid h-11 items-end gap-0.5 border-b border-border/70"
            style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
          >
            {points.map((point) => {
              const value = chartKind === "cost" ? point.cost : point.tokens;
              const height =
                value && chartMaximum > 0 ? Math.max(6, (value / chartMaximum) * 100) : 0;
              const label =
                value === undefined
                  ? `${point.date}: no reported usage`
                  : chartKind === "cost"
                    ? `${point.date}: ${formatMoney(value, cost.currencyCode)}`
                    : `${point.date}: ${formatTokens(value)} tokens`;
              return (
                <span
                  key={point.date}
                  aria-hidden
                  className="min-w-0 rounded-t-xs"
                  style={{ height: `${height}%`, backgroundColor: presentation.accentColor }}
                  onPointerEnter={(event) => setHoveredBar({ element: event.currentTarget, label })}
                  onPointerLeave={() =>
                    setHoveredBar((current) => (current?.label === label ? null : current))
                  }
                />
              );
            })}
          </div>
          <Tooltip open={hoveredBar !== null} onOpenChange={() => setHoveredBar(null)}>
            <TooltipPopup anchor={hoveredBar?.element ?? null}>{hoveredBar?.label}</TooltipPopup>
          </Tooltip>
        </figure>
      ) : null}
      <div className="space-y-0.5 text-2xs leading-4 text-muted-foreground">
        {cost.topModel ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="truncate">
                  <span className="font-medium text-foreground/70">Top model:</span> {cost.topModel}
                </p>
              }
            />
            <TooltipPopup>{cost.topModel}</TooltipPopup>
          </Tooltip>
        ) : null}
        {cost.scope === "local-environment" ? (
          <p>
            {cost.costCoverage === "unavailable"
              ? `Token totals from local ${presentation.name} logs; model pricing is unavailable.`
              : `Estimated from local ${presentation.name} logs at API rates; not a subscription bill.`}
          </p>
        ) : (
          <p>
            From {presentation.name}&apos;s usage dashboard at vendor token rates; may differ from
            your invoice.
          </p>
        )}
        {cost.costCoverage === "partial" ? (
          <p>* Cost excludes usage whose model pricing was unavailable.</p>
        ) : null}
      </div>
    </section>
  );
}

function DetailList({ details }: { readonly details: readonly ProviderSubscriptionUsageDetail[] }) {
  return (
    <dl className="space-y-1 text-xs">
      {details.map((detail) => (
        <div key={detail.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
          <dt className="min-w-0 text-muted-foreground">
            <span className="block truncate">{detail.label}</span>
            {detail.description ? (
              <span className="block truncate text-2xs leading-4 text-muted-foreground/80">
                {detail.description}
              </span>
            ) : null}
          </dt>
          <dd className="text-right text-foreground tabular-nums">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailSection({
  details,
  heading,
  headingId,
  subtitle,
}: {
  readonly details: readonly ProviderSubscriptionUsageDetail[];
  readonly heading: string;
  readonly headingId: string;
  readonly subtitle: string;
}) {
  if (details.length === 0) return null;
  return (
    <section className="space-y-1.5 border-t border-border/70 pt-3" aria-labelledby={headingId}>
      <div>
        <h4 id={headingId} className="text-sm font-semibold text-foreground">
          {heading}
        </h4>
        <p className="text-2xs leading-4 text-muted-foreground">{subtitle}</p>
      </div>
      <DetailList details={details} />
    </section>
  );
}

function ClaudeExtraUsage({
  details,
  window,
  headingId,
  accentColor,
}: {
  readonly details: readonly ProviderSubscriptionUsageDetail[];
  readonly window: ProviderSubscriptionUsageWindow | undefined;
  readonly headingId: string;
  readonly accentColor: string;
}) {
  if (!window && details.length === 0) return null;
  const status = details.find((detail) => detail.id === "extra-usage-status");
  const spent = details.find((detail) => detail.id === "extra-usage-used");
  const limit = details.find((detail) => detail.id === "extra-usage-limit");
  const used = Math.max(0, window?.usedPercent ?? 0);
  const clampedUsed = Math.min(100, used);
  return (
    <section className="space-y-1.5 border-t border-border/70 pt-3" aria-labelledby={headingId}>
      <div>
        <h4 id={headingId} className="text-sm font-semibold text-foreground">
          Extra usage
        </h4>
        <p className="text-2xs leading-4 text-muted-foreground">
          On-demand usage beyond included plan limits.
        </p>
      </div>
      {window ? (
        <>
          <div
            role="progressbar"
            aria-label="Extra usage used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampedUsed}
            aria-valuetext={`${percentage.format(used)} percent used`}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${clampedUsed}%`, backgroundColor: accentColor }}
            />
          </div>
          <div className="flex items-baseline justify-between gap-3 text-2xs leading-4">
            <span className="font-medium text-foreground tabular-nums">
              {percentage.format(used)}% used
            </span>
            {status ? <span className="text-muted-foreground">{status.value}</span> : null}
          </div>
        </>
      ) : null}
      {spent || limit ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {spent && limit
            ? `Monthly cap: ${spent.value} / ${limit.value}`
            : `${spent?.label ?? limit?.label}: ${spent?.value ?? limit?.value}`}
        </p>
      ) : null}
      {!window && status ? <DetailList details={[status]} /> : null}
    </section>
  );
}

interface DetailPresentation {
  readonly supplemental: readonly ProviderSubscriptionUsageDetail[];
  readonly sections: ReadonlyArray<{
    readonly heading: string;
    readonly subtitle: string;
    readonly details: readonly ProviderSubscriptionUsageDetail[];
  }>;
}

const detailPresentation = (
  driver: ReadySubscriptionUsage["driver"],
  details: ReadySubscriptionUsage["details"],
): DetailPresentation => {
  if (driver === "cursor") {
    const credits = details.filter((detail) => CURSOR_CREDIT_IDS.has(detail.id));
    return {
      supplemental: details.filter(
        (detail) => detail.id !== "included" && !CURSOR_CREDIT_IDS.has(detail.id),
      ),
      sections: [
        {
          heading: "Credits",
          subtitle: "On-demand usage beyond included plan limits.",
          details: credits,
        },
      ],
    };
  }
  if (driver === "claudeAgent") {
    return {
      supplemental: details.filter((detail) => !detail.id.startsWith("extra-usage")),
      sections: [],
    };
  }
  if (driver === "codex") {
    const credits = details.filter(
      (detail) =>
        detail.id.endsWith(":credits") ||
        detail.id === "reset-credits" ||
        detail.id.startsWith("reset-credit:"),
    );
    const spending = details.filter(
      (detail) => detail.id.includes(":spend-") || detail.id.endsWith(":spend-control"),
    );
    const handled = new Set([...credits, ...spending].map((detail) => detail.id));
    return {
      supplemental: details.filter((detail) => !handled.has(detail.id)),
      sections: [
        {
          heading: "Credits",
          subtitle: "Credits and resets reported by the Codex account.",
          details: credits,
        },
        {
          heading: "Spending",
          subtitle: "Account spending controls for Codex usage.",
          details: spending,
        },
      ],
    };
  }
  if (driver === "grok") {
    const onDemand = details.filter((detail) => detail.id.startsWith("on-demand"));
    return {
      supplemental: details.filter((detail) => !detail.id.startsWith("on-demand")),
      sections: [
        {
          heading: "On-demand",
          subtitle: "Usage beyond the included monthly allowance.",
          details: onDemand,
        },
      ],
    };
  }
  if (driver === "opencode") {
    const credits = details.filter((detail) => detail.id === "zen-balance");
    return {
      supplemental: details.filter((detail) => detail.id !== "zen-balance"),
      sections: [
        {
          heading: "Credits",
          subtitle: "Prepaid Zen balance available for model usage.",
          details: credits,
        },
      ],
    };
  }
  return { supplemental: details, sections: [] };
};

export function ProviderSubscriptionLimitCard({
  instance,
  now,
}: {
  readonly instance: ReadySubscriptionUsage;
  readonly now?: Date;
}) {
  const renderTime = now ?? new Date();
  const presentation = providerSubscriptionPresentationFor(instance.driver);
  const isStale = instance.freshness === "stale";
  const plan = formatPlan(instance.driver, instance.planLabel);
  const details = detailPresentation(instance.driver, instance.details);
  const extraUsageWindow =
    instance.driver === "claudeAgent"
      ? instance.windows.find((window) => window.id === "extra-usage")
      : undefined;
  const windows = instance.windows.filter(
    (window) => instance.driver !== "claudeAgent" || window.id !== "extra-usage",
  );
  const extraUsageDetails = instance.details.filter((detail) =>
    detail.id.startsWith("extra-usage"),
  );
  const cardId = `${instance.driver}-${instance.instanceId}`;
  const refreshedAt = Date.parse(instance.fetchedAt);
  const absoluteRefresh = Number.isFinite(refreshedAt)
    ? absoluteDateTimeFormatter.format(refreshedAt)
    : instance.fetchedAt;
  const hasContent =
    windows.length > 0 ||
    details.supplemental.length > 0 ||
    details.sections.some((section) => section.details.length > 0) ||
    Boolean(instance.cost) ||
    Boolean(extraUsageWindow) ||
    extraUsageDetails.length > 0;

  return (
    <article
      className={cn(
        "min-w-0 rounded-lg border bg-card/30 p-4",
        isStale ? "border-warning/45" : "border-border",
      )}
    >
      <header className="border-b border-border/70 pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
          <h3 className="truncate text-sm font-semibold text-foreground">{instance.displayName}</h3>
          {instance.accountLabel ? (
            <RedactedSensitiveText
              value={instance.accountLabel}
              ariaLabel="Toggle subscription account visibility"
              revealTooltip="Click to reveal account"
              hideTooltip="Click to hide account"
              className="max-w-64 truncate text-right"
            />
          ) : (
            <span aria-hidden />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="text-2xs text-muted-foreground">
                  Updated {formatUpdated(instance.fetchedAt, renderTime)}
                </span>
              }
            />
            <TooltipPopup>{`${sourceLabel(instance.source)} · Refreshed ${absoluteRefresh}`}</TooltipPopup>
          </Tooltip>
          <span
            className={cn(
              "text-right text-2xs text-muted-foreground",
              isStale && "font-semibold text-warning",
            )}
          >
            {[plan ?? sourceLabel(instance.source), isStale ? "Stale" : undefined]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </header>

      <div className="mt-3 space-y-3.5">
        {windows.map((window) => (
          <ProviderSubscriptionWindow
            key={window.id}
            window={window}
            now={renderTime}
            idPrefix={cardId}
            accentColor={presentation.accentColor}
          />
        ))}
        {details.supplemental.length > 0 ? <DetailList details={details.supplemental} /> : null}
        {instance.cost ? (
          <ProviderCostDashboard
            cost={instance.cost}
            now={renderTime}
            presentation={presentation}
          />
        ) : null}
        {details.sections.map((section) => (
          <DetailSection
            key={section.heading}
            details={section.details}
            heading={section.heading}
            headingId={`${cardId}-${section.heading.toLowerCase()}`}
            subtitle={section.subtitle}
          />
        ))}
        {instance.driver === "claudeAgent" ? (
          <ClaudeExtraUsage
            window={extraUsageWindow}
            details={extraUsageDetails}
            headingId={`${cardId}-extra-usage`}
            accentColor={presentation.accentColor}
          />
        ) : null}
        {!hasContent ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            This account did not report any allowance details.
          </p>
        ) : null}
        {isStale && instance.message ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {instance.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
