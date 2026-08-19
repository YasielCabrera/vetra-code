// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- Owns an isolated Node child-process protocol, outside Effect scheduling.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

export interface RawPowerhouseDatabaseQueryResult {
  readonly columns: ReadonlyArray<{ readonly name: string; readonly dataTypeId: number }>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

interface WorkerSuccess {
  readonly id: number;
  readonly ok: true;
  readonly columns: ReadonlyArray<{ readonly name: string; readonly dataTypeId: number }>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

interface WorkerFailure {
  readonly id: number;
  readonly ok: false;
  readonly message: string;
  readonly code?: string | undefined;
}

interface PendingRequest {
  readonly resolve: (value: RawPowerhouseDatabaseQueryResult) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export class PowerhousePgliteWorkerError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string | undefined) {
    super(message);
    this.name = "PowerhousePgliteWorkerError";
    this.code = code;
  }
}

const WORKER_SOURCE = String.raw`
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const runtimeEntry = process.argv[1];
const pgDataDirectory = process.argv[2];
const runtime = await import(pathToFileURL(runtimeEntry).href);
const PGlite = runtime.PGlite ?? runtime.default?.PGlite;
if (typeof PGlite !== "function") throw new Error("The installed PGlite runtime has no PGlite export.");

const database = new PGlite(pgDataDirectory);
await database.waitReady;
process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();

const run = async (request) => {
  let transactionOpen = false;
  try {
    await database.exec("BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    await database.exec("SET LOCAL statement_timeout = '10s'");
    await database.query("SELECT 1");
    await database.exec("DECLARE vetra_database_cursor NO SCROLL CURSOR FOR " + request.sql);
    const result = await database.query(
      "FETCH FORWARD " + String(request.limit + 1) + " FROM vetra_database_cursor",
      [],
      { rowMode: "array" },
    );
    const response = JSON.stringify({
      id: request.id,
      ok: true,
      columns: (result.fields ?? []).map((field) => ({
        name: String(field.name ?? ""),
        dataTypeId: Number(field.dataTypeID ?? field.dataTypeId ?? 0),
      })),
      rows: result.rows ?? [],
    });
    if (Buffer.byteLength(response, "utf8") > 2 * 1024 * 1024) {
      process.stdout.write(JSON.stringify({
        id: request.id,
        ok: false,
        message: "The database result exceeded the transfer limit.",
        code: "VETRA_RESPONSE_TOO_LARGE",
      }) + "\n");
    } else {
      process.stdout.write(response + "\n");
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : "PGlite query failed.",
      code: typeof error?.code === "string" ? error.code : undefined,
    }) + "\n");
  } finally {
    if (transactionOpen) {
      try { await database.exec("ROLLBACK"); } catch {}
    }
  }
};

lines.on("line", (line) => {
  chain = chain.then(() => run(JSON.parse(line)));
});

const close = async () => {
  lines.close();
  try { await chain; } catch {}
  try { await database.close(); } catch {}
  process.exit(0);
};
process.once("SIGTERM", close);
process.once("SIGINT", close);
`;

const isWorkerSuccess = (value: unknown): value is WorkerSuccess => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkerSuccess>;
  return (
    typeof candidate.id === "number" &&
    candidate.ok === true &&
    Array.isArray(candidate.columns) &&
    Array.isArray(candidate.rows)
  );
};

const isWorkerFailure = (value: unknown): value is WorkerFailure => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkerFailure>;
  return (
    typeof candidate.id === "number" &&
    candidate.ok === false &&
    typeof candidate.message === "string"
  );
};

const findNearestPackageRequire = (projectDirectory: string) =>
  NodeModule.createRequire(NodePath.join(projectDirectory, "package.json"));

const findDependencyPackageJson = (packageRequire: NodeJS.Require, packageName: string): string => {
  for (const nodeModulesDirectory of packageRequire.resolve.paths(packageName) ?? []) {
    const candidate = NodePath.join(
      nodeModulesDirectory,
      ...packageName.split("/"),
      "package.json",
    );
    if (NodeFS.existsSync(candidate)) return candidate;
  }
  const error = new Error(`Cannot find package '${packageName}'.`) as Error & { code: string };
  error.code = "MODULE_NOT_FOUND";
  throw error;
};

export function resolvePowerhousePgliteRuntime(
  projectDirectory: string,
  postgresMajorVersion: 16 | 17,
): string {
  const projectRequire = findNearestPackageRequire(projectDirectory);
  // ph-cli is a bin-only package: it intentionally has no main export, so
  // resolving the package root fails even when it is installed correctly.
  const cliPackage = projectRequire.resolve("@powerhousedao/ph-cli/package.json");
  const cliRequire = NodeModule.createRequire(cliPackage);
  // Current Switchboard releases expose import-only entry points. Looking up
  // the package root or package.json through require.resolve therefore throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED. Locate the installed dependency package
  // from ph-cli's normal module search paths, then resolve the matching PGlite
  // runtime from Switchboard's dependency context.
  const switchboardPackage = findDependencyPackageJson(cliRequire, "@powerhousedao/switchboard");
  const switchboardRequire = NodeModule.createRequire(switchboardPackage);
  return switchboardRequire.resolve(
    postgresMajorVersion === 16 ? "pglite-legacy-02" : "@electric-sql/pglite",
  );
}

export class PowerhousePgliteSession {
  readonly #child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, PendingRequest>();
  #nextRequestId = 1;
  #stdoutBuffer = "";
  #closed = false;

  private constructor(child: NodeChildProcess.ChildProcessWithoutNullStreams) {
    this.#child = child;
  }

  static async open(input: {
    readonly runtimeEntry: string;
    readonly pgDataDirectory: string;
  }): Promise<PowerhousePgliteSession> {
    const child = NodeChildProcess.spawn(
      process.execPath,
      ["--input-type=module", "--eval", WORKER_SOURCE, input.runtimeEntry, input.pgDataDirectory],
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NODE_NO_WARNINGS: "1" } },
    );
    const session = new PowerhousePgliteSession(child);
    await session.#waitUntilReady();
    return session;
  }

  #waitUntilReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(() => {
        cleanup();
        this.#terminate();
        reject(new PowerhousePgliteWorkerError("PGlite did not become ready in time."));
      }, 30_000);
      timeout.unref();
      const onStderr = (chunk: Buffer) => {
        if (stderr.length < 8_192) stderr += chunk.toString("utf8").slice(0, 8_192 - stderr.length);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = () => {
        cleanup();
        reject(new PowerhousePgliteWorkerError(stderr.trim() || "PGlite exited during startup."));
      };
      const onData = (chunk: Buffer) => {
        this.#stdoutBuffer += chunk.toString("utf8");
        const newline = this.#stdoutBuffer.indexOf("\n");
        if (newline < 0) return;
        const line = this.#stdoutBuffer.slice(0, newline);
        this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
        try {
          const message = JSON.parse(line) as { readonly type?: unknown };
          if (message.type !== "ready") throw new Error("Unexpected PGlite startup response.");
        } catch {
          cleanup();
          this.#terminate();
          reject(new PowerhousePgliteWorkerError("PGlite returned an invalid startup response."));
          return;
        }
        cleanup();
        this.#attachProtocol();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.#child.stdout.off("data", onData);
        this.#child.stderr.off("data", onStderr);
        this.#child.off("error", onError);
        this.#child.off("exit", onExit);
      };
      this.#child.stdout.on("data", onData);
      this.#child.stderr.on("data", onStderr);
      this.#child.once("error", onError);
      this.#child.once("exit", onExit);
    });
  }

  #attachProtocol() {
    this.#child.stdout.on("data", (chunk: Buffer) => {
      this.#stdoutBuffer += chunk.toString("utf8");
      while (true) {
        const newline = this.#stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = this.#stdoutBuffer.slice(0, newline);
        this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          this.#failAll(new PowerhousePgliteWorkerError("PGlite returned an invalid response."));
          this.#terminate();
          return;
        }
        if (!isWorkerSuccess(message) && !isWorkerFailure(message)) continue;
        const pending = this.#pending.get(message.id);
        if (pending === undefined) continue;
        this.#pending.delete(message.id);
        pending.cleanup();
        if (message.ok) {
          pending.resolve({ columns: message.columns, rows: message.rows });
        } else {
          pending.reject(new PowerhousePgliteWorkerError(message.message, message.code));
        }
      }
    });
    this.#child.once("error", (error) => this.#failAll(error));
    this.#child.once("exit", () => {
      this.#closed = true;
      this.#failAll(new PowerhousePgliteWorkerError("The PGlite inspection process exited."));
    });
  }

  query(
    sql: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RawPowerhouseDatabaseQueryResult> {
    if (this.#closed) return Promise.reject(new PowerhousePgliteWorkerError("PGlite is closed."));
    return new Promise((resolve, reject) => {
      const id = this.#nextRequestId++;
      const onAbort = () => {
        this.#pending.delete(id);
        this.#terminate();
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Query interrupted."));
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(id, { resolve, reject, cleanup });
      this.#child.stdin.write(`${JSON.stringify({ id, sql, limit })}\n`, (error) => {
        if (error === null || error === undefined) return;
        const pending = this.#pending.get(id);
        if (pending === undefined) return;
        this.#pending.delete(id);
        pending.cleanup();
        pending.reject(error);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.#closed) this.#terminate();
    await new Promise<void>((resolve) => {
      if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
        resolve();
        return;
      }
      const force = setTimeout(() => this.#child.kill("SIGKILL"), 2_000);
      const giveUp = setTimeout(resolve, 3_000);
      force.unref();
      giveUp.unref();
      this.#child.once("exit", () => {
        clearTimeout(force);
        clearTimeout(giveUp);
        resolve();
      });
    });
  }

  #terminate() {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.kill("SIGTERM");
    this.#failAll(new PowerhousePgliteWorkerError("The PGlite inspection process was closed."));
  }

  #failAll(error: Error) {
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
