// @effect-diagnostics nodeBuiltinImport:off - Subprocess fixture for inherited desktop pipes.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as DesktopTelemetryReceiver from "../../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as DesktopBrowserChannel from "../DesktopBrowserChannel.ts";

const config = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.map(ServerConfig.ServerConfig, (value) => ({
    ...value,
    mode: "desktop" as const,
    desktopBrowserFd: 3,
    desktopBrowserControlFd: 4,
    desktopTelemetryFd: 5,
    desktopTelemetryControlFd: 6,
  })),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "vetra-desktop-pipe-" })));

Effect.gen(function* () {
  const browser = yield* DesktopBrowserChannel.DesktopBrowserChannel;
  yield* DesktopTelemetryReceiver.DesktopTelemetryReceiver;
  const key = { threadId: "thread-1", tabId: "tab-1" };
  yield* Console.log("ready");
  if (!(yield* browser.awaitAttached(key, Duration.seconds(5)))) {
    return yield* Effect.die("Desktop did not attach.");
  }
  const detached = yield* browser.detached.pipe(Stream.runHead, Effect.forkScoped);
  yield* Console.log("attached");
  yield* Fiber.join(detached);
  yield* Console.log("verified");
}).pipe(
  Effect.provide(
    Layer.merge(DesktopBrowserChannel.layer, DesktopTelemetryReceiver.layer).pipe(
      Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
      Layer.provide(config),
      Layer.provide(NodeServices.layer),
    ),
  ),
  Effect.scoped,
  NodeRuntime.runMain,
);
