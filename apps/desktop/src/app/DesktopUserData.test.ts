import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["darwin", "win32"] as const)(
  "keeps the Vetra profile on %s and never adopts an upstream t3code profile",
  (platform) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-desktop-profile-" });
      for (const t3Profile of ["t3code", "t3code-v2", "t3code-dev"]) {
        yield* fs.makeDirectory(path.join(directory, t3Profile), { recursive: true });
        yield* fs.writeFileString(path.join(directory, t3Profile, "Local State"), "T3 state");
      }

      const packaged = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform,
      });
      const development = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: true,
        platform,
      });

      assert.equal(packaged, path.join(directory, "vetra-code"));
      assert.equal(development, path.join(directory, "vetra-code-dev"));
      assert.isFalse(yield* fs.exists(path.join(packaged, "Local State")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
