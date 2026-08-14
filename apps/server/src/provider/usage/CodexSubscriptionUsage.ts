import type {
  CodexSettings,
  ProviderSubscriptionUsageCost,
  ProviderSubscriptionUsageDetail,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@vetra-code/contracts";
import * as CodexClient from "@vetra-code/effect-codex-app-server/client";
import type * as CodexSchema from "@vetra-code/effect-codex-app-server/schema";
import { resolveSpawnCommand } from "@vetra-code/shared/shell";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { expandHomePath } from "../../pathExpansion.ts";
import type { ProviderSubscriptionUsageCapability, ProviderInstance } from "../ProviderDriver.ts";
import { codexAppServerArgs, resolveCodexLaunchArgs } from "../Layers/codexLaunchArgs.ts";
import {
  configFingerprint,
  durationWindowLabel,
  epochSecondsToIso,
  failureProbe,
  percentageWindow,
  settledProbe,
  settledResult,
  type ProviderSubscriptionUsageIdentity,
  withProviderSubscriptionUsageCost,
} from "./providerSubscriptionUsageHelpers.ts";

const FORCE_KILL_AFTER = "2 seconds" as const;
const CODEXBAR_PROBE_PREFIX = ["-s", "read-only", "-a", "untrusted"] as const;

type RateLimitsResponse = CodexSchema.V2GetAccountRateLimitsResponse;
type RateLimitSnapshot = RateLimitsResponse["rateLimits"];
type RateLimitWindow = NonNullable<RateLimitSnapshot["primary"]>;

type CodexWindowRole = "session" | "weekly" | "unknown";

const codexWindowRole = (window: RateLimitWindow): CodexWindowRole => {
  if (window.windowDurationMins === 300) return "session";
  if (window.windowDurationMins === 10_080) return "weekly";
  return "unknown";
};

/** Mirrors CodexBar's duration-based normalization for app-server slots. */
export const normalizeCodexRateLimitWindows = (
  primary: RateLimitSnapshot["primary"],
  secondary: RateLimitSnapshot["secondary"],
): {
  readonly primary: RateLimitWindow | undefined;
  readonly secondary: RateLimitWindow | undefined;
} => {
  if (primary && secondary) {
    const primaryRole = codexWindowRole(primary);
    const secondaryRole = codexWindowRole(secondary);
    if (primaryRole === "weekly" && (secondaryRole === "session" || secondaryRole === "unknown")) {
      return { primary: secondary, secondary: primary };
    }
    return { primary, secondary };
  }
  if (primary) {
    return codexWindowRole(primary) === "weekly"
      ? { primary: undefined, secondary: primary }
      : { primary, secondary: undefined };
  }
  if (secondary) {
    return codexWindowRole(secondary) === "weekly"
      ? { primary: undefined, secondary }
      : { primary: secondary, secondary: undefined };
  }
  return { primary: undefined, secondary: undefined };
};

const addWindow = (
  windows: ProviderSubscriptionUsageWindow[],
  input: {
    readonly id: string;
    readonly label: string;
    readonly value: RateLimitSnapshot["primary"];
  },
) => {
  if (!input.value) return;
  const durationMinutes = input.value.windowDurationMins ?? undefined;
  const window = percentageWindow({
    id: input.id,
    label: input.label,
    usedPercent: input.value.usedPercent,
    durationMinutes,
    resetsAt: epochSecondsToIso(input.value.resetsAt),
  });
  if (window) windows.push(window);
};

const humanBucketName = (key: string, snapshot: RateLimitSnapshot): string =>
  snapshot.limitName?.trim() ||
  key.replaceAll(/[-_]+/gu, " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());

const isCodexSparkBucket = (key: string, snapshot: RateLimitSnapshot): boolean =>
  `${key} ${snapshot.limitName ?? ""}`.toLowerCase().includes("spark") || key === "codex_bengalfox";

const supplementalBucketName = (key: string, snapshot: RateLimitSnapshot): string =>
  isCodexSparkBucket(key, snapshot) ? "Codex Spark" : humanBucketName(key, snapshot);

const supplementalWindowLabel = (input: {
  readonly key: string;
  readonly snapshot: RateLimitSnapshot;
  readonly value: RateLimitWindow;
  readonly fallback: string;
  readonly windowCount: number;
}): string => {
  const bucketName = supplementalBucketName(input.key, input.snapshot);
  const durationLabel = durationWindowLabel(input.value.windowDurationMins, "");
  if (durationLabel.length > 0) {
    return bucketName.toLowerCase().includes(durationLabel.toLowerCase())
      ? bucketName
      : `${bucketName} ${durationLabel}`;
  }
  return input.windowCount > 1 ? `${bucketName} ${input.fallback}` : bucketName;
};

const supplementalWindowId = (input: {
  readonly key: string;
  readonly snapshot: RateLimitSnapshot;
  readonly value: RateLimitWindow;
  readonly slot: "primary" | "secondary";
}): string => {
  if (isCodexSparkBucket(input.key, input.snapshot)) {
    if (input.value.windowDurationMins === 300) return "codex-spark";
    if (input.value.windowDurationMins === 10_080) return "codex-spark-weekly";
  }
  return `${input.key}:${input.slot}`;
};

const addSupplementalBucketWindows = (
  windows: ProviderSubscriptionUsageWindow[],
  key: string,
  snapshot: RateLimitSnapshot,
) => {
  const normalized = normalizeCodexRateLimitWindows(snapshot.primary, snapshot.secondary);
  const values = [normalized.primary, normalized.secondary].filter(
    (value): value is RateLimitWindow => value !== undefined,
  );
  const windowCount = values.length;
  const add = (slot: "primary" | "secondary", value: RateLimitWindow | undefined) => {
    if (!value) return;
    addWindow(windows, {
      id: supplementalWindowId({ key, snapshot, value, slot }),
      label: supplementalWindowLabel({
        key,
        snapshot,
        value,
        fallback: slot === "primary" ? "Primary" : "Secondary",
        windowCount,
      }),
      value,
    });
  };
  add("primary", normalized.primary);
  add("secondary", normalized.secondary);
};

export const parseCodexSubscriptionUsage = (input: {
  readonly identity: ProviderSubscriptionUsageIdentity;
  readonly fetchedAt: string;
  readonly account: NonNullable<CodexSchema.V2GetAccountResponse["account"]>;
  readonly response: RateLimitsResponse;
}): ProviderSubscriptionUsageInstanceResult => {
  const windows: ProviderSubscriptionUsageWindow[] = [];
  const details: ProviderSubscriptionUsageDetail[] = [];
  const limitId = input.response.rateLimits.limitId?.trim() || "codex";
  const normalized = normalizeCodexRateLimitWindows(
    input.response.rateLimits.primary,
    input.response.rateLimits.secondary,
  );

  // CodexBar intentionally takes the account quota lanes from the top-level
  // snapshot. `rateLimitsByLimitId` can contain overlapping/supplemental
  // buckets and treating it as the primary source creates duplicate or
  // misleading weekly bars.
  addWindow(windows, {
    id: `${limitId}:primary`,
    label: durationWindowLabel(normalized.primary?.windowDurationMins, "Session"),
    value: normalized.primary,
  });
  addWindow(windows, {
    id: `${limitId}:secondary`,
    label: durationWindowLabel(normalized.secondary?.windowDurationMins, "Weekly"),
    value: normalized.secondary,
  });

  const detailEntries =
    input.response.rateLimitsByLimitId && Object.keys(input.response.rateLimitsByLimitId).length > 0
      ? Object.entries(input.response.rateLimitsByLimitId)
      : [[input.response.rateLimits.limitId ?? "codex", input.response.rateLimits] as const];

  for (const [key, snapshot] of detailEntries) {
    if (key === limitId || snapshot.limitId === limitId) continue;
    addSupplementalBucketWindows(windows, key, snapshot);
  }

  for (const [key, snapshot] of detailEntries) {
    const bucketName = humanBucketName(key, snapshot);
    const prefix = detailEntries.length > 1 ? `${bucketName} · ` : "";

    if (snapshot.credits) {
      details.push({
        id: `${key}:credits`,
        label: `${prefix}Credits`,
        value: snapshot.credits.unlimited
          ? "Unlimited"
          : (snapshot.credits.balance ?? (snapshot.credits.hasCredits ? "Available" : "None")),
      });
    }
    if (snapshot.individualLimit) {
      const resetsAt = epochSecondsToIso(snapshot.individualLimit.resetsAt);
      details.push(
        {
          id: `${key}:spend-used`,
          label: `${prefix}Spend used`,
          value: snapshot.individualLimit.used,
        },
        {
          id: `${key}:spend-limit`,
          label: `${prefix}Spend limit`,
          value: snapshot.individualLimit.limit,
        },
        {
          id: `${key}:spend-remaining`,
          label: `${prefix}Spend remaining`,
          value: `${snapshot.individualLimit.remainingPercent}%`,
        },
      );
      if (resetsAt) {
        details.push({
          id: `${key}:spend-reset`,
          label: `${prefix}Spend resets`,
          value: resetsAt,
        });
      }
    }
    if (snapshot.spendControlReached) {
      details.push({
        id: `${key}:spend-control`,
        label: `${prefix}Spend control`,
        value: "Reached",
      });
    }
    if (snapshot.rateLimitReachedType) {
      details.push({
        id: `${key}:limit-state`,
        label: `${prefix}Limit state`,
        value: snapshot.rateLimitReachedType.replaceAll("_", " "),
      });
    }
  }

  const resetCredits = input.response.rateLimitResetCredits;
  if (resetCredits) {
    details.push({
      id: "reset-credits",
      label: "Reset credits",
      value: String(resetCredits.availableCount),
    });
    for (const credit of resetCredits.credits ?? []) {
      const expiresAt = epochSecondsToIso(credit.expiresAt);
      const status = credit.status.replaceAll("_", " ");
      details.push({
        id: `reset-credit:${credit.id}`,
        label: credit.title?.trim() || "Reset credit",
        value: expiresAt ? `${status} · expires ${expiresAt}` : status,
        ...(credit.description?.trim() ? { description: credit.description.trim() } : {}),
      });
    }
  }

  const plan = input.account.type === "chatgpt" ? input.account.planType : undefined;
  const email = input.account.type === "chatgpt" ? (input.account.email ?? undefined) : undefined;
  return settledResult(input.identity, {
    state: "ready",
    freshness: "fresh",
    fetchedAt: input.fetchedAt,
    source: "provider-cli",
    ...(email ? { accountLabel: email } : {}),
    ...(plan ? { planLabel: plan } : {}),
    windows,
    details,
  });
};

export const makeCodexSubscriptionUsageCapability = (input: {
  readonly instance: Pick<ProviderInstance, "instanceId" | "driverKind" | "displayName">;
  readonly settings: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly localCost?: Effect.Effect<ProviderSubscriptionUsageCost | undefined, never>;
}): ProviderSubscriptionUsageCapability => {
  const identity: ProviderSubscriptionUsageIdentity = {
    instanceId: input.instance.instanceId,
    driver: input.instance.driverKind,
    displayName: input.instance.displayName ?? "Codex",
  };
  const launchArgs = resolveCodexLaunchArgs(input.settings.launchArgs, input.environment);
  const resolvedHomePath = input.settings.homePath
    ? expandHomePath(input.settings.homePath)
    : undefined;
  const environment = {
    ...input.environment,
    ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
  };
  const fingerprint = configFingerprint({
    adapterVersion: "codex-subscription-usage-v2",
    binaryPath: input.settings.binaryPath,
    homePath: resolvedHomePath,
    launchArgs,
    environment,
  });

  const readQuota = Effect.gen(function* () {
    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    const spawnCommand = yield* resolveSpawnCommand(
      input.settings.binaryPath,
      [...CODEXBAR_PROBE_PREFIX, ...codexAppServerArgs(launchArgs)],
      { env: environment, extendEnv: true },
    );
    const child = yield* input.spawner.spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd: input.cwd,
        env: environment,
        extendEnv: true,
        forceKillAfter: FORCE_KILL_AFTER,
        shell: spawnCommand.shell,
      }),
    );
    const context = yield* Layer.build(CodexClient.layerChildProcess(child));
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(context),
    );
    yield* client.request("initialize", {
      clientInfo: { name: "vetra_code", title: "Vetra Code", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    yield* client.notify("initialized", undefined);
    const account = yield* client.request("account/read", { refreshToken: false });
    if (!account.account && account.requiresOpenaiAuth) {
      return settledResult(identity, {
        state: "needs-auth",
        message: "Codex subscription limits require a ChatGPT login. Run `codex login`.",
        windows: [],
        details: [],
      });
    }
    if (!account.account) {
      return settledResult(identity, {
        state: "unsupported",
        message: "This Codex account does not expose subscription limits.",
        windows: [],
        details: [],
      });
    }
    if (account.account.type !== "chatgpt") {
      return settledResult(identity, {
        state: "unsupported",
        message:
          account.account.type === "amazonBedrock"
            ? "Amazon Bedrock accounts do not expose ChatGPT subscription limits."
            : "API-key accounts do not have ChatGPT subscription limits.",
        windows: [],
        details: [],
      });
    }
    const response = yield* client.request("account/rateLimits/read", undefined);
    return parseCodexSubscriptionUsage({
      identity,
      fetchedAt,
      account: account.account,
      response,
    });
  }).pipe(
    Effect.scoped,
    Effect.timeout("15 seconds"),
    Effect.map(settledProbe),
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      return Effect.succeed(
        failureProbe(
          settledResult(identity, {
            state: "error",
            message: "Codex subscription limits could not be refreshed.",
            windows: [],
            details: [],
          }),
          Cause.pretty(cause),
        ),
      );
    }),
  );

  const read = input.localCost
    ? Effect.all([readQuota, input.localCost], { concurrency: "unbounded" }).pipe(
        Effect.map(([result, cost]) => withProviderSubscriptionUsageCost(result, cost)),
      )
    : readQuota;

  return {
    fingerprint: Effect.succeed(fingerprint),
    read,
  };
};
