import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { discoverCursorSkills } from "./CursorSkills.ts";

const encodeJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

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

const writePlugin = Effect.fn(function* (
  pluginRoot: string,
  manifest: Record<string, unknown>,
  manifestDirectory = ".cursor-plugin",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.join(pluginRoot, manifestDirectory), { recursive: true });
  yield* fs.writeFileString(
    path.join(pluginRoot, manifestDirectory, "plugin.json"),
    encodeJsonString(manifest),
  );
});

it.layer(NodeServices.layer)("discoverCursorSkills", (it) => {
  it.effect("discovers built-in, personal, and project skills with their scopes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
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

      const skills = yield* discoverCursorSkills(workspace, { HOME: home });

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
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
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

      const personalWins = yield* discoverCursorSkills(workspace, { HOME: home });
      assert.deepEqual(
        personalWins.map((skill) => [skill.scope, skill.description]),
        [["user", "Personal shell skill."]],
      );

      yield* writeSkill(
        path.join(workspace, ".cursor", "skills"),
        "shell",
        frontmatter("shell", "Project shell skill."),
      );

      const projectWins = yield* discoverCursorSkills(workspace, { HOME: home });
      assert.deepEqual(
        projectWins.map((skill) => [skill.scope, skill.description]),
        [["project", "Project shell skill."]],
      );
    }),
  );

  // Personal skills are routinely symlinks into a shared `~/.agents/skills`
  // tree. The walk will not follow one out of the root it resolved, so the
  // skill is reported from the shared tree, which is a scanned root itself.
  it.effect("reports a symlinked personal skill under the link it was installed as", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const shared = path.join(home, ".agents", "skills");
      const cursorSkills = path.join(home, ".cursor", "skills");

      yield* writeSkill(shared, "next-cache-components", frontmatter("next-cache", "Cache docs."));
      yield* fs.makeDirectory(cursorSkills, { recursive: true });
      yield* fs.symlink(
        path.join(shared, "next-cache-components"),
        path.join(cursorSkills, "next-cache-components"),
      );

      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

      assert.deepEqual(skills, [
        {
          name: "next-cache-components",
          displayName: "next-cache",
          path: path.join(cursorSkills, "next-cache-components", "SKILL.md"),
          enabled: true,
          scope: "user",
          description: "Cache docs.",
        },
      ]);
    }),
  );

  it.effect("skips malformed frontmatter and keeps skills that have none", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const cursorSkills = path.join(home, ".cursor", "skills");

      yield* writeSkill(cursorSkills, "broken", ["---", "name: [unclosed", "---", ""].join("\n"));
      yield* writeSkill(cursorSkills, "no-frontmatter", "# Just a heading\n");

      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

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
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const builtins = path.join(home, ".cursor", "skills-cursor");

      yield* fs.makeDirectory(builtins, { recursive: true });
      yield* fs.writeFileString(path.join(builtins, ".sync-manifest.json"), '{"version":1}');

      // No `skills` root and no workspace: discovery must stay empty, not fail.
      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

      assert.deepEqual(skills, []);
    }),
  );

  // Marketplace plugins are cached four levels down and local ones two, so
  // roots are found by manifest rather than by a fixed depth.
  it.effect("discovers skills from cached and local plugins, and both manifest formats", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const plugins = path.join(home, ".cursor", "plugins");

      const cached = path.join(plugins, "cache", "cursor-public", "pstack", "revision-hash");
      yield* writePlugin(cached, { name: "pstack", skills: "./skills/" });
      yield* writeSkill(
        path.join(cached, "skills"),
        "architect",
        frontmatter("architect", "Plan."),
      );

      // Claude-format plugin manifest, which Cursor also accepts.
      const claudeStyle = path.join(plugins, "cache", "cursor-public", "context7", "revision-hash");
      yield* writePlugin(claudeStyle, { name: "context7" }, ".claude-plugin");
      yield* writeSkill(path.join(claudeStyle, "skills"), "ctx", frontmatter("ctx", "Docs."));

      const local = path.join(plugins, "local", "homegrown");
      yield* writePlugin(local, { name: "homegrown", skills: "./skills/" });
      yield* writeSkill(path.join(local, "skills"), "mine", frontmatter("mine", "Local."));

      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

      assert.deepEqual(
        skills.map((skill) => [skill.name, skill.scope]),
        [
          ["architect", "plugin"],
          ["ctx", "plugin"],
          ["mine", "plugin"],
        ],
      );
    }),
  );

  it.effect("walks skills grouped in subfolders", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const cursorSkills = path.join(home, ".cursor", "skills");

      // pstack ships `skills/grokbot/make-bot-ui/SKILL.md`: the outer folder is
      // a grouping folder with no SKILL.md of its own.
      yield* writeSkill(
        path.join(cursorSkills, "grokbot"),
        "make-bot-ui",
        frontmatter("Make Bot UI", "Build a bot UI."),
      );
      yield* writeSkill(cursorSkills, "flat", frontmatter("flat", "Top level."));

      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

      assert.deepEqual(
        skills.map((skill) => [skill.name, skill.displayName]),
        [
          ["flat", undefined],
          ["make-bot-ui", "Make Bot UI"],
        ],
      );
    }),
  );

  it.effect("contributes nothing for a plugin that declares no skills", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const pluginRoot = path.join(home, ".cursor", "plugins", "local", "mcp-only");

      // The `github` plugin is shaped like this: a manifest and an mcp.json,
      // with no skills folder at all.
      yield* writePlugin(pluginRoot, { name: "mcp-only" });
      yield* fs.writeFileString(path.join(pluginRoot, "mcp.json"), "{}");

      assert.deepEqual(yield* discoverCursorSkills(undefined, { HOME: home }), []);
    }),
  );

  // `automations/<name>/skills/` is not a skills root: pstack's own docs say
  // those SKILL.md files "are direct automation instructions, not registered
  // plugin skills", and tell agents not to invoke them as slash skills.
  it.effect("ignores skills outside the folders a plugin manifest declares", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const pluginRoot = path.join(home, ".cursor", "plugins", "local", "pstack");

      yield* writePlugin(pluginRoot, { name: "pstack", skills: "./skills/" });
      yield* writeSkill(path.join(pluginRoot, "skills"), "tdd", frontmatter("tdd", "Declared."));
      yield* writeSkill(
        path.join(pluginRoot, "automations", "benny", "skills"),
        "setup-benny",
        frontmatter("setup-benny", "Not a slash skill."),
      );

      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["tdd"],
      );
    }),
  );

  it.effect("reports the invocation flags a skill's frontmatter sets", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const cursorSkills = path.join(home, ".cursor", "skills");

      yield* writeSkill(
        cursorSkills,
        "auto-guidance",
        [
          "---",
          "name: auto-guidance",
          "description: Applied automatically.",
          "user-invocable: false",
          "---",
          "",
        ].join("\n"),
      );
      // Most Cursor skills set this; it blocks the model from auto-triggering a
      // skill the user is still meant to invoke, so it must stay enabled.
      yield* writeSkill(
        cursorSkills,
        "user-command",
        [
          "---",
          "name: user-command",
          "description: Invoked by the user.",
          "disable-model-invocation: true",
          "---",
          "",
        ].join("\n"),
      );

      const skills = yield* discoverCursorSkills(undefined, { HOME: home });

      assert.deepEqual(
        skills.map((skill) => [skill.name, skill.userInvocable, skill.userInvocationOnly]),
        [
          ["auto-guidance", false, undefined],
          ["user-command", undefined, true],
        ],
      );
    }),
  );

  it.effect("prefers project and personal skills over plugin and built-in ones", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs
        .makeTempDirectoryScoped({ prefix: "t3-cursor-skills-" })
        .pipe(Effect.flatMap(fs.realPath));
      const workspace = path.join(home, "workspace");
      const cursorHome = path.join(home, ".cursor");
      const pluginRoot = path.join(cursorHome, "plugins", "local", "p");

      yield* writeSkill(
        path.join(cursorHome, "skills-cursor"),
        "review",
        frontmatter("review", "Built-in."),
      );
      yield* writePlugin(pluginRoot, { name: "p", skills: "./skills/" });
      yield* writeSkill(
        path.join(pluginRoot, "skills"),
        "review",
        frontmatter("review", "Plugin."),
      );

      const pluginWins = yield* discoverCursorSkills(workspace, { HOME: home });
      assert.deepEqual(
        pluginWins.map((skill) => [skill.scope, skill.description]),
        [["plugin", "Plugin."]],
      );

      yield* writeSkill(path.join(cursorHome, "skills"), "review", frontmatter("review", "Mine."));
      const userWins = yield* discoverCursorSkills(workspace, { HOME: home });
      assert.deepEqual(
        userWins.map((skill) => [skill.scope, skill.description]),
        [["user", "Mine."]],
      );
    }),
  );
});
