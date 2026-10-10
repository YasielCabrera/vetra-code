import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import { HttpClient } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { GrokDriverWithSubscriptionUsage } from "./ProviderPackageSubscriptionUsage.ts";

const layerTest = TestProviderHost.layer({ runBackgroundWork: false }).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(ProviderLatestVersions.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Grok usage must not make an HTTP request")),
    ),
  ),
);

const missingGrok = ChildProcessSpawner.make(() =>
  Effect.fail(
    PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
  ),
);

it.layer(layerTest)("ProviderPackageSubscriptionUsage", (it) => {
  it.effect("reads a package driver's subscription limits through the instance it creates", () =>
    Effect.gen(function* () {
      const instance = yield* GrokDriverWithSubscriptionUsage.create({
        instanceId: ProviderInstanceId.make("grok-usage"),
        displayName: "Grok usage",
        enabled: false,
        environment: [],
        config: GrokDriverWithSubscriptionUsage.defaultConfig(),
      });

      const probe = yield* instance.subscriptionUsage!.read;
      expect(probe.result).toMatchObject({
        instanceId: "grok-usage",
        driver: "grok",
        displayName: "Grok usage",
        state: "error",
        message: "Grok subscription limits could not be refreshed.",
      });
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, missingGrok),
      Effect.scoped,
    ),
  );
});
