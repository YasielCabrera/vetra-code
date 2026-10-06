/** Multi-environment live provider subscription-limit state. */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderSubscriptionUsageReport,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export type EnvironmentProviderSubscriptionUsageError =
  | "offline"
  | "not-supported"
  | "contract-version"
  | "error";

export interface EnvironmentProviderSubscriptionUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly providerInstancesKey: string | null;
  readonly isPending: boolean;
  readonly error: EnvironmentProviderSubscriptionUsageError | null;
  readonly report: ProviderSubscriptionUsageReport | null;
}

type ProviderInstanceAvailability = {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly enabled: boolean;
};

export const enabledProviderInstancesKey = (
  providers: readonly ProviderInstanceAvailability[],
): string =>
  JSON.stringify(
    providers
      .filter((provider) => provider.enabled)
      .map((provider) => [provider.instanceId, provider.driver])
      .toSorted(([leftId, leftDriver], [rightId, rightDriver]) =>
        `${leftId}\u0000${leftDriver}`.localeCompare(`${rightId}\u0000${rightDriver}`),
      ),
  );

export const filterReportToEnabledProviderInstances = (
  report: ProviderSubscriptionUsageReport,
  providers: readonly ProviderInstanceAvailability[],
): ProviderSubscriptionUsageReport => {
  const enabledIds = new Set(
    providers.filter((provider) => provider.enabled).map((provider) => provider.instanceId),
  );
  return {
    ...report,
    instances: report.instances.filter((instance) => enabledIds.has(instance.instanceId)),
  };
};

export function presentConnectedProviderSubscriptionUsage(
  result: AsyncResult.AsyncResult<ProviderSubscriptionUsageReport, unknown>,
): Pick<EnvironmentProviderSubscriptionUsageStatus, "isPending" | "error" | "report"> {
  const report = Option.getOrNull(AsyncResult.value(result));
  const contractVersionMismatch =
    report !== null && report.contractVersion !== PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION;
  const failure =
    result._tag === "Failure" ? String(Cause.squash(result.cause)).toLowerCase() : undefined;
  const methodUnsupported =
    failure !== undefined &&
    /(?:method|rpc)[^\n]*(?:not found|unknown|unsupported)|no handler[^\n]*provider.*subscription/iu.test(
      failure,
    );
  return {
    isPending: result.waiting,
    error:
      result._tag === "Failure"
        ? methodUnsupported
          ? "not-supported"
          : "error"
        : contractVersionMismatch
          ? "contract-version"
          : null,
    report: contractVersionMismatch ? null : report,
  };
}

export const providerSubscriptionUsageStatusesAtom = Atom.make(
  (get): readonly EnvironmentProviderSubscriptionUsageStatus[] => {
    const presentations = get(environmentPresentations.presentationsAtom);
    const statuses: EnvironmentProviderSubscriptionUsageStatus[] = [];

    for (const [environmentId, presentation] of presentations) {
      if (presentation.connection.phase !== "connected") {
        statuses.push({
          environmentId,
          label: presentation.entry.target.label,
          connectionPhase: presentation.connection.phase,
          providerInstancesKey: null,
          isPending: false,
          error: "offline",
          report: null,
        });
        continue;
      }

      const result = get(
        serverEnvironment.providerSubscriptionUsage({
          environmentId,
          input: {},
        }),
      );
      const providers = get(serverEnvironment.providersValueAtom(environmentId));
      const presented = presentConnectedProviderSubscriptionUsage(result);
      statuses.push({
        environmentId,
        label: presentation.entry.target.label,
        connectionPhase: presentation.connection.phase,
        providerInstancesKey: providers === null ? null : enabledProviderInstancesKey(providers),
        ...presented,
        report:
          presented.report !== null && providers !== null
            ? filterReportToEnabledProviderInstances(presented.report, providers)
            : presented.report,
      });
    }

    return statuses;
  },
).pipe(Atom.withLabel("web-provider-subscription-usage"));

export function useProviderSubscriptionUsage() {
  const environments = useAtomValue(providerSubscriptionUsageStatusesAtom);
  return { environments };
}
