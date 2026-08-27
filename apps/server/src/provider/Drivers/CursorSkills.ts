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
 * Scanned in that order so the more specific root wins a name collision:
 * project beats personal beats built-in.
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
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

type CursorSkillScope = "builtin" | "user" | "project";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "parsed"; readonly name?: string; readonly description?: string };

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

/**
 * Enumerate Cursor Agent skills from the built-in, personal, and project
 * roots. Discovery is best-effort: unreadable roots and malformed skill
 * entries are skipped so a broken skill never degrades the provider snapshot.
 */
export const discoverCursorSkills = Effect.fn("discoverCursorSkills")(function* (
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cursorHome = path.join(resolveCursorHomeDirectory(environment), ".cursor");

  const roots: ReadonlyArray<{ directory: string; scope: CursorSkillScope }> = [
    { directory: path.join(cursorHome, "skills-cursor"), scope: "builtin" },
    { directory: path.join(cursorHome, "skills"), scope: "user" },
    ...(cwd ? [{ directory: path.join(cwd, ".cursor", "skills"), scope: "project" as const }] : []),
  ];

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const root of roots) {
    const entries = yield* fileSystem
      .readDirectory(root.directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    for (const entry of [...entries].sort()) {
      const skillPath = path.join(root.directory, entry, "SKILL.md");
      const contents = yield* fileSystem
        .readFileString(skillPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) {
        continue;
      }

      const frontmatter = parseSkillFrontmatter(contents);
      // Malformed frontmatter means the skill will not load in Cursor either —
      // skip it rather than surfacing a broken entry under its directory name.
      if (frontmatter.kind === "malformed") {
        continue;
      }

      const name = (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ?? entry.trim();
      if (!name) {
        continue;
      }

      skillsByName.set(name, {
        name,
        path: skillPath,
        // Cursor's `cli-config.json` has no skill ignore or disable list, so
        // every discovered skill is invocable.
        enabled: true,
        scope: root.scope,
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
      });
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
