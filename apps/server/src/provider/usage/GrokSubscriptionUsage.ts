import type {
  GrokSettings,
  ProviderSubscriptionUsageDetail,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@t3tools/contracts";
import * as EffectAcpClient from "effect-acp/client";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { buildGrokAcpSpawnInput } from "../acp/GrokAcpSupport.ts";
import type { ProviderInstance, ProviderSubscriptionUsageCapability } from "../ProviderDriver.ts";
import {
  configFingerprint,
  failureProbe,
  formatMoney,
  percentageWindow,
  settledProbe,
  settledResult,
  type ProviderSubscriptionUsageIdentity,
} from "./providerSubscriptionUsageHelpers.ts";

const Cent = Schema.Struct({ val: Schema.optionalKey(Schema.Number) });
const GrokBillingResponse = Schema.Struct({
  billingCycle: Schema.optionalKey(
    Schema.Struct({
      billingPeriodStart: Schema.optionalKey(Schema.String),
      billingPeriodEnd: Schema.optionalKey(Schema.String),
    }),
  ),
  monthlyLimit: Schema.optionalKey(Cent),
  onDemandCap: Schema.optionalKey(Cent),
  on_demand_enabled: Schema.optionalKey(Schema.Boolean),
  disabledByConfig: Schema.optionalKey(Schema.Boolean),
  usage: Schema.optionalKey(
    Schema.Struct({
      includedUsed: Schema.optionalKey(Cent),
      onDemandUsed: Schema.optionalKey(Cent),
      totalUsed: Schema.optionalKey(Cent),
    }),
  ),
});
type GrokBillingResponse = typeof GrokBillingResponse.Type;
const decodeGrokBillingResponse = Schema.decodeUnknownEffect(GrokBillingResponse);

const iso = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return Option.match(DateTime.make(value), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
};

export const parseGrokSubscriptionUsage = (input: {
  readonly identity: ProviderSubscriptionUsageIdentity;
  readonly fetchedAt: string;
  readonly response: GrokBillingResponse;
}): ProviderSubscriptionUsageInstanceResult => {
  const limit = input.response.monthlyLimit?.val;
  const includedUsed = input.response.usage?.includedUsed?.val;
  const totalUsed = input.response.usage?.totalUsed?.val ?? includedUsed;
  const start = iso(input.response.billingCycle?.billingPeriodStart);
  const end = iso(input.response.billingCycle?.billingPeriodEnd);
  const durationMinutes =
    start && end
      ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000))
      : undefined;
  const windows: ProviderSubscriptionUsageWindow[] = [];
  if (limit !== undefined && limit > 0 && totalUsed !== undefined) {
    const monthly = percentageWindow({
      id: "monthly-included",
      label: "Monthly included allowance",
      usedPercent: Math.max(0, (totalUsed / limit) * 100),
      durationMinutes,
      ...(end ? { resetsAt: end } : {}),
    });
    if (monthly) windows.push(monthly);
  }

  const details: ProviderSubscriptionUsageDetail[] = [];
  if (includedUsed !== undefined && limit !== undefined) {
    details.push({
      id: "included-allowance",
      label: "Included allowance",
      value: `${formatMoney(includedUsed / 100)} / ${formatMoney(limit / 100)}`,
    });
  }
  if (input.response.usage?.onDemandUsed?.val !== undefined) {
    const used = input.response.usage.onDemandUsed.val;
    const cap = input.response.onDemandCap?.val;
    details.push({
      id: "on-demand",
      label: "On-demand",
      value:
        cap !== undefined
          ? `${formatMoney(used / 100)} / ${formatMoney(cap / 100)}`
          : `${formatMoney(used / 100)} used`,
    });
  }
  if (input.response.on_demand_enabled !== undefined) {
    details.push({
      id: "on-demand-status",
      label: "On-demand spending",
      value: input.response.on_demand_enabled ? "Enabled" : "Disabled",
    });
  }

  return settledResult(input.identity, {
    state: "ready",
    freshness: "fresh",
    fetchedAt: input.fetchedAt,
    source: "provider-cli",
    windows,
    details,
  });
};

export const makeGrokSubscriptionUsageCapability = (input: {
  readonly instance: Pick<ProviderInstance, "instanceId" | "driverKind" | "displayName">;
  readonly settings: GrokSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): ProviderSubscriptionUsageCapability => {
  const identity: ProviderSubscriptionUsageIdentity = {
    instanceId: input.instance.instanceId,
    driver: input.instance.driverKind,
    displayName: input.instance.displayName ?? "Grok",
  };
  const spawn = buildGrokAcpSpawnInput(input.settings, input.cwd, input.environment);
  const fingerprint = configFingerprint(spawn);

  const read = Effect.gen(function* () {
    const command = yield* resolveSpawnCommand(spawn.command, spawn.args, {
      env: spawn.env ?? {},
    });
    const child = yield* input.spawner.spawn(
      ChildProcess.make(command.command, command.args, {
        cwd: spawn.cwd,
        env: spawn.env,
        extendEnv: true,
        forceKillAfter: "2 seconds",
        shell: command.shell,
      }),
    );
    const context = yield* Layer.build(EffectAcpClient.layerChildProcess(child));
    const client = yield* Effect.service(EffectAcpClient.AcpClient).pipe(Effect.provide(context));
    yield* client.agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "vetra-code", version: "0.1.0" },
    });
    const raw = yield* client.raw.request("x.ai/billing", {});
    const response = yield* decodeGrokBillingResponse(raw);
    return parseGrokSubscriptionUsage({
      identity,
      fetchedAt: DateTime.formatIso(yield* DateTime.now),
      response,
    });
  }).pipe(
    Effect.scoped,
    Effect.timeout("15 seconds"),
    Effect.map(settledProbe),
    Effect.catch((error) => {
      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const unsupported = message.includes("method not found") || message.includes("-32601");
      const needsAuth =
        message.includes("authentication required") || message.includes("grok login");
      return Effect.succeed(
        failureProbe(
          settledResult(identity, {
            state: unsupported ? "unsupported" : needsAuth ? "needs-auth" : "error",
            message: unsupported
              ? "This Grok CLI version does not expose subscription billing."
              : needsAuth
                ? "Grok subscription limits require authentication. Run `grok login`."
                : "Grok subscription limits could not be refreshed.",
            windows: [],
            details: [],
          }),
          error,
        ),
      );
    }),
  );

  return { fingerprint: Effect.succeed(fingerprint), read };
};
