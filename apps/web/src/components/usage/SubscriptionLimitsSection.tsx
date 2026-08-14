import type { ProviderSubscriptionUsageInstanceResult } from "@vetra-code/contracts";
import { Link } from "@tanstack/react-router";
import {
  CircleAlertIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  WifiOffIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import type { EnvironmentProviderSubscriptionUsageStatus } from "../../state/providerSubscriptionUsage";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { ProviderSubscriptionLimitCard } from "./ProviderSubscriptionLimitCard";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatTimestamp = (value: string): string => {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? dateTimeFormatter.format(milliseconds) : value;
};

export type SubscriptionUsageStatusKind =
  | "offline"
  | "not-supported"
  | "error"
  | "empty"
  | "loading"
  | "missing-instance";

const SUBSCRIPTION_USAGE_STATUS_PRESENTATION: Readonly<
  Record<
    SubscriptionUsageStatusKind,
    { readonly icon: typeof CircleAlertIcon; readonly message: string }
  >
> = {
  offline: {
    icon: WifiOffIcon,
    message:
      "This environment is not connected. Its provider limits are not merged with another device.",
  },
  "not-supported": {
    icon: CircleAlertIcon,
    message:
      "Subscription limits are not supported by this environment. API-equivalent activity remains available in its tab.",
  },
  error: {
    icon: CircleAlertIcon,
    message:
      "Subscription limits could not be loaded from this environment. API-equivalent activity remains available in its tab.",
  },
  empty: {
    icon: CircleAlertIcon,
    message: "No enabled provider instances reported subscription limits.",
  },
  loading: {
    icon: CircleDashedIcon,
    message: "Loading subscription limits for the selected provider.",
  },
  "missing-instance": {
    icon: CircleAlertIcon,
    message: "The selected provider has not reported subscription limits yet.",
  },
};

export function SubscriptionUsageStatusCard({
  status,
}: {
  readonly status: SubscriptionUsageStatusKind;
}) {
  const presentation = SUBSCRIPTION_USAGE_STATUS_PRESENTATION[status];
  const Icon = presentation.icon;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{presentation.message}</span>
    </div>
  );
}

export function SubscriptionLimitsSection({
  environments,
  isRefreshing,
  onRefresh,
}: {
  readonly environments: readonly EnvironmentProviderSubscriptionUsageStatus[];
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <section aria-labelledby="subscription-limits-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h1 id="subscription-limits-heading" className="text-lg font-semibold text-foreground">
            Subscription limits
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Live allowance windows reported by each provider account. Limits stay separate by device
            and provider instance.{" "}
            <Link
              to="/settings/providers"
              hash="subscription-usage-refresh"
              className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              Refresh interval and limit alerts
            </Link>{" "}
            are configured in provider settings.
          </p>
        </div>
        <div className="flex items-center">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onRefresh}
            disabled={
              isRefreshing ||
              !environments.some((environment) => environment.connectionPhase === "connected")
            }
            aria-label="Refresh subscription limits"
          >
            <RefreshCwIcon className={cn(isRefreshing && "animate-spin")} aria-hidden />
            Refresh now
          </Button>
        </div>
      </div>

      {environments.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground">
          Connect an environment to read provider subscription limits.
        </div>
      ) : (
        <div className="space-y-5">
          {environments.map((environment) => (
            <EnvironmentSubscriptionLimits
              key={environment.environmentId}
              environment={environment}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function EnvironmentSubscriptionLimits({
  environment,
}: {
  readonly environment: EnvironmentProviderSubscriptionUsageStatus;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex min-h-6 items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {environment.label}
        </h2>
        {environment.report ? (
          <span className="text-[11px] text-muted-foreground">
            Read {formatTimestamp(environment.report.readAt)}
          </span>
        ) : null}
      </div>

      {environment.error === "offline" ? (
        <SubscriptionUsageStatusCard status="offline" />
      ) : environment.error === "not-supported" || environment.error === "contract-version" ? (
        <SubscriptionUsageStatusCard status="not-supported" />
      ) : environment.error === "error" ? (
        <SubscriptionUsageStatusCard status="error" />
      ) : environment.isPending && environment.report === null ? (
        <div
          aria-label={`Loading subscription limits for ${environment.label}`}
          className="grid gap-3 sm:grid-cols-2"
        >
          {[0, 1].map((index) => (
            <div key={index} className="h-36 rounded-lg border border-border bg-muted/25" />
          ))}
        </div>
      ) : environment.report?.instances.length ? (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          {environment.report.instances.map((instance) => (
            <SubscriptionLimitCard
              key={instance.instanceId}
              environmentId={environment.environmentId}
              instance={instance}
            />
          ))}
        </div>
      ) : (
        <SubscriptionUsageStatusCard status="empty" />
      )}
    </div>
  );
}

export function SubscriptionLimitCard({
  environmentId,
  instance,
}: {
  readonly environmentId: EnvironmentProviderSubscriptionUsageStatus["environmentId"];
  readonly instance: ProviderSubscriptionUsageInstanceResult;
}) {
  if (instance.state === "ready") {
    return <ProviderSubscriptionLimitCard instance={instance} />;
  }
  return (
    <article className="min-w-0 rounded-lg border border-border bg-card/30 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <ProviderInstanceIcon
          driverKind={instance.driver}
          displayName={instance.displayName}
          className="mt-0.5 size-5"
          iconClassName="size-4 text-foreground/80"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-sm font-medium text-foreground">{instance.displayName}</h3>
            {instance.planLabel ? (
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {instance.planLabel}
              </span>
            ) : null}
          </div>
          {instance.accountLabel ? (
            <RedactedSensitiveText
              value={instance.accountLabel}
              ariaLabel="Toggle subscription account visibility"
              revealTooltip="Click to reveal account"
              hideTooltip="Click to hide account"
              className="max-w-full truncate"
            />
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p
          className={cn(
            "flex items-start gap-2 text-xs leading-relaxed",
            instance.state === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {instance.state === "needs-auth" ? (
            <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span>{instance.message ?? "Subscription limits are unavailable."}</span>
        </p>
        {instance.state === "needs-auth" ? (
          <Link
            to="/settings/providers"
            hash={`provider-instance/${encodeURIComponent(environmentId)}/${encodeURIComponent(instance.instanceId)}`}
            className="inline-flex text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            Open {instance.displayName} settings
          </Link>
        ) : null}
      </div>
    </article>
  );
}
