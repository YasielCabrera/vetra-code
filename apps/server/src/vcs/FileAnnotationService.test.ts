import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { fileContentRevision } from "@vetra-code/shared/fileRevision";

import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as FileAnnotationService from "./FileAnnotationService.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

const contents = "first\nsecond\n";
const revision = fileContentRevision(contents);
const input = {
  cwd: "/repo",
  path: "src/file.ts",
  contentRevision: revision,
} as const;

const textFile = (nextContents = contents, overrides: Record<string, unknown> = {}) => ({
  relativePath: input.path,
  contents: nextContents,
  byteLength: new TextEncoder().encode(nextContents).byteLength,
  truncated: false,
  ...overrides,
});

function annotationLayer(options: {
  readonly readFile: WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"];
  readonly detectedKind?: "git" | "jj" | null;
  readonly getLineChanges?: GitVcsDriver.GitVcsDriver["Service"]["getFileLineChanges"];
  readonly getBlame?: GitVcsDriver.GitVcsDriver["Service"]["getFileBlame"];
}) {
  return FileAnnotationService.layer.pipe(
    Layer.provide(
      Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)({
        readFile: options.readFile,
      }),
    ),
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        detect: () => {
          const kind = options.detectedKind === undefined ? "git" : options.detectedKind;
          return Effect.succeed(
            kind === null
              ? null
              : {
                  kind,
                  repository: {
                    kind,
                    rootPath: input.cwd,
                    metadataPath: null,
                    freshness: {
                      source: "live-local" as const,
                      observedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
                      expiresAt: Option.none(),
                    },
                  },
                  driver: {} as never,
                },
          );
        },
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        getFileLineChanges:
          options.getLineChanges ??
          (() =>
            Effect.succeed({
              state: "unchanged" as const,
              headOid: null,
              lineCount: 2,
              addedRanges: [],
              modifiedRanges: [],
              deletionMarkers: [],
            })),
        getFileBlame:
          options.getBlame ??
          (() =>
            Effect.succeed({
              firstLine: 1,
              lineCount: 2,
              headOid: null,
              commits: [],
              runs: [],
              localIdentity: null,
            })),
      }),
    ),
  );
}

it.effect("rejects a stale content revision before invoking Git", () => {
  let gitCalls = 0;
  return Effect.gen(function* () {
    const service = yield* FileAnnotationService.FileAnnotationService;
    const error = yield* Effect.flip(
      service.getLineChanges({ ...input, contentRevision: "stale-revision" }),
    );
    assert.equal(error._tag, "FileAnnotationContentChangedError");
    assert.equal(gitCalls, 0);
  }).pipe(
    Effect.provide(
      annotationLayer({
        readFile: () => Effect.succeed(textFile()),
        getLineChanges: () =>
          Effect.sync(() => {
            gitCalls += 1;
            return {
              state: "unchanged" as const,
              headOid: null,
              lineCount: 2,
              addedRanges: [],
              modifiedRanges: [],
              deletionMarkers: [],
            };
          }),
      }),
    ),
  );
});

it.effect("leaves non-Git files undecorated and reports blame as unsupported", () => {
  let gitCalls = 0;
  return Effect.gen(function* () {
    const service = yield* FileAnnotationService.FileAnnotationService;
    const lineChanges = yield* service.getLineChanges(input);
    assert.equal(lineChanges.state, "unchanged");
    assert.equal(lineChanges.headOid, null);
    const blameError = yield* Effect.flip(service.getBlame(input));
    assert.equal(blameError._tag, "FileAnnotationUnsupportedError");
    assert.equal(gitCalls, 0);
  }).pipe(
    Effect.provide(
      annotationLayer({
        detectedKind: "jj",
        readFile: () => Effect.succeed(textFile()),
        getLineChanges: () =>
          Effect.sync(() => {
            gitCalls += 1;
            return {
              state: "unchanged" as const,
              headOid: null,
              lineCount: 2,
              addedRanges: [],
              modifiedRanges: [],
              deletionMarkers: [],
            };
          }),
        getBlame: () =>
          Effect.sync(() => {
            gitCalls += 1;
            return {
              firstLine: 1,
              lineCount: 2,
              headOid: null,
              commits: [],
              runs: [],
              localIdentity: null,
            };
          }),
      }),
    ),
  );
});

it.effect("rejects binary, escaped, and oversized files without invoking Git", () => {
  let gitCalls = 0;
  const gitLineChanges = () =>
    Effect.sync(() => {
      gitCalls += 1;
      return {
        state: "unchanged" as const,
        headOid: null,
        lineCount: 2,
        addedRanges: [],
        modifiedRanges: [],
        deletionMarkers: [],
      };
    });
  const run = (readFile: WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"]) =>
    Effect.gen(function* () {
      const service = yield* FileAnnotationService.FileAnnotationService;
      return yield* Effect.flip(service.getLineChanges(input));
    }).pipe(Effect.provide(annotationLayer({ readFile, getLineChanges: gitLineChanges })));

  return Effect.gen(function* () {
    const binary = yield* run(() =>
      Effect.fail(
        new WorkspaceFileSystem.WorkspaceBinaryFileError({
          workspaceRoot: input.cwd,
          relativePath: input.path,
          resolvedPath: `${input.cwd}/${input.path}`,
        }),
      ),
    );
    assert.equal(binary._tag, "WorkspaceBinaryFileError");

    const escaped = yield* run(() =>
      Effect.fail(
        new WorkspacePaths.WorkspacePathOutsideRootError({
          workspaceRoot: input.cwd,
          relativePath: "../outside.ts",
        }),
      ),
    );
    assert.equal(escaped._tag, "WorkspacePathOutsideRootError");

    const oversized = yield* run(() =>
      Effect.succeed(textFile(contents, { byteLength: 1024 * 1024 + 1, truncated: true })),
    );
    assert.equal(oversized._tag, "FileAnnotationFileTooLargeError");
    assert.equal(gitCalls, 0);
  });
});

it.effect("applies the lower blame byte cap before invoking Git", () => {
  let gitCalls = 0;
  return Effect.gen(function* () {
    const service = yield* FileAnnotationService.FileAnnotationService;
    const error = yield* Effect.flip(service.getBlame(input));
    assert.equal(error._tag, "FileAnnotationFileTooLargeError");
    assert.equal(gitCalls, 0);
  }).pipe(
    Effect.provide(
      annotationLayer({
        readFile: () =>
          Effect.succeed(
            textFile(contents, { byteLength: FileAnnotationService.FILE_BLAME_MAX_BYTES + 1 }),
          ),
        getBlame: () =>
          Effect.sync(() => {
            gitCalls += 1;
            return {
              firstLine: 1,
              lineCount: 2,
              headOid: null,
              commits: [],
              runs: [],
              localIdentity: null,
            };
          }),
      }),
    ),
  );
});

it.effect("re-verifies the file after blame completes", () => {
  let currentContents = contents;
  return Effect.gen(function* () {
    const service = yield* FileAnnotationService.FileAnnotationService;
    const error = yield* Effect.flip(service.getBlame(input));
    assert.equal(error._tag, "FileAnnotationContentChangedError");
  }).pipe(
    Effect.provide(
      annotationLayer({
        readFile: () => Effect.succeed(textFile(currentContents)),
        getBlame: () =>
          Effect.sync(() => {
            currentContents = "changed while blame was running\n";
            return {
              firstLine: 1,
              lineCount: 2,
              headOid: null,
              commits: [
                {
                  oid: "0000000000000000000000000000000000000000",
                  author: "",
                  authorEmail: "",
                  authorTime: null,
                  summary: "",
                },
              ],
              runs: [2, 0],
              localIdentity: null,
            };
          }),
      }),
    ),
  );
});
