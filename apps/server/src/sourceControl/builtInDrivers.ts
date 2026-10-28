import * as GitHubPullRequestApi from "@t3tools/source-control-github/server/GitHubPullRequestApi";
import * as GitHubDriver from "@t3tools/source-control-github/server/driver";
import * as GitHubApi from "@t3tools/source-control-github/server/GitHubApi";
import * as GitHubAppAccess from "@t3tools/source-control-github/server/GitHubAppAccess";
import type {
  SourceControlDriver,
  SourceControlDriverInstance,
} from "@t3tools/source-control-core/server/driver";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSourceControlHost from "./ServerSourceControlHost.ts";
import { BUILT_IN_SOURCE_CONTROL_DRIVER_LIST } from "./sourceControlDefinitions.ts";

export interface SourceControlDriverEntry {
  readonly driver: Pick<SourceControlDriver, "kind" | "definition">;
  readonly instance: SourceControlDriverInstance;
}

/** Every driver's instance, in registry order. Everything that reads a host reads it here. */
export class SourceControlDrivers extends Context.Service<
  SourceControlDrivers,
  ReadonlyArray<SourceControlDriverEntry>
>()("t3/sourceControl/builtInDrivers/SourceControlDrivers") {}

const make = Effect.forEach(BUILT_IN_SOURCE_CONTROL_DRIVER_LIST, (driver) =>
  Effect.gen(function* () {
    // Issues and pull requests share one credential cache and quota reserve.
    const instance =
      driver.kind === GitHubDriver.driver.kind ? yield* GitHubDriver.make : yield* driver.make;
    return { driver, instance };
  }),
);

export const layer = Layer.effect(SourceControlDrivers, make).pipe(
  Layer.provideMerge(
    GitHubPullRequestApi.layer.pipe(
      Layer.provideMerge(GitHubAppAccess.layer),
      Layer.provideMerge(GitHubApi.layerWithDependencies),
    ),
  ),
  Layer.provideMerge(ServerSourceControlHost.layer),
  Layer.provideMerge(SourceControlRateLimit.layer),
);
