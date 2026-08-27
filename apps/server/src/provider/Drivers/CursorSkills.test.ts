import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverCursorSkills } from "./CursorSkills.ts";

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
});

const frontmatter = (name: string, description: string) =>
  ["---", `name: ${name}`, `description: ${description}`, "---", "", "# Body"].join("\n");

it.layer(NodeServices.layer)("discoverCursorSkills", (it) => {
  it.effect("discovers built-in, personal, and project skills with their scopes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-cursor-skills-" });
      const workspace = path.join(home, "workspace");
      const cursorHome = path.join(home, ".cursor");

      yield* writeSkill(
        path.join(cursorHome, "skills-cursor"),
        "create-rule",
        frontmatter("create-rule", "Create Cursor rules."),
      );
      yield* writeSkill(
        path.join(cursorHome, "skills"),
        "turborepo",
        frontmatter("turborepo", "Turborepo guidance."),
      );
      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "deploy",
        frontmatter("deploy", "Deploy the app."),
      );

      const skills = yield* discoverCursorSkills({ HOME: home }, workspace);

      assert.deepEqual(skills, [
        {
          name: "create-rule",
          path: path.join(cursorHome, "skills-cursor", "create-rule", "SKILL.md"),
          enabled: true,
          scope: "builtin",
          description: "Create Cursor rules.",
        },
        {
          name: "deploy",
          path: path.join(workspace, ".cursor", "skills", "deploy", "SKILL.md"),
          enabled: true,
          scope: "project",
          description: "Deploy the app.",
        },
        {
          name: "turborepo",
          path: path.join(cursorHome, "skills", "turborepo", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "Turborepo guidance.",
        },
      ]);
    }),
  );

  it.effect("prefers project over personal over built-in on a name collision", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-cursor-skills-" });
      const workspace = path.join(home, "workspace");
      const cursorHome = path.join(home, ".cursor");

      yield* writeSkill(
        path.join(cursorHome, "skills-cursor"),
        "shell",
        frontmatter("shell", "Built-in shell skill."),
      );
      yield* writeSkill(
        path.join(cursorHome, "skills"),
        "shell",
        frontmatter("shell", "Personal shell skill."),
      );

      const personalWins = yield* discoverCursorSkills({ HOME: home }, workspace);
      assert.deepEqual(
        personalWins.map((skill) => [skill.scope, skill.description]),
        [["user", "Personal shell skill."]],
      );

      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "shell",
        frontmatter("shell", "Project shell skill."),
      );

      const projectWins = yield* discoverCursorSkills({ HOME: home }, workspace);
      assert.deepEqual(
        projectWins.map((skill) => [skill.scope, skill.description]),
        [["project", "Project shell skill."]],
      );
    }),
  );

  // Personal skills are routinely symlinks into a shared `~/.agents/skills`
  // tree, which a directory-type check would skip.
  it.effect("follows a symlinked skill directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-cursor-skills-" });
      const shared = path.join(home, ".agents", "skills");
      const cursorSkills = path.join(home, ".cursor", "skills");

      yield* writeSkill(shared, "next-cache-components", frontmatter("next-cache", "Cache docs."));
      yield* fs.makeDirectory(cursorSkills, { recursive: true });
      yield* fs.symlink(
        path.join(shared, "next-cache-components"),
        path.join(cursorSkills, "next-cache-components"),
      );

      const skills = yield* discoverCursorSkills({ HOME: home });

      assert.deepEqual(skills, [
        {
          name: "next-cache",
          path: path.join(cursorSkills, "next-cache-components", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "Cache docs.",
        },
      ]);
    }),
  );

  it.effect("skips malformed frontmatter and falls back to the directory name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-cursor-skills-" });
      const cursorSkills = path.join(home, ".cursor", "skills");

      yield* writeSkill(cursorSkills, "broken", ["---", "name: [unclosed", "---", ""].join("\n"));
      yield* writeSkill(cursorSkills, "no-frontmatter", "# Just a heading\n");

      const skills = yield* discoverCursorSkills({ HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["no-frontmatter"],
      );
    }),
  );

  it.effect("ignores manifest files beside the built-ins and missing roots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-cursor-skills-" });
      const builtins = path.join(home, ".cursor", "skills-cursor");

      yield* fs.makeDirectory(builtins, { recursive: true });
      yield* fs.writeFileString(path.join(builtins, ".sync-manifest.json"), '{"version":1}');

      // No `skills` root and no workspace: discovery must stay empty, not fail.
      const skills = yield* discoverCursorSkills({ HOME: home });

      assert.deepEqual(skills, []);
    }),
  );
});
