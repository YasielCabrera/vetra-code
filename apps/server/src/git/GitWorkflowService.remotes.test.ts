import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";

const driverLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "vetra-remotes-test-" })),
  Layer.provideMerge(VcsProcess.layer),
);
const workflowLayer = GitWorkflowService.layer.pipe(
  Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(driverLayer))),
  Layer.provideMerge(driverLayer),
  Layer.provide(Layer.mock(GitManager.GitManager)({})),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("lists every remote of the requested checkout without collapsing fork identity", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-remotes-" });
    const git = yield* GitVcsDriver.GitVcsDriver;
    const run = (args: ReadonlyArray<string>) =>
      git.execute({ cwd, args, operation: "remotes.test", timeoutMs: 10_000 });
    yield* run(["init"]);
    yield* run(["remote", "add", "origin", "https://github.com/YasielCabrera/vetra-code.git"]);
    yield* run(["remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git"]);
    yield* run([
      "remote",
      "set-url",
      "--push",
      "origin",
      "git@github.com:YasielCabrera/vetra-code.git",
    ]);
    const workflow = yield* GitWorkflowService.GitWorkflowService;
    const result = yield* workflow.listRemotes({ cwd });
    assert.deepStrictEqual(
      result.remotes.map(({ name, url }) => ({ name, url })),
      [
        { name: "origin", url: "https://github.com/YasielCabrera/vetra-code.git" },
        { name: "upstream", url: "https://github.com/pingdotgg/t3code.git" },
      ],
    );
  }).pipe(Effect.scoped, Effect.provide(workflowLayer)),
);

it.effect("offers no remotes for a project without a VCS repository", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-no-remotes-" });
    const workflow = yield* GitWorkflowService.GitWorkflowService;
    assert.deepStrictEqual((yield* workflow.listRemotes({ cwd })).remotes, []);
  }).pipe(Effect.scoped, Effect.provide(workflowLayer)),
);
