// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  PowerhousePgliteSession,
  PowerhousePgliteWorkerError,
  resolvePowerhousePgliteRuntime,
} from "./powerhousePgliteSession.ts";

const temporaryDirectories: string[] = [];

const MOCK_RUNTIME = `
export class PGlite {
  waitReady = Promise.resolve();
  async exec() {}
  async query(statement) {
    if (statement === "SELECT 1") return { fields: [], rows: [] };
    if (statement.startsWith("FETCH FORWARD")) {
      return {
        fields: [{ name: "value", dataTypeID: 25 }],
        rows: globalThis.__largeResult ? [["x".repeat(2 * 1024 * 1024)]] : [["one"], ["two"]],
      };
    }
    return { fields: [], rows: [] };
  }
  async close() {}
}
`;

const openMockSession = async (largeResult = false) => {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "vetra-pglite-worker-test-"),
  );
  temporaryDirectories.push(directory);
  const runtimeEntry = NodePath.join(directory, "runtime.mjs");
  const source = largeResult ? `${MOCK_RUNTIME}\nglobalThis.__largeResult = true;\n` : MOCK_RUNTIME;
  await NodeFSP.writeFile(runtimeEntry, source, "utf8");
  const pgDataDirectory = NodePath.join(directory, "pgdata");
  await NodeFSP.mkdir(pgDataDirectory);
  return PowerhousePgliteSession.open({ runtimeEntry, pgDataDirectory });
};

const writePackage = async (
  projectDirectory: string,
  packagePath: string,
  packageJson: Record<string, unknown>,
) => {
  const directory = NodePath.join(projectDirectory, "node_modules", ...packagePath.split("/"));
  await NodeFSP.mkdir(directory, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(directory, "package.json"),
    JSON.stringify(packageJson),
    "utf8",
  );
  if (typeof packageJson.main === "string") {
    await NodeFSP.writeFile(NodePath.join(directory, packageJson.main), "export {};\n", "utf8");
  }
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

describe("PowerhousePgliteSession", () => {
  it("resolves PG16 and PG17 through an installed bin-only ph-cli package", async () => {
    const projectDirectory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "vetra-pglite-runtime-test-"),
    );
    temporaryDirectories.push(projectDirectory);
    await NodeFSP.writeFile(NodePath.join(projectDirectory, "package.json"), "{}", "utf8");
    await writePackage(projectDirectory, "@powerhousedao/ph-cli", {
      name: "@powerhousedao/ph-cli",
      bin: { "ph-cli": "dist/cli.mjs" },
    });
    const switchboard = await writePackage(projectDirectory, "@powerhousedao/switchboard", {
      name: "@powerhousedao/switchboard",
      exports: {
        ".": {
          import: "./dist/index.mjs",
        },
      },
    });
    const pg16 = await writePackage(switchboard, "pglite-legacy-02", {
      name: "pglite-legacy-02",
      main: "index.js",
    });
    const pg17 = await writePackage(switchboard, "@electric-sql/pglite", {
      name: "@electric-sql/pglite",
      main: "index.js",
    });

    expect(resolvePowerhousePgliteRuntime(projectDirectory, 16)).toBe(
      await NodeFSP.realpath(NodePath.join(pg16, "index.js")),
    );
    expect(resolvePowerhousePgliteRuntime(projectDirectory, 17)).toBe(
      await NodeFSP.realpath(NodePath.join(pg17, "index.js")),
    );
  });

  it("runs the isolated child protocol and returns array rows", async () => {
    const session = await openMockSession();
    const result = await session.query("SELECT value FROM example", 50);
    expect(result).toEqual({
      columns: [{ name: "value", dataTypeId: 25 }],
      rows: [["one"], ["two"]],
    });
    await session.close();
  });

  it("rejects child responses larger than the websocket result budget", async () => {
    const session = await openMockSession(true);
    await expect(session.query("SELECT large_value FROM example", 50)).rejects.toMatchObject({
      code: "VETRA_RESPONSE_TOO_LARGE",
    });
    await session.close();
  });

  it("terminates the captured helper process when a request is interrupted", async () => {
    const session = await openMockSession();
    const controller = new AbortController();
    controller.abort(new Error("interrupted"));
    await expect(session.query("SELECT value FROM example", 50, controller.signal)).rejects.toThrow(
      "interrupted",
    );
    await expect(session.query("SELECT value FROM example", 50)).rejects.toBeInstanceOf(
      PowerhousePgliteWorkerError,
    );
    await session.close();
  });
});
