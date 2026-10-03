import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Workspace file access requested through the ACP client `fs` capability.
 * The agent gates each write behind `session/request_permission`, so only
 * path containment is checked here.
 */
const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024;

function isInsideRoot(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve every symlink the path already has on disk, keeping the segments that
 * do not exist yet. A write may name a directory the agent has not created, so
 * `realPath` on the parent can fail; falling back to the unresolved parent
 * would then compare an unresolved candidate against resolved roots and reject
 * a legitimate path whenever the workspace is reached through a link — every
 * macOS temp directory, and any symlinked projects directory.
 */
const realPathOfNearestAncestor = Effect.fn("AntigravityClientFiles.realPathOfNearestAncestor")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly resolved: string;
  }) {
    const { path } = input;
    const missing: Array<string> = [];
    let current = input.resolved;
    for (;;) {
      const real = yield* input.fileSystem.realPath(current).pipe(
        Effect.map((value): string | undefined => value),
        Effect.orElseSucceed(() => undefined),
      );
      if (real !== undefined) return path.join(real, ...missing.reverse());
      const parent = path.dirname(current);
      // `dirname` is a fixed point at the filesystem root, so nothing above
      // this exists to resolve and the path is used as written.
      if (parent === current) return input.resolved;
      missing.push(path.basename(current));
      current = parent;
    }
  },
);

/**
 * Resolves an agent-supplied path and rejects anything outside the session
 * roots. Symlinks resolve before the check, including the final component, so
 * a link inside the workspace cannot read or write through to a file outside
 * it. An entry that exists but cannot be resolved, like a dangling link, is
 * rejected rather than written through.
 */
const resolveClientFilePath = Effect.fn("AntigravityClientFiles.resolveClientFilePath")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly requestPath: string;
  }) {
    const { path } = input;
    const resolved = path.resolve(input.requestPath);
    const outside = EffectAcpErrors.AcpRequestError.invalidParams(
      `Path '${input.requestPath}' is outside the session workspace.`,
    );
    const real = yield* input.fileSystem.realPath(resolved).pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          // Only a missing file (a new write) falls back to its parent; a
          // dangling or unreadable link must not be followed on write.
          const entryExists = yield* input.fileSystem.readLink(resolved).pipe(
            Effect.as(true),
            Effect.catch(() => input.fileSystem.exists(resolved)),
            Effect.orElseSucceed(() => true),
          );
          if (entryExists) return yield* outside;
          return yield* realPathOfNearestAncestor({
            fileSystem: input.fileSystem,
            path,
            resolved: path.dirname(resolved),
          }).pipe(Effect.map((parent) => path.join(parent, path.basename(resolved))));
        }),
      ),
    );
    const roots = yield* Effect.forEach(input.allowedRoots, (root) =>
      input.fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root)),
    );
    if (!roots.some((root) => isInsideRoot(path, root, real))) {
      return yield* outside;
    }
    return real;
  },
);

export const readAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.readTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.ReadTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.ReadTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    const info = yield* input.fileSystem
      .stat(filePath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.resourceNotFound(
            `File '${input.request.path}' not found.`,
          ),
        ),
      );
    if (info.type !== "File" || Number(info.size) > CLIENT_FILE_MAX_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `File '${input.request.path}' is not a readable text file under ${CLIENT_FILE_MAX_BYTES} bytes.`,
      );
    }
    const text = yield* input.fileSystem
      .readFileString(filePath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.internalError(`Could not read '${input.request.path}'.`),
        ),
      );
    const line = input.request.line ?? undefined;
    const limit = input.request.limit ?? undefined;
    if (line === undefined && limit === undefined) {
      return { content: text };
    }
    // ACP lines are 1-indexed. `limit` is a line count.
    const lines = text.split("\n");
    const start = Math.max(0, (line ?? 1) - 1);
    const end = limit === undefined ? lines.length : Math.min(lines.length, start + limit);
    return { content: lines.slice(start, end).join("\n") };
  },
);

export const writeAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.writeTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.WriteTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.WriteTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    yield* input.fileSystem.makeDirectory(input.path.dirname(filePath), { recursive: true }).pipe(
      Effect.andThen(input.fileSystem.writeFileString(filePath, input.request.content)),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.internalError(`Could not write '${input.request.path}'.`),
      ),
    );
    return {};
  },
);
