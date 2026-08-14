import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@vetra-code/contracts";
import { memo, useRef, useState, type FocusEvent } from "react";

import type { EnvironmentProviderSubscriptionUsageStatus } from "../../state/providerSubscriptionUsage";
import { useProviderSubscriptionUsage } from "../../state/providerSubscriptionUsage";
import { CircularUsageMeterButton } from "../ui/circular-usage-meter";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  SubscriptionLimitCard,
  SubscriptionUsageStatusCard,
  type SubscriptionUsageStatusKind,
} from "../usage/SubscriptionLimitsSection";
import { providerSubscriptionPresentationFor } from "../usage/ProviderSubscriptionLimitCard";

type ResolvedThreadSubscriptionUsage =
  | {
      readonly kind: "instance";
      readonly instance: ProviderSubscriptionUsageInstanceResult;
      readonly summaryWindow: ProviderSubscriptionUsageWindow | null;
    }
  | {
      readonly kind: "status";
      readonly status: SubscriptionUsageStatusKind;
    };

const percentFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

function highestUsedWindow(
  instance: ProviderSubscriptionUsageInstanceResult,
): ProviderSubscriptionUsageWindow | null {
  if (instance.state !== "ready") return null;
  let highest: ProviderSubscriptionUsageWindow | null = null;
  for (const window of instance.windows) {
    if (!Number.isFinite(window.usedPercent)) continue;
    if (highest === null || window.usedPercent > highest.usedPercent) {
      highest = window;
    }
  }
  return highest;
}

export function resolveThreadSubscriptionUsage(
  environments: readonly EnvironmentProviderSubscriptionUsageStatus[],
  environmentId: EnvironmentId,
  providerInstanceId: ProviderInstanceId,
): ResolvedThreadSubscriptionUsage {
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  if (!environment) return { kind: "status", status: "loading" };

  switch (environment.error) {
    case "offline":
      return { kind: "status", status: "offline" };
    case "not-supported":
    case "contract-version":
      return { kind: "status", status: "not-supported" };
    case "error":
      return { kind: "status", status: "error" };
    case null:
      break;
  }

  const instance = environment.report?.instances.find(
    (entry) => entry.instanceId === providerInstanceId,
  );
  if (instance) {
    return {
      kind: "instance",
      instance,
      summaryWindow: highestUsedWindow(instance),
    };
  }
  if (environment.isPending) return { kind: "status", status: "loading" };
  return {
    kind: "status",
    status: environment.report === null ? "empty" : "missing-instance",
  };
}

export function threadSubscriptionUsageRingColor(
  instance: Extract<ProviderSubscriptionUsageInstanceResult, { readonly state: "ready" }>,
  window: ProviderSubscriptionUsageWindow,
): string {
  if (window.usedPercent >= 100) return "var(--color-error)";
  if (instance.freshness === "stale" || window.usedPercent >= 95) {
    return "var(--color-warning)";
  }
  return providerSubscriptionPresentationFor(instance.driver).accentColor;
}

const fallbackDisplayName = (instanceId: ProviderInstanceId): string =>
  instanceId
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .split(/[_\s-]+/gu)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");

const neutralAriaLabel = (
  displayName: string,
  resolved: ResolvedThreadSubscriptionUsage,
): string => {
  if (resolved.kind === "instance") {
    switch (resolved.instance.state) {
      case "needs-auth":
        return `${displayName} subscription usage needs authentication`;
      case "unsupported":
        return `${displayName} subscription usage is not supported`;
      case "error":
        return `${displayName} subscription usage is unavailable`;
      case "ready":
        return `${displayName} subscription usage has no percentage window`;
    }
  }
  switch (resolved.status) {
    case "loading":
      return `${displayName} subscription usage is loading`;
    case "offline":
      return `${displayName} subscription usage is unavailable while the environment is offline`;
    case "not-supported":
      return `${displayName} subscription usage is not supported`;
    case "error":
      return `${displayName} subscription usage could not be loaded`;
    case "empty":
    case "missing-instance":
      return `${displayName} subscription usage has not been reported`;
  }
};

export const ThreadSubscriptionUsageIndicator = memo(function ThreadSubscriptionUsageIndicator({
  environmentId,
  providerInstanceId,
  providerDisplayName,
}: {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerDisplayName?: string | null;
}) {
  const { environments } = useProviderSubscriptionUsage();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const resolved = resolveThreadSubscriptionUsage(environments, environmentId, providerInstanceId);
  const displayName =
    resolved.kind === "instance"
      ? resolved.instance.displayName
      : providerDisplayName?.trim() || fallbackDisplayName(providerInstanceId);
  const readyInstance =
    resolved.kind === "instance" && resolved.instance.state === "ready" ? resolved.instance : null;
  const summaryWindow = resolved.kind === "instance" ? resolved.summaryWindow : null;
  const value = summaryWindow?.usedPercent ?? null;
  const indicatorColor =
    readyInstance && summaryWindow
      ? threadSubscriptionUsageRingColor(readyInstance, summaryWindow)
      : "color-mix(in oklab, var(--color-muted-foreground) 42%, transparent)";
  const ariaLabel = summaryWindow
    ? `${displayName} subscription usage: ${summaryWindow.label} ${percentFormatter.format(summaryWindow.usedPercent)}% used${readyInstance?.freshness === "stale" ? ", stale reading" : ""}`
    : neutralAriaLabel(displayName, resolved);
  const handleTriggerFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (event.relatedTarget instanceof Node && popupRef.current?.contains(event.relatedTarget)) {
      return;
    }
    if (event.currentTarget.matches(":focus-visible")) setPopoverOpen(true);
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={
          <CircularUsageMeterButton
            value={value}
            indicatorColor={indicatorColor}
            aria-label={ariaLabel}
            className="pointer-events-auto"
            data-thread-subscription-usage="true"
            onFocus={handleTriggerFocus}
          />
        }
      />
      <PopoverPopup
        ref={popupRef}
        side="top"
        align="start"
        sideOffset={8}
        initialFocus={false}
        viewportClassName="p-0"
        className="w-[min(26rem,calc(100vw-2rem))] max-w-none text-left whitespace-normal"
        aria-label={`${displayName} subscription usage details`}
      >
        {resolved.kind === "instance" ? (
          <SubscriptionLimitCard environmentId={environmentId} instance={resolved.instance} />
        ) : (
          <SubscriptionUsageStatusCard status={resolved.status} />
        )}
      </PopoverPopup>
    </Popover>
  );
});
