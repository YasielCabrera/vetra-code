// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  POWERHOUSE_SNAPSHOT_MAX_BYTES,
  PowerhouseSnapshotDecodeError,
  removeRestoredPowerhouseSnapshot,
  restorePowerhouseSnapshot,
} from "./powerhouseDatabaseSnapshot.ts";

interface SnapshotEntry {
  readonly type: 0 | 1;
  readonly path: string;
  readonly data?: Buffer;
}

const temporaryDirectories: string[] = [];

const makeSnapshot = (entries: ReadonlyArray<SnapshotEntry>, version = 1) => {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write("PGLA", 0, "ascii");
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(entries.length, 8);
  chunks.push(header);
  for (const entry of entries) {
    const path = Buffer.from(entry.path, "utf8");
    const prefix = Buffer.alloc(9);
    prefix.writeUInt8(entry.type, 0);
    prefix.writeUInt32LE(entry.type === 0 ? 0o700 : 0o600, 1);
    prefix.writeUInt32LE(path.byteLength, 5);
    const data = entry.data ?? Buffer.alloc(0);
    const dataLength = Buffer.alloc(4);
    dataLength.writeUInt32LE(data.byteLength, 0);
    chunks.push(prefix, path, dataLength, data);
  }
  return Buffer.concat(chunks);
};

const makeSource = async (contents: Buffer) => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vetra-snapshot-test-"));
  temporaryDirectories.push(directory);
  const snapshotPath = NodePath.join(directory, "snapshot.bin");
  await NodeFSP.writeFile(snapshotPath, contents);
  return snapshotPath;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

describe("restorePowerhouseSnapshot", () => {
  it.each([16, 17] as const)(
    "restores a PG%s snapshot without changing its source",
    async (major) => {
      const bytes = makeSnapshot([
        { type: 0, path: "base" },
        { type: 1, path: "PG_VERSION", data: Buffer.from(`${major}\n`) },
        { type: 1, path: "base/1", data: Buffer.from("database bytes") },
      ]);
      const snapshotPath = await makeSource(bytes);
      const before = await NodeFSP.readFile(snapshotPath);

      const restored = await restorePowerhouseSnapshot(snapshotPath);
      temporaryDirectories.push(restored.directory);

      expect(restored.postgresMajorVersion).toBe(major);
      expect(
        await NodeFSP.readFile(NodePath.join(restored.pgDataDirectory, "base/1"), "utf8"),
      ).toBe("database bytes");
      expect(await NodeFSP.readFile(snapshotPath)).toEqual(before);
      await removeRestoredPowerhouseSnapshot(restored.directory);
      temporaryDirectories.splice(temporaryDirectories.indexOf(restored.directory), 1);
    },
  );

  it.each([
    ["a traversal", [{ type: 1 as const, path: "../secret", data: Buffer.from("x") }]],
    ["an absolute path", [{ type: 1 as const, path: "/secret", data: Buffer.from("x") }]],
    [
      "a duplicate",
      [
        { type: 1 as const, path: "PG_VERSION", data: Buffer.from("17") },
        { type: 1 as const, path: "PG_VERSION", data: Buffer.from("17") },
      ],
    ],
  ])("rejects %s", async (_label, entries) => {
    const snapshotPath = await makeSource(makeSnapshot(entries));
    await expect(restorePowerhouseSnapshot(snapshotPath)).rejects.toBeInstanceOf(
      PowerhouseSnapshotDecodeError,
    );
  });

  it("rejects a truncated entry", async () => {
    const valid = makeSnapshot([
      { type: 1, path: "PG_VERSION", data: Buffer.from("17") },
      { type: 1, path: "base/1", data: Buffer.from("payload") },
    ]);
    const snapshotPath = await makeSource(valid.subarray(0, valid.byteLength - 3));
    await expect(restorePowerhouseSnapshot(snapshotPath)).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("rejects unknown snapshot format versions instead of guessing", async () => {
    const snapshotPath = await makeSource(makeSnapshot([], 2));
    await expect(restorePowerhouseSnapshot(snapshotPath)).rejects.toMatchObject({
      reason: "unsupported_version",
    });
  });

  it("rejects sparse snapshots over the inspection limit before decoding", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "vetra-snapshot-test-"));
    temporaryDirectories.push(directory);
    const snapshotPath = NodePath.join(directory, "snapshot.bin");
    const file = await NodeFSP.open(snapshotPath, "w");
    try {
      await file.truncate(POWERHOUSE_SNAPSHOT_MAX_BYTES + 1);
    } finally {
      await file.close();
    }
    await expect(restorePowerhouseSnapshot(snapshotPath)).rejects.toMatchObject({
      reason: "too_large",
    });
  });
});
