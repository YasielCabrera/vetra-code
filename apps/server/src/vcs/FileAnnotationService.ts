import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type {
  GitCommandError,
  VcsError,
  VcsFileBlameInput,
  VcsFileBlameResult,
  VcsFileLineChangesInput,
  VcsFileLineChangesResult,
} from "@vetra-code/contracts";
import { countTextLines, fileContentRevision } from "@vetra-code/shared/fileRevision";

import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { GitFileAnnotationParseError } from "./GitFileAnnotationError.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

export const FILE_BLAME_MAX_BYTES = 768 * 1024;

export class FileAnnotationContentChangedError extends Data.TaggedError(
  "FileAnnotationContentChangedError",
)<{
  readonly path: string;
}> {}

export class FileAnnotationFileTooLargeError extends Data.TaggedError(
  "FileAnnotationFileTooLargeError",
)<{
  readonly path: string;
}> {}

export class FileAnnotationUnsupportedError extends Data.TaggedError(
  "FileAnnotationUnsupportedError",
)<{
  readonly path: string;
}> {}

export type FileAnnotationServiceError =
  | WorkspaceFileSystem.WorkspaceFileSystemError
  | WorkspacePaths.WorkspacePathOutsideRootError
  | VcsError
  | GitCommandError
  | GitFileAnnotationParseError
  | FileAnnotationContentChangedError
  | FileAnnotationFileTooLargeError
  | FileAnnotationUnsupportedError;

export class FileAnnotationService extends Context.Service<
  FileAnnotationService,
  {
    readonly getLineChanges: (
      input: VcsFileLineChangesInput,
    ) => Effect.Effect<VcsFileLineChangesResult, FileAnnotationServiceError>;
    readonly getBlame: (
      input: VcsFileBlameInput,
    ) => Effect.Effect<VcsFileBlameResult, FileAnnotationServiceError>;
  }
>()("@vetra-code/server/vcs/FileAnnotationService") {}

export const make = Effect.gen(function* () {
  const workspace = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const readVerified = Effect.fn("FileAnnotationService.readVerified")(function* (
    input: VcsFileLineChangesInput | VcsFileBlameInput,
    blame: boolean,
  ) {
    const file = yield* workspace.readFile({ cwd: input.cwd, relativePath: input.path });
    if (file.truncated || (blame && file.byteLength > FILE_BLAME_MAX_BYTES)) {
      return yield* new FileAnnotationFileTooLargeError({ path: input.path });
    }
    if (fileContentRevision(file.contents) !== input.contentRevision) {
      return yield* new FileAnnotationContentChangedError({ path: input.path });
    }
    return file;
  });

  const getLineChanges: FileAnnotationService["Service"]["getLineChanges"] = Effect.fn(
    "FileAnnotationService.getLineChanges",
  )(function* (input) {
    const file = yield* readVerified(input, false);
    const lineCount = countTextLines(file.contents);
    const handle = yield* registry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return {
        state: "unchanged",
        headOid: null,
        lineCount,
        addedRanges: [],
        modifiedRanges: [],
        deletionMarkers: [],
      };
    }

    return yield* git.getFileLineChanges({
      cwd: input.cwd,
      path: file.relativePath,
      contentRevision: input.contentRevision,
      lineCount,
      byteLength: file.byteLength,
      ...(input.headOid === undefined ? {} : { headOidHint: input.headOid }),
    });
  });

  const getBlame: FileAnnotationService["Service"]["getBlame"] = Effect.fn(
    "FileAnnotationService.getBlame",
  )(function* (input) {
    const file = yield* readVerified(input, true);
    const handle = yield* registry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new FileAnnotationUnsupportedError({ path: input.path });
    }

    const result = yield* git.getFileBlame({
      cwd: input.cwd,
      path: file.relativePath,
      contentRevision: input.contentRevision,
      lineCount: countTextLines(file.contents),
      byteLength: file.byteLength,
      ...(input.headOid === undefined ? {} : { headOidHint: input.headOid }),
    });

    // Blame can walk history for seconds. Prove that its line numbers still
    // describe the bytes the client requested before returning it.
    yield* readVerified(input, true);
    return result;
  });

  return FileAnnotationService.of({ getLineChanges, getBlame });
});

export const layer = Layer.effect(FileAnnotationService, make);
