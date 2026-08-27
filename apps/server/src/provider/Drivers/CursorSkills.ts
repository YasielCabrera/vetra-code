/**
 * CursorSkills — filesystem discovery of Cursor Agent skills for the `$` picker.
 *
 * Unlike Grok, the Cursor CLI has no `skills` or `inspect` subcommand, so there
 * is nothing to ask: `cursor-agent --help` exposes only `mcp`, `plugin`,
 * `models`, and `rule`. Skills live on disk as one directory per skill with a
 * `SKILL.md` carrying YAML frontmatter, the same shape Claude Code uses. Cursor
 * documents two writable roots plus one it manages itself:
 *
 * - `~/.cursor/skills-cursor` — Cursor's built-ins, synced by the CLI. Cursor's
 *   own `create-skill` skill tells authors never to write here.
 * - `~/.cursor/skills` — personal skills, available across all projects.
 * - `<cwd>/.cursor/skills` — project skills, shared through the repository.
 *
 * Installed plugins carry skills too, and they are the bulk of them on a
 * developed machine. A plugin is any directory holding a plugin manifest, and
 * Cursor accepts both its own `.cursor-plugin/plugin.json` and Claude's
 * `.claude-plugin/plugin.json`. Marketplace plugins are cached four levels
 * down (`plugins/cache/<marketplace>/<plugin>/<revision>/`) while local ones
 * sit at `plugins/local/<plugin>/`, so plugin roots are located by looking for
 * a manifest rather than by assuming a fixed depth. The manifest's `skills`
 * field names the folder; plugins that declare no skills contribute none.
 *
 * Scanned so the more specific root wins a name collision: project beats
 * personal beats plugin beats built-in. A plugin skill never shadows a skill
 * the user wrote themselves.
 *
 * Personal skills are commonly symlinks into a shared `~/.agents/skills` tree,
 * so entries are probed by reading `<entry>/SKILL.md` rather than by testing
 * the entry's file type, which a symlink would report as a link and skip. The
 * same read also filters out the manifest files Cursor keeps beside the
 * built-ins (`.sync-manifest.json` and friends) without naming them.
 *
 * @module provider/Drivers/CursorSkills
 */
import * as NodeOS from "node:os";

import type { ServerProviderSkill } from "@vetra-code/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYamlDocument } from "yaml";

type CursorSkillScope = "builtin" | "plugin" | "user" | "project";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | {
      readonly kind: "parsed";
      readonly name?: string;
      readonly description?: string;
      /**
       * `user-invocable: false` marks a skill the agent applies on its own and
       * that no picker should offer. Distinct from `disable-model-invocation`,
       * which blocks the *model* from auto-triggering a skill the user is still
       * meant to invoke — most of Cursor's skills set that, so treating it as
       * "disabled" would empty the picker.
       */
      readonly userInvocable: boolean;
    };

// Kept local rather than shared with `ClaudeSkills`, which holds an identical
// parser: importing from there would edit a file upstream owns and add a
// permanent conflict hunk to every sync. `SKILL.md` frontmatter is a stable
// cross-provider convention, so the copy does not drift.
function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { kind: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed" };
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return {
    kind: "parsed",
    userInvocable: record["user-invocable"] !== false,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * Resolve the `.cursor` directory the spawned CLI would use. Cursor has no
 * config-directory override — the only lever is `HOME`, which the wrapper
 * script reads — so prefer the instance environment's `HOME` over the server
 * process's own. Getting this wrong yields zero skills rather than an error.
 */
function resolveCursorHomeDirectory(environment: NodeJS.ProcessEnv): string {
  const home = environment.HOME?.trim() ?? "";
  return home.length > 0 ? home : NodeOS.homedir();
}

const decodeUnknownJsonStringExit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

const PLUGIN_MANIFEST_PATHS = [
  [".cursor-plugin", "plugin.json"],
  [".claude-plugin", "plugin.json"],
] as const;

// `plugins/cache/<marketplace>/<plugin>/<revision>` is the deepest layout
// Cursor uses; `plugins/local/<plugin>` is the shallowest. Bounding the walk
// keeps it from descending into plugin payloads such as `node_modules`.
const PLUGIN_SEARCH_MAX_DEPTH = 4;

/**
 * Read a plugin manifest's declared skills folders, relative to the plugin
 * root. Defaults to `skills` when the manifest parses but says nothing, since
 * that is the layout Cursor's own plugins ship; returns undefined when there is
 * no manifest at all, which is what marks a directory as not-a-plugin.
 */
const readPluginSkillDirectories = Effect.fn("readPluginSkillDirectories")(function* (
  pluginRoot: string,
): Effect.fn.Return<ReadonlyArray<string> | undefined, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const manifestPath of PLUGIN_MANIFEST_PATHS) {
    const contents = yield* fileSystem
      .readFileString(path.join(pluginRoot, ...manifestPath))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) {
      continue;
    }
    const decoded = decodeUnknownJsonStringExit(contents);
    if (Exit.isFailure(decoded)) {
      // A plugin whose manifest will not parse still looks like a plugin, so
      // stop here rather than descending further into it.
      return [];
    }
    const parsed = decoded.value;
    const declared =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).skills
        : undefined;
    const directories = (Array.isArray(declared) ? declared : [declared])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    return directories.length > 0 ? directories : ["skills"];
  }
  return undefined;
});

/**
 * Locate installed plugin skill folders under `~/.cursor/plugins`. Stops
 * descending as soon as a directory turns out to be a plugin, so a plugin that
 * vendors other plugin-shaped folders cannot inflate the list.
 */
const findPluginSkillRoots = Effect.fn("findPluginSkillRoots")(function* (
  directory: string,
  depthRemaining: number,
): Effect.fn.Return<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem
    .readDirectory(directory)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

  const found: Array<string> = [];
  for (const entry of [...entries].sort()) {
    if (entry.startsWith(".")) {
      continue;
    }
    const candidate = path.join(directory, entry);
    const skillDirectories = yield* readPluginSkillDirectories(candidate);
    if (skillDirectories !== undefined) {
      for (const skillDirectory of skillDirectories) {
        found.push(path.resolve(candidate, skillDirectory));
      }
      continue;
    }
    if (depthRemaining > 1) {
      found.push(...(yield* findPluginSkillRoots(candidate, depthRemaining - 1)));
    }
  }
  return found;
});

// A skills root may group its skills in subfolders — pstack ships
// `skills/grokbot/make-bot-ui/SKILL.md` — so a flat one-level scan misses them.
// Two levels of grouping is well past anything observed.
const SKILL_NESTING_MAX_DEPTH = 3;

/**
 * Collect every skill under a skills root. A directory holding a `SKILL.md` is
 * a skill and is not descended into; anything else is treated as a grouping
 * folder and walked, up to the depth bound.
 *
 * Entries are probed by reading `<entry>/SKILL.md` rather than by testing the
 * entry's file type, because personal skills are routinely symlinks into a
 * shared tree that a directory check would skip.
 */
const collectSkillsInRoot = Effect.fn("collectSkillsInRoot")(function* (
  directory: string,
  depthRemaining: number,
): Effect.fn.Return<
  ReadonlyArray<{
    readonly skillPath: string;
    readonly directoryName: string;
    readonly contents: string;
  }>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem
    .readDirectory(directory)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

  const found: Array<{
    readonly skillPath: string;
    readonly directoryName: string;
    readonly contents: string;
  }> = [];
  for (const entry of [...entries].sort()) {
    if (entry.startsWith(".")) {
      continue;
    }
    const skillPath = path.join(directory, entry, "SKILL.md");
    const contents = yield* fileSystem
      .readFileString(skillPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents !== undefined) {
      found.push({ skillPath, directoryName: entry.trim(), contents });
      continue;
    }
    if (depthRemaining > 1) {
      found.push(...(yield* collectSkillsInRoot(path.join(directory, entry), depthRemaining - 1)));
    }
  }
  return found;
});

/**
 * Enumerate Cursor Agent skills from the built-in, plugin, personal, and
 * project roots. Discovery is best-effort: unreadable roots and malformed skill
 * entries are skipped so a broken skill never degrades the provider snapshot.
 */
export const discoverCursorSkills = Effect.fn("discoverCursorSkills")(function* (
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const cursorHome = path.join(resolveCursorHomeDirectory(environment), ".cursor");

  const pluginSkillRoots = yield* findPluginSkillRoots(
    path.join(cursorHome, "plugins"),
    PLUGIN_SEARCH_MAX_DEPTH,
  );

  const roots: ReadonlyArray<{ directory: string; scope: CursorSkillScope }> = [
    { directory: path.join(cursorHome, "skills-cursor"), scope: "builtin" },
    ...pluginSkillRoots.map((directory) => ({ directory, scope: "plugin" as const })),
    { directory: path.join(cursorHome, "skills"), scope: "user" },
    ...(cwd ? [{ directory: path.join(cwd, ".cursor", "skills"), scope: "project" as const }] : []),
  ];

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const root of roots) {
    const collected = yield* collectSkillsInRoot(root.directory, SKILL_NESTING_MAX_DEPTH);
    for (const found of collected) {
      const frontmatter = parseSkillFrontmatter(found.contents);
      // Malformed frontmatter means the skill will not load in Cursor either —
      // skip it rather than surfacing a broken entry under its directory name.
      if (frontmatter.kind === "malformed") {
        continue;
      }

      const name = (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ?? found.directoryName;
      if (!name) {
        continue;
      }

      skillsByName.set(name, {
        name,
        path: found.skillPath,
        // Cursor has no skill ignore list, so the skill's own frontmatter is
        // the only thing that can withhold it from a picker.
        enabled: frontmatter.kind !== "parsed" || frontmatter.userInvocable,
        scope: root.scope,
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
      });
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
