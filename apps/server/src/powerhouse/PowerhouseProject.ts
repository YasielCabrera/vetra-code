/**
 * PowerhouseProject - finds Powerhouse projects in a workspace and reads their
 * document models off disk.
 *
 * Works with no reactor running, which is what makes it the panel's fallback
 * mode. Reading follows Powerhouse's own conventions: `powerhouse.config.json`
 * marks a project, `documentModelsDir` (default `./document-models`) holds one
 * directory per model, and each directory holds a `<name>/<name>.json` whose
 * filename must match the directory.
 *
 * A workspace is not necessarily a project. Monorepos commonly keep the
 * Powerhouse app under `apps/<name>`, so discovery scans below the root as
 * well — see `listProjects`.
 *
 * @module PowerhouseProject
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";

import {
  POWERHOUSE_CONFIG_FILE_NAME,
  POWERHOUSE_DEFAULT_DOCUMENT_MODELS_DIR,
  parsePowerhouseConfig,
  type PowerhouseDocumentModel,
  type PowerhouseDocumentModelFailure,
  type PowerhouseDocumentModelSummary,
  type PowerhouseProjectConfig,
  PowerhouseProjectError,
  type PowerhouseProjectLocation,
} from "@t3tools/contracts";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { parseDocumentModelFile, summarizeDocumentModel } from "./documentModelFile.ts";

export interface PowerhouseDocumentModelListing {
  readonly documentModelsDir: string;
  readonly models: ReadonlyArray<PowerhouseDocumentModelSummary>;
  readonly failures: ReadonlyArray<PowerhouseDocumentModelFailure>;
  readonly truncated: boolean;
}

export interface PowerhouseProjectRef {
  readonly cwd: string;
  readonly projectPath?: string | undefined;
}

/**
 * How far below the workspace root discovery looks. Two levels covers the
 * conventional monorepo layout (`apps/<name>`, `packages/<name>`) without
 * walking a whole tree on every panel open.
 */
const MAX_SCAN_DEPTH = 2;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_DOCUMENT_MODEL_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_DIRECTORIES = 500;
const UTF8_ENCODER = new TextEncoder();

/** Directories that never contain a project and are expensive to walk. */
const SKIPPED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "tmp",
  "temp",
  ".next",
  ".turbo",
  ".cache",
  ".git",
]);

/** Service tag for reading Powerhouse project files. */
export class PowerhouseProject extends Context.Service<
  PowerhouseProject,
  {
    /**
     * Every Powerhouse project in the workspace, the root itself included when
     * it is one. An empty list is a normal answer, not a failure.
     */
    readonly listProjects: (
      cwd: string,
    ) => Effect.Effect<ReadonlyArray<PowerhouseProjectLocation>, PowerhouseProjectError>;
    /**
     * Config fields the panel needs, or a `not_a_powerhouse_project` failure when
     * the directory has no project config. A config that exists but cannot be
     * parsed resolves to defaults, matching Powerhouse's own loader.
     */
    readonly readConfig: (
      ref: PowerhouseProjectRef,
    ) => Effect.Effect<PowerhouseProjectConfig, PowerhouseProjectError>;
    /** Canonical project directory after workspace containment and config checks. */
    readonly resolveProjectDirectory: (
      ref: PowerhouseProjectRef,
    ) => Effect.Effect<string, PowerhouseProjectError>;
    /** Summaries of every model directory, with unreadable ones reported as failures. */
    readonly listDocumentModels: (
      ref: PowerhouseProjectRef,
    ) => Effect.Effect<PowerhouseDocumentModelListing, PowerhouseProjectError>;
    /** One model in full, including every specification's SDL. */
    readonly getDocumentModel: (
      ref: PowerhouseProjectRef & { readonly directoryName: string },
    ) => Effect.Effect<PowerhouseDocumentModel, PowerhouseProjectError>;
  }
>()("t3/powerhouse/PowerhouseProject") {}

const isNotFound = (error: { readonly reason: { readonly _tag: string } }) =>
  error.reason._tag === "NotFound";

const isNodeNotFound = (cause: unknown) => Predicate.isObject(cause) && cause.code === "ENOENT";

const isPathWithin = (path: Path.Path, root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    relative.length === 0 ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/** Model directories are single path segments; anything else is a traversal attempt. */
const isSafeDirectoryName = (name: string) =>
  name.length > 0 &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  !name.includes("\\") &&
  !name.includes("\0");

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

  const normalizeRoot = (cwd: string) =>
    workspacePaths
      .normalizeWorkspaceRoot(cwd)
      .pipe(
        Effect.mapError(
          (cause) => new PowerhouseProjectError({ failure: "read_failed", cwd, cause }),
        ),
      );

  /**
   * The directory a project ref points at, rejecting anything that resolves
   * outside the workspace.
   */
  const resolveProjectDir = (ref: PowerhouseProjectRef) =>
    Effect.gen(function* () {
      const workspaceRoot = yield* normalizeRoot(ref.cwd);
      const projectPath = ref.projectPath?.trim() ?? "";
      const projectDir =
        projectPath.length === 0
          ? workspaceRoot
          : (yield* workspacePaths
              .resolveRelativePathWithinRoot({ workspaceRoot, relativePath: projectPath })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new PowerhouseProjectError({
                      failure: "invalid_project_path",
                      cwd: ref.cwd,
                      detail: projectPath,
                      cause,
                    }),
                ),
              )).absolutePath;
      const canonicalWorkspaceRoot = yield* fileSystem
        .realPath(workspaceRoot)
        .pipe(
          Effect.mapError(
            (cause) => new PowerhouseProjectError({ failure: "read_failed", cwd: ref.cwd, cause }),
          ),
        );
      const canonicalProjectDir = yield* fileSystem.realPath(projectDir).pipe(
        Effect.mapError(
          (cause) =>
            new PowerhouseProjectError({
              failure: isNotFound(cause) ? "invalid_project_path" : "read_failed",
              cwd: ref.cwd,
              ...(projectPath.length === 0 ? {} : { detail: projectPath }),
              cause,
            }),
        ),
      );
      if (!isPathWithin(path, canonicalWorkspaceRoot, canonicalProjectDir)) {
        return yield* new PowerhouseProjectError({
          failure: "invalid_project_path",
          cwd: ref.cwd,
          detail: projectPath,
        });
      }
      return { workspaceRoot: canonicalWorkspaceRoot, projectDir: canonicalProjectDir };
    });

  /**
   * Read a directory's project config, if it has one.
   *
   * `Option.none` means "no config here". A config that exists but does not
   * parse resolves to defaults with `configValid: false`, the same way
   * Powerhouse's own loader falls back rather than failing.
   */
  const readConfigAt = (directory: string, cwd: string) =>
    Effect.gen(function* () {
      const canonicalDirectory = yield* fileSystem
        .realPath(directory)
        .pipe(
          Effect.mapError(
            (cause) => new PowerhouseProjectError({ failure: "read_failed", cwd, cause }),
          ),
        );
      const configPath = path.join(canonicalDirectory, POWERHOUSE_CONFIG_FILE_NAME);
      const canonicalConfigPath = yield* fileSystem.realPath(configPath).pipe(
        Effect.map(Option.some),
        Effect.catchTag("PlatformError", (cause) =>
          isNotFound(cause)
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(new PowerhouseProjectError({ failure: "read_failed", cwd, cause })),
        ),
      );
      if (Option.isNone(canonicalConfigPath)) {
        return Option.none<{ readonly config: PowerhouseProjectConfig; readonly valid: boolean }>();
      }
      if (!isPathWithin(path, canonicalDirectory, canonicalConfigPath.value)) {
        return yield* new PowerhouseProjectError({
          failure: "read_failed",
          cwd,
          detail: POWERHOUSE_CONFIG_FILE_NAME,
        });
      }
      const configStat = yield* fileSystem
        .stat(canonicalConfigPath.value)
        .pipe(
          Effect.mapError(
            (cause) => new PowerhouseProjectError({ failure: "read_failed", cwd, cause }),
          ),
        );
      if (configStat.type !== "File" || configStat.size > MAX_CONFIG_BYTES) {
        return yield* new PowerhouseProjectError({
          failure: "read_failed",
          cwd,
          detail: POWERHOUSE_CONFIG_FILE_NAME,
        });
      }
      const contents = yield* fileSystem
        .readFileString(canonicalConfigPath.value)
        .pipe(
          Effect.mapError(
            (cause) => new PowerhouseProjectError({ failure: "read_failed", cwd, cause }),
          ),
        );
      const parsed = parsePowerhouseConfig(contents);
      // Connect ships a same-named runtime config for a built app. It is not a project.
      if (parsed.status === "runtime-config") {
        return Option.none<{ readonly config: PowerhouseProjectConfig; readonly valid: boolean }>();
      }
      return Option.some(
        parsed.status === "invalid"
          ? { config: {} as PowerhouseProjectConfig, valid: false }
          : { config: parsed.config, valid: true },
      );
    });

  const readSubdirectoryNames = (directory: string, cwd: string) =>
    Effect.tryPromise({
      try: () => NodeFSP.readdir(directory, { withFileTypes: true }),
      catch: (cause) => new PowerhouseProjectError({ failure: "read_failed", cwd, cause }),
    }).pipe(
      Effect.map((entries) =>
        entries
          .filter(
            (entry) =>
              entry.isDirectory() &&
              !entry.name.startsWith(".") &&
              !SKIPPED_DIRECTORY_NAMES.has(entry.name),
          )
          .map((entry) => entry.name)
          .toSorted((left, right) => left.localeCompare(right)),
      ),
    );

  const toLocation = (input: {
    readonly projectPath: string;
    readonly directory: string;
    readonly config: PowerhouseProjectConfig;
    readonly valid: boolean;
  }): PowerhouseProjectLocation => ({
    path: input.projectPath,
    name:
      input.projectPath.length === 0
        ? path.basename(input.directory)
        : (input.projectPath.split("/").at(-1) ?? input.projectPath),
    documentModelsDir: input.config.documentModelsDir ?? POWERHOUSE_DEFAULT_DOCUMENT_MODELS_DIR,
    reactorPort: input.config.reactorPort ?? null,
    configValid: input.valid,
  });

  const listProjects: PowerhouseProject["Service"]["listProjects"] = Effect.fn(
    "PowerhouseProject.listProjects",
  )(function* (cwd) {
    const workspaceRoot = yield* normalizeRoot(cwd);
    const found: Array<PowerhouseProjectLocation> = [];

    const visit = (
      directory: string,
      projectPath: string,
      depth: number,
    ): Effect.Effect<void, PowerhouseProjectError> =>
      Effect.gen(function* () {
        const config = yield* readConfigAt(directory, cwd);
        if (Option.isSome(config)) {
          found.push(
            toLocation({
              projectPath,
              directory,
              config: config.value.config,
              valid: config.value.valid,
            }),
          );
          // A project's own subdirectories are its models and editors, not
          // more projects.
          return;
        }
        if (depth >= MAX_SCAN_DEPTH) return;
        const names = yield* readSubdirectoryNames(directory, cwd);
        yield* Effect.forEach(
          names,
          (name) =>
            visit(
              path.join(directory, name),
              projectPath.length === 0 ? name : `${projectPath}/${name}`,
              depth + 1,
            ),
          { discard: true },
        );
      });

    yield* visit(workspaceRoot, "", 0);
    return found;
  });

  const readConfig: PowerhouseProject["Service"]["readConfig"] = Effect.fn(
    "PowerhouseProject.readConfig",
  )(function* (ref) {
    const { projectDir } = yield* resolveProjectDir(ref);
    const config = yield* readConfigAt(projectDir, ref.cwd);
    if (Option.isNone(config)) {
      return yield* new PowerhouseProjectError({
        failure: "not_a_powerhouse_project",
        cwd: ref.cwd,
        ...(ref.projectPath === undefined ? {} : { detail: ref.projectPath }),
      });
    }
    return config.value.config;
  });

  const resolveProjectDirectory: PowerhouseProject["Service"]["resolveProjectDirectory"] =
    Effect.fn("PowerhouseProject.resolveProjectDirectory")(function* (ref) {
      const { projectDir } = yield* resolveProjectDir(ref);
      const config = yield* readConfigAt(projectDir, ref.cwd);
      if (Option.isNone(config)) {
        return yield* new PowerhouseProjectError({
          failure: "not_a_powerhouse_project",
          cwd: ref.cwd,
          ...(ref.projectPath === undefined ? {} : { detail: ref.projectPath }),
        });
      }
      return projectDir;
    });

  /**
   * Absolute path of the configured models directory, rejecting a
   * `documentModelsDir` that points outside its project.
   */
  const resolveModelsDir = (input: {
    readonly ref: PowerhouseProjectRef;
    readonly projectDir: string;
    readonly configuredDir: string;
  }) =>
    Effect.gen(function* () {
      const absolute = path.resolve(input.projectDir, input.configuredDir);
      if (!isPathWithin(path, input.projectDir, absolute)) {
        return yield* new PowerhouseProjectError({
          failure: "models_dir_missing",
          cwd: input.ref.cwd,
          detail: input.configuredDir,
        });
      }
      const canonicalModelsDir = yield* fileSystem.realPath(absolute).pipe(
        Effect.mapError(
          (cause) =>
            new PowerhouseProjectError({
              failure: isNotFound(cause) ? "models_dir_missing" : "read_failed",
              cwd: input.ref.cwd,
              detail: input.configuredDir,
              cause,
            }),
        ),
      );
      if (!isPathWithin(path, input.projectDir, canonicalModelsDir)) {
        return yield* new PowerhouseProjectError({
          failure: "models_dir_missing",
          cwd: input.ref.cwd,
          detail: input.configuredDir,
        });
      }
      const stat = yield* fileSystem
        .stat(canonicalModelsDir)
        .pipe(
          Effect.mapError(
            (cause) =>
              new PowerhouseProjectError({ failure: "read_failed", cwd: input.ref.cwd, cause }),
          ),
        );
      if (stat.type !== "Directory") {
        return yield* new PowerhouseProjectError({
          failure: "models_dir_missing",
          cwd: input.ref.cwd,
          detail: input.configuredDir,
        });
      }
      return canonicalModelsDir;
    });

  const readModelDirectoryNames = (input: {
    readonly ref: PowerhouseProjectRef;
    readonly modelsDir: string;
    readonly configuredDir: string;
  }) =>
    Effect.tryPromise({
      try: () => NodeFSP.readdir(input.modelsDir, { withFileTypes: true }),
      catch: (cause) =>
        new PowerhouseProjectError({
          failure: isNodeNotFound(cause) ? "models_dir_missing" : "read_failed",
          cwd: input.ref.cwd,
          detail: input.configuredDir,
          cause,
        }),
    }).pipe(
      Effect.map((entries) =>
        entries
          .filter(
            (entry) =>
              (entry.isDirectory() || entry.isSymbolicLink()) &&
              entry.name === entry.name.trim() &&
              isSafeDirectoryName(entry.name),
          )
          .map((entry) => entry.name),
      ),
    );

  /**
   * Read one model directory. Resolves to `null` for entries that are not model
   * directories at all (plain files), which the listing skips silently, and
   * to a failure reason for directories that look like models but cannot be
   * read or parsed.
   */
  const readModelDirectory = (input: {
    readonly modelsDir: string;
    readonly directoryName: string;
  }) =>
    Effect.gen(function* () {
      const directoryPath = path.join(input.modelsDir, input.directoryName);
      const canonicalDirectory = yield* fileSystem.realPath(directoryPath).pipe(Effect.result);
      if (canonicalDirectory._tag === "Failure") {
        return isNotFound(canonicalDirectory.failure)
          ? null
          : ({ ok: false, reason: "read_failed" } as const);
      }
      if (!isPathWithin(path, input.modelsDir, canonicalDirectory.success)) {
        return { ok: false, reason: "read_failed" } as const;
      }
      const stat = yield* fileSystem.stat(canonicalDirectory.success).pipe(Effect.result);
      if (stat._tag === "Failure") {
        return { ok: false, reason: "read_failed" } as const;
      }
      if (stat.success.type !== "Directory") {
        return null;
      }
      const modelPath = path.join(canonicalDirectory.success, `${input.directoryName}.json`);
      const canonicalModelPath = yield* fileSystem.realPath(modelPath).pipe(Effect.result);
      if (canonicalModelPath._tag === "Failure") {
        return isNotFound(canonicalModelPath.failure)
          ? ({ ok: false, reason: "missing_json" } as const)
          : ({ ok: false, reason: "read_failed" } as const);
      }
      if (!isPathWithin(path, canonicalDirectory.success, canonicalModelPath.success)) {
        return { ok: false, reason: "read_failed" } as const;
      }
      const modelStat = yield* fileSystem.stat(canonicalModelPath.success).pipe(Effect.result);
      if (modelStat._tag === "Failure") {
        return { ok: false, reason: "read_failed" } as const;
      }
      if (modelStat.success.type !== "File") {
        return { ok: false, reason: "missing_json" } as const;
      }
      if (modelStat.success.size > MAX_DOCUMENT_MODEL_BYTES) {
        return { ok: false, reason: "too_large" } as const;
      }
      const contents = yield* fileSystem
        .readFileString(canonicalModelPath.success)
        .pipe(Effect.result);
      if (contents._tag === "Failure") {
        return { ok: false, reason: "read_failed" } as const;
      }
      if (UTF8_ENCODER.encode(contents.success).byteLength > MAX_DOCUMENT_MODEL_BYTES) {
        return { ok: false, reason: "too_large" } as const;
      }
      return parseDocumentModelFile({
        directoryName: input.directoryName,
        contents: contents.success,
      });
    });

  /** Project directory plus the models directory its config points at. */
  const resolveProjectModelsDir = (ref: PowerhouseProjectRef) =>
    Effect.gen(function* () {
      const { projectDir } = yield* resolveProjectDir(ref);
      const config = yield* readConfigAt(projectDir, ref.cwd);
      if (Option.isNone(config)) {
        return yield* new PowerhouseProjectError({
          failure: "not_a_powerhouse_project",
          cwd: ref.cwd,
          ...(ref.projectPath === undefined ? {} : { detail: ref.projectPath }),
        });
      }
      const configuredDir =
        config.value.config.documentModelsDir ?? POWERHOUSE_DEFAULT_DOCUMENT_MODELS_DIR;
      const modelsDir = yield* resolveModelsDir({ ref, projectDir, configuredDir });
      return { configuredDir, modelsDir };
    });

  const listDocumentModels: PowerhouseProject["Service"]["listDocumentModels"] = Effect.fn(
    "PowerhouseProject.listDocumentModels",
  )(function* (ref) {
    const { configuredDir, modelsDir } = yield* resolveProjectModelsDir(ref);
    const entryNames = yield* readModelDirectoryNames({ ref, modelsDir, configuredDir });
    const sortedEntryNames = entryNames.toSorted((left, right) => left.localeCompare(right));
    const truncated = sortedEntryNames.length > MAX_MODEL_DIRECTORIES;

    const models: Array<PowerhouseDocumentModelSummary> = [];
    const failures: Array<PowerhouseDocumentModelFailure> = [];
    const projectedEntries = yield* Effect.forEach(
      sortedEntryNames.slice(0, MAX_MODEL_DIRECTORIES),
      (directoryName) =>
        readModelDirectory({ modelsDir, directoryName }).pipe(
          Effect.map((parsed) =>
            parsed === null
              ? null
              : parsed.ok
                ? ({ _tag: "Model", model: summarizeDocumentModel(parsed.model) } as const)
                : ({ _tag: "Failure", directoryName, reason: parsed.reason } as const),
          ),
        ),
      { concurrency: 8 },
    );
    for (const entry of projectedEntries) {
      if (entry === null) continue;
      if (entry._tag === "Model") {
        models.push(entry.model);
      } else {
        failures.push({ directoryName: entry.directoryName, reason: entry.reason });
      }
    }
    return {
      documentModelsDir: configuredDir,
      models: models.toSorted((left, right) => left.name.localeCompare(right.name)),
      failures,
      truncated,
    };
  });

  const getDocumentModel: PowerhouseProject["Service"]["getDocumentModel"] = Effect.fn(
    "PowerhouseProject.getDocumentModel",
  )(function* (input) {
    if (!isSafeDirectoryName(input.directoryName)) {
      return yield* new PowerhouseProjectError({
        failure: "invalid_model_name",
        cwd: input.cwd,
        detail: input.directoryName,
      });
    }
    const { modelsDir } = yield* resolveProjectModelsDir(input);
    const parsed = yield* readModelDirectory({
      modelsDir,
      directoryName: input.directoryName,
    });
    if (parsed === null || !parsed.ok) {
      return yield* new PowerhouseProjectError({
        failure:
          parsed?.reason === "read_failed" || parsed?.reason === "too_large"
            ? "read_failed"
            : "model_not_found",
        cwd: input.cwd,
        detail: input.directoryName,
      });
    }
    return parsed.model;
  });

  return PowerhouseProject.of({
    listProjects,
    readConfig,
    resolveProjectDirectory,
    listDocumentModels,
    getDocumentModel,
  });
});

export const layer = Layer.effect(PowerhouseProject, make);
