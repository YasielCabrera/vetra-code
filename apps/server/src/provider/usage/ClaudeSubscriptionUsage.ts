import type {
  ClaudeSettings,
  ProviderSubscriptionUsageCost,
  ProviderSubscriptionUsageDetail,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@t3tools/contracts";
import {
  query as claudeQuery,
  type SDKControlGetUsageResponse,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { resolveClaudeSdkExecutablePath } from "../Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
import { buildClaudeCapabilitiesProbeQueryOptions } from "../Layers/ClaudeProvider.ts";
import type { ProviderInstance, ProviderSubscriptionUsageCapability } from "../ProviderDriver.ts";
import {
  configFingerprint,
  failureProbe,
  formatMoney,
  percentageWindow,
  settledProbe,
  settledResult,
  type ProviderSubscriptionUsageIdentity,
  withProviderSubscriptionUsageCost,
} from "./providerSubscriptionUsageHelpers.ts";

type RateLimitWindow = {
  readonly utilization: number | null;
  readonly resets_at: string | null;
};

type UnknownRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

const addWindow = (
  windows: ProviderSubscriptionUsageWindow[],
  input: {
    readonly id: string;
    readonly label: string;
    readonly durationMinutes?: number;
    readonly value: RateLimitWindow | null | undefined;
  },
) => {
  if (input.value?.utilization === null || input.value?.utilization === undefined) return;
  const resetsAt = input.value.resets_at
    ? Option.match(DateTime.make(input.value.resets_at), {
        onNone: () => undefined,
        onSome: DateTime.formatIso,
      })
    : undefined;
  const window = percentageWindow({
    id: input.id,
    label: input.label,
    usedPercent: input.value.utilization,
    durationMinutes: input.durationMinutes,
    ...(resetsAt ? { resetsAt } : {}),
  });
  if (window) windows.push(window);
};

/**
 * Newer Claude usage payloads may forward CodexBar-style scoped limits before
 * the experimental SDK type is updated. Parse only the known, bounded shapes.
 */
const addClaudeExtraRateWindows = (
  windows: ProviderSubscriptionUsageWindow[],
  value: unknown,
): void => {
  const limits = record(value);
  if (!limits) return;
  const seen = new Set(windows.map((window) => window.id));

  const scoped = Array.isArray(limits.limits) ? limits.limits : [];
  for (const candidate of scoped) {
    const item = record(candidate);
    const scope = record(item?.scope);
    const model = record(scope?.model);
    const modelName = nonEmptyString(model?.display_name) ?? nonEmptyString(model?.displayName);
    const modelId = nonEmptyString(model?.id);
    if (
      item?.kind !== "weekly_scoped" ||
      item.group !== "weekly" ||
      !modelName ||
      finiteNumber(item.percent) === undefined
    ) {
      continue;
    }
    const modelSlug = slug(modelId ?? modelName);
    if (
      !modelSlug ||
      slug(modelName) === "all-models" ||
      modelSlug === "all-models" ||
      modelSlug.endsWith("-all-models")
    ) {
      continue;
    }
    const id = `claude-weekly-scoped-${modelSlug}`;
    if (seen.has(id)) continue;
    const reset = nonEmptyString(item.resets_at) ?? nonEmptyString(item.resetsAt);
    addWindow(windows, {
      id,
      label: `${modelName} only`,
      durationMinutes: 10_080,
      value: {
        utilization: finiteNumber(item.percent) ?? null,
        resets_at: reset ?? null,
      },
    });
    seen.add(id);
  }

  for (const key of [
    "seven_day_routines",
    "seven_day_claude_routines",
    "claude_routines",
    "routines",
    "routine",
    "seven_day_cowork",
    "cowork",
  ]) {
    const routine = record(limits[key]);
    const utilization = finiteNumber(routine?.utilization);
    if (utilization === undefined) continue;
    addWindow(windows, {
      id: "claude-routines",
      label: "Daily Routines",
      durationMinutes: 10_080,
      value: {
        utilization,
        resets_at: nonEmptyString(routine?.resets_at) ?? null,
      },
    });
    break;
  }
};

export const parseClaudeSubscriptionUsage = (input: {
  readonly identity: ProviderSubscriptionUsageIdentity;
  readonly fetchedAt: string;
  readonly accountEmail?: string;
  readonly response: SDKControlGetUsageResponse;
}): ProviderSubscriptionUsageInstanceResult => {
  if (!input.response.rate_limits_available || !input.response.rate_limits) {
    return settledResult(input.identity, {
      state: "unsupported",
      message:
        "This Claude session does not expose claude.ai subscription limits (API-key and third-party backends are unsupported).",
      windows: [],
      details: [],
    });
  }

  const limits = input.response.rate_limits;
  const windows: ProviderSubscriptionUsageWindow[] = [];
  const details: ProviderSubscriptionUsageDetail[] = [];
  addWindow(windows, {
    id: "five-hour",
    label: "Session",
    durationMinutes: 300,
    value: limits.five_hour,
  });
  addWindow(windows, {
    id: "seven-day",
    label: "Weekly",
    durationMinutes: 10_080,
    value: limits.seven_day,
  });
  addWindow(windows, {
    id: "seven-day-oauth-apps",
    label: "OAuth apps",
    durationMinutes: 10_080,
    value: limits.seven_day_oauth_apps,
  });
  addWindow(windows, {
    id: "seven-day-opus",
    label: "Opus only",
    durationMinutes: 10_080,
    value: limits.seven_day_opus,
  });
  addWindow(windows, {
    id: "seven-day-sonnet",
    label: "Sonnet only",
    durationMinutes: 10_080,
    value: limits.seven_day_sonnet,
  });
  addClaudeExtraRateWindows(windows, limits);

  if (limits.extra_usage) {
    const extra = limits.extra_usage;
    if (extra.utilization !== null) {
      const extraWindow = percentageWindow({
        id: "extra-usage",
        label: "Extra usage",
        usedPercent: extra.utilization,
      });
      if (extraWindow) windows.push(extraWindow);
    }
    details.push({
      id: "extra-usage-status",
      label: "Extra usage",
      value: extra.is_enabled ? "Enabled" : "Disabled",
    });
    if (extra.used_credits !== null) {
      details.push({
        id: "extra-usage-used",
        label: "Extra usage spent",
        value: formatMoney(extra.used_credits / 100, extra.currency ?? "USD"),
      });
    }
    if (extra.monthly_limit !== null) {
      details.push({
        id: "extra-usage-limit",
        label: "Extra usage limit",
        value: formatMoney(extra.monthly_limit / 100, extra.currency ?? "USD"),
      });
    }
  }

  return settledResult(input.identity, {
    state: "ready",
    freshness: "fresh",
    fetchedAt: input.fetchedAt,
    source: "provider-cli",
    ...(input.accountEmail ? { accountLabel: input.accountEmail } : {}),
    ...(input.response.subscription_type ? { planLabel: input.response.subscription_type } : {}),
    windows,
    details,
  });
};

function waitForAbortSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

export const makeClaudeSubscriptionUsageCapability = (input: {
  readonly instance: Pick<ProviderInstance, "instanceId" | "driverKind" | "displayName">;
  readonly settings: ClaudeSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly path: Path.Path;
  readonly localCost?: Effect.Effect<ProviderSubscriptionUsageCost | undefined, never>;
}): ProviderSubscriptionUsageCapability => {
  const identity: ProviderSubscriptionUsageIdentity = {
    instanceId: input.instance.instanceId,
    driver: input.instance.driverKind,
    displayName: input.instance.displayName ?? "Claude",
  };
  const fingerprint = configFingerprint({
    binaryPath: input.settings.binaryPath,
    homePath: input.settings.homePath,
    environment: input.environment,
  });

  const readQuota = Effect.gen(function* () {
    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    const claudeEnvironment = yield* makeClaudeEnvironment(input.settings, input.environment).pipe(
      Effect.provideService(Path.Path, input.path),
    );
    const executablePath = yield* resolveClaudeSdkExecutablePath(
      input.settings.binaryPath,
      claudeEnvironment,
    );
    return yield* Effect.tryPromise(async (signal) => {
      const abort = new AbortController();
      const abortProbe = () => abort.abort();
      signal.addEventListener("abort", abortProbe, { once: true });
      const q = claudeQuery({
        // oxlint-disable-next-line require-yield
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await waitForAbortSignal(abort.signal);
        })(),
        options: buildClaudeCapabilitiesProbeQueryOptions({
          executablePath,
          abortController: abort,
          environment: claudeEnvironment,
          cwd: input.cwd,
        }),
      });
      try {
        const init = await q.initializationResult();
        const usageMethod = (
          q as {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<SDKControlGetUsageResponse>;
          }
        ).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
        if (typeof usageMethod !== "function") {
          return settledResult(identity, {
            state: "unsupported",
            message: "Update Claude Code to a version that supports structured usage limits.",
            windows: [],
            details: [],
          });
        }
        const response = await usageMethod.call(q);
        const account = init.account as { readonly email?: string } | undefined;
        return parseClaudeSubscriptionUsage({
          identity,
          fetchedAt,
          ...(account?.email ? { accountEmail: account.email } : {}),
          response,
        });
      } finally {
        signal.removeEventListener("abort", abortProbe);
        if (!abort.signal.aborted) abort.abort();
      }
    });
  }).pipe(
    Effect.timeout("15 seconds"),
    Effect.map(settledProbe),
    Effect.catch((error) => {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const needsAuth = message.includes("not logged") || message.includes("authentication");
      return Effect.succeed(
        failureProbe(
          settledResult(identity, {
            state: needsAuth ? "needs-auth" : "error",
            message: needsAuth
              ? "Claude subscription limits require a claude.ai login."
              : "Claude subscription limits could not be refreshed.",
            windows: [],
            details: [],
          }),
          error,
        ),
      );
    }),
  );

  const read = input.localCost
    ? Effect.all([readQuota, input.localCost], { concurrency: "unbounded" }).pipe(
        Effect.map(([result, cost]) => withProviderSubscriptionUsageCost(result, cost)),
      )
    : readQuota;

  return { fingerprint: Effect.succeed(fingerprint), read };
};
