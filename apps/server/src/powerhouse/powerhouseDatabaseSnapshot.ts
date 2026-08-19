// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const POWERHOUSE_SNAPSHOT_MAX_BYTES = 512 * 1024 * 1024;

const SNAPSHOT_MAGIC = Buffer.from("PGLA", "ascii");
const SNAPSHOT_FORMAT_VERSION = 1;
const SNAPSHOT_HEADER_BYTES = 12;
const ENTRY_PREFIX_BYTES = 9;
const MAX_ENTRY_COUNT = 100_000;
const MAX_PATH_BYTES = 4_096;
const COPY_BUFFER_BYTES = 256 * 1024;

export class PowerhouseSnapshotDecodeError extends Error {
  readonly reason: "invalid" | "too_large" | "unsupported_version";

  constructor(
    reason: "invalid" | "too_large" | "unsupported_version",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PowerhouseSnapshotDecodeError";
    this.reason = reason;
  }
}

export interface RestoredPowerhouseSnapshot {
  readonly directory: string;
  readonly pgDataDirectory: string;
  readonly postgresMajorVersion: 16 | 17;
  readonly snapshotSizeBytes: number;
  readonly snapshotWrittenAtUtcIso: string;
}

interface SnapshotReader {
  readonly size: number;
  offset: number;
  read(length: number): Promise<Buffer>;
  copyTo(file: NodeFSP.FileHandle, length: number): Promise<void>;
}

const invalidSnapshot = (message: string, cause?: unknown) =>
  new PowerhouseSnapshotDecodeError(
    "invalid",
    message,
    cause === undefined ? undefined : { cause },
  );

const readExact = async (file: NodeFSP.FileHandle, offset: number, length: number) => {
  const output = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const result = await file.read(output, read, length - read, offset + read);
    if (result.bytesRead === 0) throw invalidSnapshot("The snapshot ended unexpectedly.");
    read += result.bytesRead;
  }
  return output;
};

const makeReader = (file: NodeFSP.FileHandle, size: number): SnapshotReader => ({
  size,
  offset: 0,
  async read(length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > size) {
      throw invalidSnapshot("The snapshot contains an invalid entry length.");
    }
    const output = await readExact(file, this.offset, length);
    this.offset += length;
    return output;
  },
  async copyTo(output, length) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > size) {
      throw invalidSnapshot("The snapshot contains an invalid file length.");
    }
    const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(1, length)));
    let remaining = length;
    while (remaining > 0) {
      const chunkLength = Math.min(buffer.byteLength, remaining);
      const result = await file.read(buffer, 0, chunkLength, this.offset);
      if (result.bytesRead === 0) throw invalidSnapshot("The snapshot ended unexpectedly.");
      await output.write(buffer.subarray(0, result.bytesRead));
      this.offset += result.bytesRead;
      remaining -= result.bytesRead;
    }
  },
});

const decodePath = (bytes: Buffer) => {
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw invalidSnapshot("The snapshot contains a path that is not valid UTF-8.", cause);
  }
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    NodePath.posix.isAbsolute(value)
  ) {
    throw invalidSnapshot("The snapshot contains an unsafe path.");
  }
  const normalized = NodePath.posix.normalize(value);
  if (normalized !== value || normalized === ".." || normalized.startsWith("../")) {
    throw invalidSnapshot("The snapshot contains a path traversal.");
  }
  return value;
};

const pathWithin = (root: string, candidate: string) => {
  const relative = NodePath.relative(root, candidate);
  return (
    relative.length === 0 ||
    (relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relative))
  );
};

const readPostgresMajorVersion = async (pgDataDirectory: string): Promise<16 | 17> => {
  let value: string;
  try {
    value = (await NodeFSP.readFile(NodePath.join(pgDataDirectory, "PG_VERSION"), "utf8")).trim();
  } catch (cause) {
    throw invalidSnapshot("The snapshot does not contain a readable PG_VERSION file.", cause);
  }
  if (value === "16") return 16;
  if (value === "17") return 17;
  throw new PowerhouseSnapshotDecodeError(
    "unsupported_version",
    `The snapshot uses unsupported PostgreSQL major version ${value || "unknown"}.`,
  );
};

/**
 * Restore one immutable Powerhouse snapshot inode into a Vetra-owned directory.
 * The source descriptor is opened before reading so an atomic replacement by
 * Powerhouse cannot mix bytes from two snapshots.
 */
export async function restorePowerhouseSnapshot(
  snapshotPath: string,
): Promise<RestoredPowerhouseSnapshot> {
  const noFollow = NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0);
  const source = await NodeFSP.open(snapshotPath, noFollow);
  let temporaryDirectory: string | undefined;
  try {
    const stat = await source.stat();
    if (!stat.isFile()) throw invalidSnapshot("The snapshot path is not a regular file.");
    if (stat.size > POWERHOUSE_SNAPSHOT_MAX_BYTES) {
      throw new PowerhouseSnapshotDecodeError(
        "too_large",
        "The snapshot is larger than the 512 MiB inspection limit.",
      );
    }
    if (stat.size < SNAPSHOT_HEADER_BYTES) {
      throw invalidSnapshot("The snapshot is shorter than its header.");
    }

    const reader = makeReader(source, stat.size);
    const header = await reader.read(SNAPSHOT_HEADER_BYTES);
    if (!header.subarray(0, SNAPSHOT_MAGIC.byteLength).equals(SNAPSHOT_MAGIC)) {
      throw invalidSnapshot("The snapshot has an invalid magic header.");
    }
    const formatVersion = header.readUInt32LE(4);
    if (formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      throw new PowerhouseSnapshotDecodeError(
        "unsupported_version",
        `Snapshot format version ${formatVersion} is not supported.`,
      );
    }
    const entryCount = header.readUInt32LE(8);
    if (entryCount > MAX_ENTRY_COUNT) {
      throw invalidSnapshot("The snapshot contains too many entries.");
    }

    temporaryDirectory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "vetra-powerhouse-database-"),
    );
    const pgDataDirectory = NodePath.join(temporaryDirectory, "pgdata");
    await NodeFSP.mkdir(pgDataDirectory, { mode: 0o700 });
    const seenPaths = new Set<string>();

    for (let index = 0; index < entryCount; index += 1) {
      const entryHeader = await reader.read(ENTRY_PREFIX_BYTES);
      const type = entryHeader.readUInt8(0);
      const mode = entryHeader.readUInt32LE(1) & 0o777;
      const pathLength = entryHeader.readUInt32LE(5);
      if (type !== 0 && type !== 1)
        throw invalidSnapshot("The snapshot has an invalid entry type.");
      if (pathLength === 0 || pathLength > MAX_PATH_BYTES) {
        throw invalidSnapshot("The snapshot has an invalid path length.");
      }
      const relativePath = decodePath(await reader.read(pathLength));
      if (seenPaths.has(relativePath))
        throw invalidSnapshot("The snapshot contains duplicate paths.");
      seenPaths.add(relativePath);
      const dataLengthBytes = await reader.read(4);
      const dataLength = dataLengthBytes.readUInt32LE(0);
      const destination = NodePath.resolve(pgDataDirectory, ...relativePath.split("/"));
      if (!pathWithin(pgDataDirectory, destination)) {
        throw invalidSnapshot("The snapshot contains a path traversal.");
      }

      if (type === 0) {
        if (dataLength !== 0) throw invalidSnapshot("A snapshot directory contains file data.");
        await NodeFSP.mkdir(destination, { recursive: true, mode: mode || 0o700 });
        await NodeFSP.chmod(destination, mode || 0o700);
        continue;
      }

      await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true, mode: 0o700 });
      const output = await NodeFSP.open(destination, "wx", mode || 0o600);
      try {
        await reader.copyTo(output, dataLength);
      } finally {
        await output.close();
      }
      await NodeFSP.chmod(destination, mode || 0o600);
    }

    if (reader.offset !== reader.size) {
      throw invalidSnapshot("The snapshot contains trailing bytes.");
    }
    const postgresMajorVersion = await readPostgresMajorVersion(pgDataDirectory);
    return {
      directory: temporaryDirectory,
      pgDataDirectory,
      postgresMajorVersion,
      snapshotSizeBytes: stat.size,
      snapshotWrittenAtUtcIso: stat.mtime.toISOString(),
    };
  } catch (cause) {
    if (temporaryDirectory !== undefined) {
      await NodeFSP.rm(temporaryDirectory, { recursive: true, force: true });
    }
    throw cause;
  } finally {
    await source.close();
  }
}

export async function removeRestoredPowerhouseSnapshot(directory: string): Promise<void> {
  const expectedPrefix = NodePath.join(NodeOS.tmpdir(), "vetra-powerhouse-database-");
  const resolved = NodePath.resolve(directory);
  if (!resolved.startsWith(expectedPrefix) || resolved === expectedPrefix) {
    throw new Error("Refusing to clean up a directory not owned by the Powerhouse inspector.");
  }
  await NodeFSP.rm(resolved, { recursive: true, force: true });
}
