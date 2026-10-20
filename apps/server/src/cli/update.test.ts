import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command } from "effect/cli";
import { HttpClient, HttpClientResponse } from "effect/http";
import { afterEach, vi } from "vite-plus/test";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../cloud/bootService.ts";
import { pinnedRuntimePaths } from "../cloud/pinnedRuntime.ts";
import {
  releaseIndexAuthorization,
  repointLauncher,
  resolveLauncherPath,
  resolveNewestVersion,
  updateCommand,
} from "./update.ts";

afterEach(() => vi.restoreAllMocks());

const GITHUB_RELEASES = "https://api.github.com/repos/YasielCabrera/vetra-code/releases?page=1";

it.each([
  { environment: { GH_TOKEN: " gh-token ", GITHUB_TOKEN: "github-token" }, token: "gh-token" },
  { environment: { GH_TOKEN: "  ", GITHUB_TOKEN: " github-token " }, token: "github-token" },
  { environment: { GITHUB_TOKEN: "github-token" }, token: "github-token" },
  { environment: { GH_TOKEN: "  ", GITHUB_TOKEN: "  " }, token: undefined },
  { environment: {}, token: undefined },
])("selects GitHub release authentication from $environment", ({ environment, token }) => {
  assert.equal(
    releaseIndexAuthorization(GITHUB_RELEASES, environment),
    token === undefined ? undefined : `Bearer ${token}`,
  );
});

it.each([
  "https://releases.vetra.invalid/releases?page=1",
  "https://api.github.com.example.test/releases",
  "https://github.com/YasielCabrera/vetra-code/releases",
])("never sends a GitHub token to %s", (url) => {
  assert.equal(releaseIndexAuthorization(url, { GH_TOKEN: "gh-token" }), undefined);
});

it.effect("reads each release page until the requested channel is found", () =>
  Effect.gen(function* () {
    const pages: string[] = [];
    const httpClient = HttpClient.make((request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://releases.vetra.invalid");
      assert.equal(url.pathname, "/releases");
      assert.equal(request.headers.accept, "application/vnd.github+json");
      assert.equal(request.headers.authorization, undefined);
      const page = url.searchParams.get("page") ?? "";
      pages.push(page);
      const tag_name = page === "1" ? "v1.2.4-preview.20260101.1" : "v1.2.3";
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json([{ tag_name }])));
    });
    const version = yield* resolveNewestVersion("stable").pipe(
      Effect.provideService(HostProcess.Environment, { GH_TOKEN: "gh-token" }),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
    assert.equal(version, "1.2.3");
    assert.deepStrictEqual(pages, ["1", "2"]);
  }),
);

it.layer(NodeServices.layer)("vetra update launcher", (it) => {
  it.effect("repoints a symlink that lives in a runtime versions tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-update-" });
      const oldExe = path.join(root, "runtime/versions/1.0.0/vetra");
      const newExe = path.join(root, "runtime/versions/2.0.0/vetra");
      const launcher = path.join(root, "bin/vetra");
      for (const file of [oldExe, newExe]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(oldExe, launcher);

      const repointed = yield* repointLauncher({
        launchedAs: launcher,
        versionsDir: path.join(root, "runtime/versions"),
        targetEntryPath: newExe,
      });

      assert.deepStrictEqual(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readLink(launcher), newExe);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("leaves a plain copy or a foreign symlink alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-update-" });
      const newExe = path.join(root, "runtime/versions/2.0.0/vetra");
      const copy = path.join(root, "copy/vetra");
      const foreign = path.join(root, "foreign/vetra");
      const elsewhere = path.join(root, "elsewhere/vetra");
      // Another install's versions tree: same shape, different home.
      const otherHome = path.join(root, "other/runtime/versions/1.0.0/vetra");
      const otherLauncher = path.join(root, "other/bin/vetra");
      for (const file of [newExe, copy, elsewhere, otherHome]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.makeDirectory(path.dirname(otherLauncher), { recursive: true });
      yield* fs.symlink(otherHome, otherLauncher);

      for (const launchedAs of [copy, foreign, otherLauncher, undefined]) {
        const repointed = yield* repointLauncher({
          launchedAs,
          versionsDir: path.join(root, "runtime/versions"),
          targetEntryPath: newExe,
        });
        assert.equal(repointed._tag, "None", launchedAs ?? "undefined");
      }
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readLink(otherLauncher), otherHome);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("finds the launcher a bare command name resolved to on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-update-" });
      const launcher = path.join(root, "bin/vetra");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "");

      const bare = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "vetra"),
        Effect.provideService(HostProcess.Environment, {
          PATH: `${path.join(root, "missing")}:${path.join(root, "bin")}`,
        }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const relative = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "./bin/vetra"),
        Effect.provideService(HostProcess.Environment, { PATH: "" }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const absent = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "vetra"),
        Effect.provideService(HostProcess.Environment, { PATH: path.join(root, "missing") }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );

      assert.equal(bare, launcher);
      assert.equal(relative, launcher);
      assert.equal(absent, undefined);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );
});

it.layer(Layer.mergeAll(NodeServices.layer, NetService.layer))("t3 update service", (it) => {
  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "reports the service switch as pending after installing the target runtime",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-service-" });
        const targetVersion = "999.0.0";
        const runtime = pinnedRuntimePaths(path, baseDir, targetVersion, "linux");
        yield* fs.makeDirectory(runtime.versionDir, { recursive: true });
        yield* fs.writeFileString(
          runtime.entryPath,
          `#!/bin/sh\nprintf 't3 v${targetVersion}\\n'\n`,
        );
        yield* fs.chmod(runtime.entryPath, 0o755);
        yield* fs.writeFileString(runtime.sentinelPath, `${targetVersion}\n`);
        const logPath = path.join(baseDir, "userdata/logs/boot-service.log");
        const unitPath = path.join(baseDir, "vetra-code.service");
        const installs: Array<Parameters<BootService.BootService["Service"]["install"]>[0]> = [];
        vi.spyOn(BootService, "layer").mockReturnValue(
          Layer.succeed(BootService.BootService, {
            status: Effect.succeed({
              supported: true,
              installed: true,
              current: true,
              installedVersion: packageJson.version,
              installedBaseDir: baseDir,
              logPath,
              unitPath,
            }),
            install: (options) =>
              Effect.sync(() => {
                installs.push(options);
                return {
                  program: [runtime.entryPath],
                  baseDir,
                  logPath,
                  unitPath,
                  handedOff: true,
                };
              }),
            restart: Effect.die("unexpected restart"),
            uninstall: Effect.die("unexpected uninstall"),
            withStopped: () => Effect.die("unexpected maintenance"),
          }),
        );
        const lines: string[] = [];
        yield* Command.runWith(updateCommand, { version: packageJson.version })([
          targetVersion,
          "--yes",
          "--base-dir",
          baseDir,
        ]).pipe(
          Effect.provideService(HostProcess.Platform, "linux"),
          Effect.provideService(HostProcess.IsExecutable, false),
          Effect.provideService(HostProcess.Environment, {}),
          Effect.provideService(Console.Console, {
            ...globalThis.console,
            log: (...args) => {
              lines.push(args.map(String).join(" "));
            },
          }),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
        );

        expect(installs).toEqual([{ allowDowngrade: false, start: true }]);
        const output = lines.join("\n");
        expect(output).not.toContain("Background service restarted");
        expect(output).toContain(`Background service switching to ${targetVersion}`);
        expect(output).toContain(logPath);
      }),
  );
});
