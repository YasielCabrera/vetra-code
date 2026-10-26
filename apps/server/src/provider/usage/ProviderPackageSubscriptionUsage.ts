// Provider packages cannot import the server credential store, so the server attaches subscription usage.
import type {
  ProviderDriver,
  ProviderDriverCreateInput,
  ProviderSubscriptionUsageCapability,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import { CursorDriver } from "@t3tools/provider-cursor/server";
import { GrokDriver } from "@t3tools/provider-grok/server";
import { OpenCodeDriver } from "@t3tools/provider-opencode/server";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeCursorSubscriptionUsageCapability } from "./CursorSubscriptionUsage.ts";
import { makeGrokSubscriptionUsageCapability } from "./GrokSubscriptionUsage.ts";
import { makeOpenCodeSubscriptionUsageCapability } from "./OpenCodeSubscriptionUsage.ts";
import { ProviderSubscriptionCredentialStore } from "./ProviderSubscriptionCredentialStore.ts";

const withSubscriptionUsage = <Config, R, UsageR, R2>(
  driver: ProviderDriver<Config, R, UsageR>,
  makeCapability: (
    input: ProviderDriverCreateInput<Config>,
  ) => Effect.Effect<ProviderSubscriptionUsageCapability, never, R2>,
): ProviderDriver<Config, R | R2, UsageR> => ({
  ...driver,
  create: Effect.fn("create")(function* (input) {
    const instance = yield* driver.create(input);
    return { ...instance, subscriptionUsage: yield* makeCapability(input) };
  }),
});

export const CursorDriverWithSubscriptionUsage = withSubscriptionUsage(
  CursorDriver,
  ({ instanceId, displayName, environment }) =>
    Effect.gen(function* () {
      return makeCursorSubscriptionUsageCapability({
        instance: { instanceId, driverKind: CursorDriver.driverKind, displayName },
        environment: yield* mergeProviderInstanceEnvironment(environment),
        platform: yield* HostProcess.Platform,
        httpClient: yield* HttpClient.HttpClient,
        credentials: yield* ProviderSubscriptionCredentialStore,
      });
    }),
);

export const GrokDriverWithSubscriptionUsage = withSubscriptionUsage(
  GrokDriver,
  ({ instanceId, displayName, environment, enabled, config }) =>
    Effect.gen(function* () {
      const host = yield* ProviderHost;
      return makeGrokSubscriptionUsageCapability({
        instance: { instanceId, driverKind: GrokDriver.driverKind, displayName },
        settings: { ...config, enabled },
        environment: yield* mergeProviderInstanceEnvironment(environment),
        cwd: host.paths.cwd,
        spawner: yield* ChildProcessSpawner.ChildProcessSpawner,
      });
    }),
);

export const OpenCodeDriverWithSubscriptionUsage = withSubscriptionUsage(
  OpenCodeDriver,
  ({ instanceId, displayName, enabled, config }) =>
    Effect.gen(function* () {
      return makeOpenCodeSubscriptionUsageCapability({
        instance: { instanceId, driverKind: OpenCodeDriver.driverKind, displayName },
        settings: { ...config, enabled },
        httpClient: yield* HttpClient.HttpClient,
        credentials: yield* ProviderSubscriptionCredentialStore,
      });
    }),
);
