/**
 * PowerhouseDatabaseInspector is the server-only boundary for database
 * discovery and inspection. Its public interface accepts project identities,
 * never paths or connection strings; backend-specific authority stays inside
 * the module.
 *
 * @module PowerhouseDatabaseInspector
 */
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- Timer owns expiry for imperative child-process sessions.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeTimers from "node:timers";
import * as NodeUtil from "node:util";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Client, type FieldDef } from "pg";
import Cursor from "pg-cursor";

import {
  type PowerhouseDatabaseCatalogInput,
  type PowerhouseDatabaseCatalogResult,
  type PowerhouseDatabaseColumn,
  PowerhouseDatabaseError,
  type PowerhouseDatabaseExecuteQueryInput,
  type PowerhouseDatabaseExecuteQueryResult,
  type PowerhouseDatabaseGetRelationInput,
  type PowerhouseDatabaseGetRelationResult,
  type PowerhouseDatabasePreviewRelationInput,
  type PowerhouseDatabasePreviewRelationResult,
  type PowerhouseDatabaseQueryResult,
  type PowerhouseDatabaseRefreshSnapshotInput,
  type PowerhouseDatabaseRefreshSnapshotResult,
  type PowerhouseDatabaseRelationDetail,
  type PowerhouseDatabaseRelationKind,
  type PowerhouseDatabaseRowLimit,
  type PowerhouseDatabaseSchemaSummary,
  type PowerhouseDatabaseTarget,
  type PowerhouseDatabaseTargetId,
  type PowerhouseDatabaseTargetSource,
  type PowerhouseDatabaseDiscoverInput,
  type PowerhouseDatabaseDiscoverResult,
  type PowerhouseProjectError,
} from "@vetra-code/contracts";

import * as PowerhouseProject from "./PowerhouseProject.ts";
import {
  PowerhousePgliteSession,
  PowerhousePgliteWorkerError,
  type RawPowerhouseDatabaseQueryResult,
  resolvePowerhousePgliteRuntime,
} from "./powerhousePgliteSession.ts";
import {
  POWERHOUSE_SNAPSHOT_MAX_BYTES,
  PowerhouseSnapshotDecodeError,
  removeRestoredPowerhouseSnapshot,
  restorePowerhouseSnapshot,
} from "./powerhouseDatabaseSnapshot.ts";
import {
  PowerhouseSqlRejectedError,
  quotePowerhouseIdentifier,
  validatePowerhouseReadQuery,
} from "./powerhouseDatabaseSql.ts";

type InspectorError = PowerhouseDatabaseError | PowerhouseProjectError;

interface ProjectDatabaseRef {
  readonly cwd: string;
  readonly projectPath?: string | undefined;
}

export class PowerhouseDatabaseInspector extends Context.Service<
  PowerhouseDatabaseInspector,
  {
    readonly discover: (
      input: PowerhouseDatabaseDiscoverInput,
    ) => Effect.Effect<PowerhouseDatabaseDiscoverResult, InspectorError>;
    readonly catalog: (
      input: PowerhouseDatabaseCatalogInput,
    ) => Effect.Effect<PowerhouseDatabaseCatalogResult, InspectorError>;
    readonly getRelation: (
      input: PowerhouseDatabaseGetRelationInput,
    ) => Effect.Effect<PowerhouseDatabaseGetRelationResult, InspectorError>;
    readonly previewRelation: (
      input: PowerhouseDatabasePreviewRelationInput,
    ) => Effect.Effect<PowerhouseDatabasePreviewRelationResult, InspectorError>;
    readonly executeQuery: (
      input: PowerhouseDatabaseExecuteQueryInput,
    ) => Effect.Effect<PowerhouseDatabaseExecuteQueryResult, InspectorError>;
    readonly refreshSnapshot: (
      input: PowerhouseDatabaseRefreshSnapshotInput,
    ) => Effect.Effect<PowerhouseDatabaseRefreshSnapshotResult, InspectorError>;
  }
>()("@vetra-code/server/powerhouse/PowerhouseDatabaseInspector") {}

const MAX_ENV_BYTES = 256 * 1024;
const MAX_CATALOG_RELATIONS = 20_000;
const MAX_RELATION_PARTS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DEFINITION_LENGTH = 256 * 1024;
const DEFAULT_ROW_LIMIT: PowerhouseDatabaseRowLimit = 100;
const PGLITE_SESSION_LIMIT = 2;
const PGLITE_IDLE_MILLIS = 5 * 60 * 1_000;
const STATEMENT_TIMEOUT_MILLIS = 10_000;

const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "PH_SWITCHBOARD_DATABASE_URL",
  "PH_REACTOR_DATABASE_URL",
] as const;

type DatabaseEnvironmentKey = (typeof DATABASE_ENV_KEYS)[number];

interface ConfiguredValue {
  readonly value: string;
  readonly source: PowerhouseDatabaseTargetSource;
}

interface ResolvedDatabaseTarget {
  readonly publicTarget: PowerhouseDatabaseTarget;
  readonly projectDirectory: string;
  readonly failure?: PowerhouseDatabaseError["failure"] | undefined;
  readonly connection:
    | { readonly backend: "pglite_snapshot"; readonly snapshotPath: string }
    | { readonly backend: "postgres"; readonly connectionString: string }
    | null;
}

interface CachedPgliteSession {
  readonly key: string;
  readonly projectDirectory: string;
  readonly target: PowerhouseDatabaseTargetId;
  readonly snapshotPath: string;
  readonly snapshotWrittenAtUtcIso: string;
  readonly restoredDirectory: string;
  readonly session: PowerhousePgliteSession;
  lastUsedAt: number;
  activeRequests: number;
  idleTimer: ReturnType<typeof NodeTimers.setTimeout> | null;
}

const targetLabel = (target: PowerhouseDatabaseTargetId) =>
  target === "read_models" ? "Read models" : "Reactor";

const pathWithin = (root: string, candidate: string) => {
  const relative = NodePath.relative(root, candidate);
  return (
    relative.length === 0 ||
    (relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relative))
  );
};

const isNodeErrorCode = (cause: unknown, code: string) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;

const safeErrorMessage = (cause: unknown, secrets: ReadonlyArray<string> = []) => {
  let message =
    typeof cause === "string"
      ? cause
      : cause instanceof Error
        ? cause.message
        : "The database operation failed.";
  for (const secret of secrets) {
    if (secret.length > 0) message = message.replaceAll(secret, "[redacted]");
  }
  message = message
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted database URL]")
    .replaceAll(/\/(?:Users|home|tmp)\/[^\s:;,]+/g, "[redacted path]")
    .trim();
  return (message.length === 0 ? "The database operation failed." : message).slice(0, 4_096);
};

const databaseError = (
  failure: PowerhouseDatabaseError["failure"],
  target: PowerhouseDatabaseTargetId,
  options?: { readonly message?: string; readonly secrets?: string[] },
) =>
  new PowerhouseDatabaseError({
    failure,
    target,
    ...(options?.message === undefined
      ? {}
      : { message: safeErrorMessage(options.message, options.secrets) }),
  });

const isPowerhouseDatabaseError = Schema.is(PowerhouseDatabaseError);

const publicTarget = (input: {
  readonly id: PowerhouseDatabaseTargetId;
  readonly backend: PowerhouseDatabaseTarget["backend"];
  readonly status: PowerhouseDatabaseTarget["status"];
  readonly source: PowerhouseDatabaseTargetSource;
  readonly snapshotWrittenAtUtcIso?: string | null;
  readonly detail?: string | null;
}): PowerhouseDatabaseTarget => ({
  id: input.id,
  label: targetLabel(input.id),
  backend: input.backend,
  status: input.status,
  source: input.source,
  snapshotWrittenAtUtcIso: input.snapshotWrittenAtUtcIso ?? null,
  detail: input.detail ?? null,
});

const readProjectEnvironment = async (projectDirectory: string) => {
  const envPath = NodePath.join(projectDirectory, ".env");
  const flags = NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0);
  let file: NodeFSP.FileHandle;
  try {
    file = await NodeFSP.open(envPath, flags);
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT"))
      return {} as Partial<Record<DatabaseEnvironmentKey, string>>;
    throw cause;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_ENV_BYTES) {
      throw new Error("The project .env file is not a regular file within the inspection limit.");
    }
    const parsed = NodeUtil.parseEnv(await file.readFile("utf8"));
    return Object.fromEntries(
      DATABASE_ENV_KEYS.flatMap((key) => (parsed[key] === undefined ? [] : [[key, parsed[key]]])),
    ) as Partial<Record<DatabaseEnvironmentKey, string>>;
  } finally {
    await file.close();
  }
};

const configuredValue = (
  key: DatabaseEnvironmentKey,
  projectEnvironment: Partial<Record<DatabaseEnvironmentKey, string>>,
): ConfiguredValue | undefined => {
  const serverValue = process.env[key];
  if (serverValue !== undefined) return { value: serverValue, source: "server_env" };
  const projectValue = projectEnvironment[key];
  return projectValue === undefined ? undefined : { value: projectValue, source: "project_env" };
};

const isPostgresUrl = (value: string) =>
  value.startsWith("postgres://") || value.startsWith("postgresql://");

const postgresTargetIsLocal = (connectionString: string) => {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return false;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
  const socketHost = url.searchParams.get("host");
  if (socketHost !== null && NodePath.isAbsolute(socketHost)) return true;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    (NodeNet.isIP(hostname) === 4 && hostname.startsWith("127."))
  );
};

const missingDetail = (target: PowerhouseDatabaseTargetId) =>
  target === "read_models"
    ? "No atomic snapshot was found. If ph vetra uses --db-path, set DATABASE_URL or PH_SWITCHBOARD_DATABASE_URL in the project .env."
    : "No atomic snapshot was found. If ph vetra uses --db-path, set PH_REACTOR_DATABASE_URL or PH_SWITCHBOARD_DATABASE_URL in the project .env.";

const selectTargetValue = (
  target: PowerhouseDatabaseTargetId,
  projectEnvironment: Partial<Record<DatabaseEnvironmentKey, string>>,
): ConfiguredValue => {
  const primary = configuredValue(
    target === "read_models" ? "DATABASE_URL" : "PH_REACTOR_DATABASE_URL",
    projectEnvironment,
  );
  const configured = primary ?? configuredValue("PH_SWITCHBOARD_DATABASE_URL", projectEnvironment);
  // Powerhouse's `??` precedence preserves an explicitly empty variable, then
  // its path selection uses `value || default` rather than treating it as an
  // in-memory database or falling through to the next variable.
  return configured === undefined || configured.value.length === 0
    ? {
        value: target === "read_models" ? ".ph/read-storage" : ".ph/reactor-storage",
        source: "default",
      }
    : configured;
};

const resolvePgliteTarget = async (input: {
  readonly id: PowerhouseDatabaseTargetId;
  readonly projectDirectory: string;
  readonly configured: ConfiguredValue;
}): Promise<ResolvedDatabaseTarget> => {
  const { id, projectDirectory, configured } = input;
  if (configured.value.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(configured.value)) {
    return {
      projectDirectory,
      connection: null,
      failure: "unsupported_backend",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: "unsupported",
        source: configured.source,
        detail: "In-memory and URL-backed PGlite databases are not supported in this version.",
      }),
    };
  }

  const storagePath = NodePath.resolve(projectDirectory, configured.value);
  if (!pathWithin(projectDirectory, storagePath)) {
    return {
      projectDirectory,
      connection: null,
      failure: "unsupported_backend",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: "unsupported",
        source: configured.source,
        detail: "The configured PGlite directory must stay inside the selected Powerhouse project.",
      }),
    };
  }

  let storageStat: NodeFS.Stats;
  try {
    storageStat = await NodeFSP.lstat(storagePath);
  } catch (cause) {
    if (isNodeErrorCode(cause, "ENOENT")) {
      return {
        projectDirectory,
        connection: null,
        failure: "missing",
        publicTarget: publicTarget({
          id,
          backend: "pglite_snapshot",
          status: "missing",
          source: configured.source,
          detail: missingDetail(id),
        }),
      };
    }
    throw cause;
  }
  if (!storageStat.isDirectory() || storageStat.isSymbolicLink()) {
    return {
      projectDirectory,
      connection: null,
      failure: "unsupported_backend",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: "unsupported",
        source: configured.source,
        detail: "The configured PGlite storage must be a project-local directory, not a link.",
      }),
    };
  }
  const canonicalStoragePath = await NodeFSP.realpath(storagePath);
  if (!pathWithin(projectDirectory, canonicalStoragePath)) {
    return {
      projectDirectory,
      connection: null,
      failure: "unsupported_backend",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: "unsupported",
        source: configured.source,
        detail: "The configured PGlite directory resolves outside the selected Powerhouse project.",
      }),
    };
  }

  const snapshotPath = NodePath.join(canonicalStoragePath, "snapshot.bin");
  let snapshotStat: NodeFS.Stats;
  try {
    snapshotStat = await NodeFSP.lstat(snapshotPath);
  } catch (cause) {
    if (!isNodeErrorCode(cause, "ENOENT")) throw cause;
    const legacyExists = await NodeFSP.lstat(NodePath.join(canonicalStoragePath, "PG_VERSION"))
      .then((stat) => stat.isFile())
      .catch(() => false);
    return {
      projectDirectory,
      connection: null,
      failure: legacyExists ? "unsupported_backend" : "missing",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: legacyExists ? "unsupported" : "missing",
        source: configured.source,
        detail: legacyExists
          ? "Legacy loose-file PGlite storage is not supported; start Powerhouse once to create an atomic snapshot."
          : missingDetail(id),
      }),
    };
  }
  if (!snapshotStat.isFile() || snapshotStat.isSymbolicLink()) {
    return {
      projectDirectory,
      connection: null,
      failure: "unsupported_backend",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: "unsupported",
        source: configured.source,
        detail: "snapshot.bin must be a regular file, not a link.",
      }),
    };
  }
  if (snapshotStat.size > POWERHOUSE_SNAPSHOT_MAX_BYTES) {
    return {
      projectDirectory,
      connection: null,
      failure: "snapshot_too_large",
      publicTarget: publicTarget({
        id,
        backend: "pglite_snapshot",
        status: "unsupported",
        source: configured.source,
        snapshotWrittenAtUtcIso: snapshotStat.mtime.toISOString(),
        detail: "The atomic snapshot exceeds the 512 MiB inspection limit.",
      }),
    };
  }
  const canonicalSnapshotPath = await NodeFSP.realpath(snapshotPath);
  if (!pathWithin(canonicalStoragePath, canonicalSnapshotPath)) {
    throw new Error("The PGlite snapshot resolves outside its storage directory.");
  }
  return {
    projectDirectory,
    connection: { backend: "pglite_snapshot", snapshotPath: canonicalSnapshotPath },
    publicTarget: publicTarget({
      id,
      backend: "pglite_snapshot",
      status: "ready",
      source: configured.source,
      snapshotWrittenAtUtcIso: snapshotStat.mtime.toISOString(),
    }),
  };
};

const resolveDatabaseTarget = async (input: {
  readonly id: PowerhouseDatabaseTargetId;
  readonly projectDirectory: string;
  readonly projectEnvironment: Partial<Record<DatabaseEnvironmentKey, string>>;
}) => {
  const configured = selectTargetValue(input.id, input.projectEnvironment);
  if (!isPostgresUrl(configured.value)) {
    return resolvePgliteTarget({ ...input, configured });
  }
  if (!postgresTargetIsLocal(configured.value)) {
    return {
      projectDirectory: input.projectDirectory,
      connection: null,
      failure: "unsupported_backend",
      publicTarget: publicTarget({
        id: input.id,
        backend: "postgres",
        status: "unsupported",
        source: configured.source,
        detail:
          "Only loopback and local Unix-socket Postgres targets are supported in this version.",
      }),
    } satisfies ResolvedDatabaseTarget;
  }
  return {
    projectDirectory: input.projectDirectory,
    connection: { backend: "postgres", connectionString: configured.value },
    publicTarget: publicTarget({
      id: input.id,
      backend: "postgres",
      status: "ready",
      source: configured.source,
    }),
  } satisfies ResolvedDatabaseTarget;
};

const readCursor = <Row>(cursor: Cursor<Row>, count: number) =>
  new Promise<{ readonly rows: Row[]; readonly fields: FieldDef[] }>((resolve, reject) => {
    cursor.read(count, (error, rows, result) => {
      // pg-cursor calls back with `null` on success even though its published
      // type currently says `undefined`.
      if (error) reject(error);
      else resolve({ rows, fields: result.fields });
    });
  });

/** Internal adapter entry point, exported so its transaction lifecycle can be tested without Postgres. */
export const runPostgresQuery = async (
  connectionString: string,
  sql: string,
  limit: number,
  signal?: AbortSignal,
): Promise<RawPowerhouseDatabaseQueryResult> => {
  const client = new Client({
    connectionString,
    application_name: "Vetra Powerhouse database inspector",
    connectionTimeoutMillis: STATEMENT_TIMEOUT_MILLIS,
    statement_timeout: STATEMENT_TIMEOUT_MILLIS,
    query_timeout: STATEMENT_TIMEOUT_MILLIS + 1_000,
  });
  let cursor: Cursor<unknown[]> | undefined;
  let connected = false;
  let ending: Promise<void> | undefined;
  const end = () => (ending ??= client.end());
  const onAbort = () => void end().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    await client.connect();
    connected = true;
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MILLIS}ms'`);
    await client.query("SELECT 1");
    cursor = client.query(new Cursor<unknown[]>(sql, [], { rowMode: "array" }));
    const result = await readCursor(cursor, limit + 1);
    return {
      columns: result.fields.map((field) => ({ name: field.name, dataTypeId: field.dataTypeID })),
      rows: result.rows,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (cursor !== undefined && !signal?.aborted) await cursor.close().catch(() => undefined);
    if (connected && !signal?.aborted) await client.query("ROLLBACK").catch(() => undefined);
    await end().catch(() => undefined);
  }
};

const OID_NAMES: Readonly<Record<number, string>> = {
  16: "boolean",
  17: "bytea",
  20: "bigint",
  21: "smallint",
  23: "integer",
  25: "text",
  26: "oid",
  700: "real",
  701: "double precision",
  1042: "character",
  1043: "character varying",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamp with time zone",
  1186: "interval",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};

const normalizeCell = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_, nested) =>
        typeof nested === "bigint" ? nested.toString() : nested,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const normalizeQueryResult = (
  raw: RawPowerhouseDatabaseQueryResult,
  rowLimit: PowerhouseDatabaseRowLimit,
  startedAt: number,
  target: PowerhouseDatabaseTargetId,
): PowerhouseDatabaseQueryResult => {
  const truncated = raw.rows.length > rowLimit;
  const result: PowerhouseDatabaseQueryResult = {
    columns: raw.columns.map((column) => ({
      name: column.name,
      dataType: OID_NAMES[column.dataTypeId] ?? `oid:${column.dataTypeId}`,
    })),
    rows: raw.rows.slice(0, rowLimit).map((row) => row.map(normalizeCell)),
    truncated,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    rowLimit,
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESPONSE_BYTES) {
    throw databaseError("response_too_large", target);
  }
  return result;
};

const stringCell = (row: ReadonlyArray<unknown>, index: number) =>
  row[index] === null || row[index] === undefined ? "" : String(row[index]);

const numberCell = (row: ReadonlyArray<unknown>, index: number) => {
  const parsed = Number(row[index]);
  return Number.isFinite(parsed) ? parsed : null;
};

const relationKind = (value: string): PowerhouseDatabaseRelationKind | null => {
  switch (value) {
    case "r":
      return "table";
    case "p":
      return "partitioned_table";
    case "v":
      return "view";
    case "m":
      return "materialized_view";
    case "f":
      return "foreign_table";
    default:
      return null;
  }
};

const systemSchema = (name: string) =>
  name === "pg_catalog" ||
  name === "information_schema" ||
  name.startsWith("pg_toast") ||
  name.startsWith("pg_temp");

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const catalogSql = (includeSystemSchemas: boolean) => `
SELECT n.nspname, c.relname, c.relkind, c.reltuples
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
${includeSystemSchemas ? "" : "  AND n.nspname <> 'pg_catalog' AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'"}
ORDER BY n.nspname, c.relname`;

const relationIdentitySql = (schema: string, relation: string) => `
SELECT c.relkind, CASE WHEN c.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(c.oid, true) ELSE NULL END
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = ${sqlLiteral(schema)} AND c.relname = ${sqlLiteral(relation)}
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`;

const relationColumnsSql = (schema: string, relation: string) => `
SELECT a.attname, a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod),
       NOT a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid), a.attgenerated <> ''
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = ${sqlLiteral(schema)} AND c.relname = ${sqlLiteral(relation)}
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`;

const relationIndexesSql = (schema: string, relation: string) => `
SELECT i.relname, x.indisunique, x.indisprimary, pg_catalog.pg_get_indexdef(i.oid)
FROM pg_catalog.pg_index AS x
JOIN pg_catalog.pg_class AS t ON t.oid = x.indrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
JOIN pg_catalog.pg_class AS i ON i.oid = x.indexrelid
WHERE n.nspname = ${sqlLiteral(schema)} AND t.relname = ${sqlLiteral(relation)}
ORDER BY i.relname`;

const relationConstraintsSql = (schema: string, relation: string) => `
SELECT x.conname, x.contype, pg_catalog.pg_get_constraintdef(x.oid, true)
FROM pg_catalog.pg_constraint AS x
JOIN pg_catalog.pg_class AS c ON c.oid = x.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = ${sqlLiteral(schema)} AND c.relname = ${sqlLiteral(relation)}
  AND x.contype IN ('c', 'f', 'p', 'u', 'x')
ORDER BY x.conname`;

const constraintType = (value: string) => {
  switch (value) {
    case "c":
      return "check" as const;
    case "f":
      return "foreign_key" as const;
    case "p":
      return "primary_key" as const;
    case "u":
      return "unique" as const;
    case "x":
      return "exclusion" as const;
    default:
      return null;
  }
};

const boundedDefinition = (definition: string) => definition.slice(0, MAX_DEFINITION_LENGTH);

const reconstructDefinition = (
  detail: Omit<PowerhouseDatabaseRelationDetail, "definition" | "definitionKind">,
) => {
  if (detail.kind === "view" || detail.kind === "materialized_view") return "";
  const entries = detail.columns.map((column) => {
    const nullable = column.nullable ? "" : " NOT NULL";
    const expression =
      column.defaultExpression === null
        ? ""
        : column.generated
          ? ` GENERATED ALWAYS AS (${column.defaultExpression}) STORED`
          : ` DEFAULT ${column.defaultExpression}`;
    return `  ${quotePowerhouseIdentifier(column.name)} ${column.dataType}${expression}${nullable}`;
  });
  entries.push(
    ...detail.constraints.map(
      (constraint) =>
        `  CONSTRAINT ${quotePowerhouseIdentifier(constraint.name)} ${constraint.definition}`,
    ),
  );
  return boundedDefinition(
    `CREATE TABLE ${quotePowerhouseIdentifier(detail.schema)}.${quotePowerhouseIdentifier(detail.name)} (\n${entries.join(",\n")}\n);`,
  );
};

class InspectorRuntime {
  readonly #sessions = new Map<string, CachedPgliteSession>();
  #sessionMutation: Promise<void> = Promise.resolve();
  #closing = false;

  async discover(projectDirectory: string): Promise<PowerhouseDatabaseDiscoverResult> {
    const projectEnvironment = await readProjectEnvironment(projectDirectory);
    const targets = await Promise.all(
      (["read_models", "reactor"] as const).map((id) =>
        resolveDatabaseTarget({ id, projectDirectory, projectEnvironment }),
      ),
    );
    return { targets: targets.map((target) => this.#targetWithLoadedSnapshot(target)) };
  }

  async catalog(
    projectDirectory: string,
    input: PowerhouseDatabaseCatalogInput,
    signal?: AbortSignal,
  ): Promise<PowerhouseDatabaseCatalogResult> {
    const target = await this.#readyTarget(projectDirectory, input.target);
    const raw = await this.#query(
      target,
      catalogSql(input.includeSystemSchemas ?? false),
      MAX_CATALOG_RELATIONS,
      signal,
    );
    if (raw.rows.length > MAX_CATALOG_RELATIONS) {
      throw databaseError("response_too_large", input.target);
    }
    const schemas = new Map<
      string,
      PowerhouseDatabaseSchemaSummary["relations"] extends ReadonlyArray<infer R> ? R[] : never
    >();
    for (const row of raw.rows) {
      const schema = stringCell(row, 0);
      const kind = relationKind(stringCell(row, 2));
      if (schema.length === 0 || kind === null) continue;
      const relations = schemas.get(schema) ?? [];
      const estimate = numberCell(row, 3);
      relations.push({
        schema,
        name: stringCell(row, 1),
        kind,
        estimatedRows: estimate === null || estimate < 0 ? null : estimate,
      });
      schemas.set(schema, relations);
    }
    return {
      target: this.#targetWithLoadedSnapshot(target),
      schemas: [...schemas.entries()].map(([name, relations]) => ({
        name,
        system: systemSchema(name),
        relations,
      })),
    };
  }

  async getRelation(
    projectDirectory: string,
    input: PowerhouseDatabaseGetRelationInput,
    signal?: AbortSignal,
  ): Promise<PowerhouseDatabaseGetRelationResult> {
    const target = await this.#readyTarget(projectDirectory, input.target);
    const [identity, columnsResult, indexesResult, constraintsResult] = await Promise.all([
      this.#query(target, relationIdentitySql(input.schema, input.relation), 1, signal),
      this.#query(
        target,
        relationColumnsSql(input.schema, input.relation),
        MAX_RELATION_PARTS,
        signal,
      ),
      this.#query(
        target,
        relationIndexesSql(input.schema, input.relation),
        MAX_RELATION_PARTS,
        signal,
      ),
      this.#query(
        target,
        relationConstraintsSql(input.schema, input.relation),
        MAX_RELATION_PARTS,
        signal,
      ),
    ]);
    const identityRow = identity.rows[0];
    const kind = identityRow === undefined ? null : relationKind(stringCell(identityRow, 0));
    if (identityRow === undefined || kind === null) {
      throw databaseError("relation_not_found", input.target);
    }
    if (
      columnsResult.rows.length > MAX_RELATION_PARTS ||
      indexesResult.rows.length > MAX_RELATION_PARTS ||
      constraintsResult.rows.length > MAX_RELATION_PARTS
    ) {
      throw databaseError("response_too_large", input.target);
    }
    const columns: PowerhouseDatabaseColumn[] = columnsResult.rows.map((row) => ({
      name: stringCell(row, 0),
      ordinal: Math.max(1, Number(row[1]) || 1),
      dataType: stringCell(row, 2),
      nullable: row[3] === true || row[3] === "true" || row[3] === "t",
      defaultExpression:
        row[4] === null || row[4] === undefined ? null : boundedDefinition(String(row[4])),
      generated: row[5] === true || row[5] === "true" || row[5] === "t",
    }));
    const indexes = indexesResult.rows.map((row) => ({
      name: stringCell(row, 0),
      unique: row[1] === true || row[1] === "true" || row[1] === "t",
      primary: row[2] === true || row[2] === "true" || row[2] === "t",
      definition: boundedDefinition(stringCell(row, 3)),
    }));
    const constraints = constraintsResult.rows.flatMap((row) => {
      const type = constraintType(stringCell(row, 1));
      return type === null
        ? []
        : [{ name: stringCell(row, 0), type, definition: boundedDefinition(stringCell(row, 2)) }];
    });
    const base = {
      schema: input.schema,
      name: input.relation,
      kind,
      columns,
      indexes,
      constraints,
    };
    const viewDefinition = stringCell(identityRow, 1);
    const detail: PowerhouseDatabaseRelationDetail =
      kind === "view" || kind === "materialized_view"
        ? {
            ...base,
            definition: boundedDefinition(viewDefinition),
            definitionKind: "exact",
          }
        : {
            ...base,
            definition: reconstructDefinition(base),
            definitionKind: "reconstructed",
          };
    return { target: this.#targetWithLoadedSnapshot(target), relation: detail };
  }

  async previewRelation(
    projectDirectory: string,
    input: PowerhouseDatabasePreviewRelationInput,
    signal?: AbortSignal,
  ): Promise<PowerhouseDatabasePreviewRelationResult> {
    const target = await this.#readyTarget(projectDirectory, input.target);
    const limit = input.limit ?? DEFAULT_ROW_LIMIT;
    const startedAt = performance.now();
    const sql = `SELECT * FROM ${quotePowerhouseIdentifier(input.schema)}.${quotePowerhouseIdentifier(input.relation)}`;
    const raw = await this.#query(target, sql, limit, signal, {
      relationMissingAsNotFound: true,
    });
    return {
      target: this.#targetWithLoadedSnapshot(target),
      result: normalizeQueryResult(raw, limit, startedAt, input.target),
    };
  }

  async executeQuery(
    projectDirectory: string,
    input: PowerhouseDatabaseExecuteQueryInput,
    signal?: AbortSignal,
  ): Promise<PowerhouseDatabaseExecuteQueryResult> {
    const target = await this.#readyTarget(projectDirectory, input.target);
    const sql = validatePowerhouseReadQuery(input.sql);
    const limit = input.limit ?? DEFAULT_ROW_LIMIT;
    const startedAt = performance.now();
    try {
      const raw = await this.#query(target, sql, limit, signal);
      return {
        target: this.#targetWithLoadedSnapshot(target),
        result: normalizeQueryResult(raw, limit, startedAt, input.target),
      };
    } catch (cause) {
      throw mapQueryError(cause, input.target, target);
    }
  }

  async refreshSnapshot(
    projectDirectory: string,
    targetId: PowerhouseDatabaseTargetId,
  ): Promise<PowerhouseDatabaseRefreshSnapshotResult> {
    await this.#evictMatching(projectDirectory, targetId);
    const target = await this.#readyTarget(projectDirectory, targetId);
    return { target: target.publicTarget };
  }

  async close(): Promise<void> {
    this.#closing = true;
    await this.#withSessionMutation(async () => {
      const sessions = [...this.#sessions.values()];
      this.#sessions.clear();
      await Promise.allSettled(sessions.map((session) => this.#closeSession(session)));
    });
  }

  async #readyTarget(
    projectDirectory: string,
    targetId: PowerhouseDatabaseTargetId,
  ): Promise<ResolvedDatabaseTarget> {
    const projectEnvironment = await readProjectEnvironment(projectDirectory);
    const target = await resolveDatabaseTarget({
      id: targetId,
      projectDirectory,
      projectEnvironment,
    });
    if (target.connection === null || target.publicTarget.status !== "ready") {
      const message = target.publicTarget.detail ?? undefined;
      throw databaseError(
        target.failure ?? "read_failed",
        targetId,
        message === undefined ? undefined : { message },
      );
    }
    return target;
  }

  async #query(
    target: ResolvedDatabaseTarget,
    sql: string,
    limit: number,
    signal?: AbortSignal,
    options?: { readonly relationMissingAsNotFound?: boolean },
  ): Promise<RawPowerhouseDatabaseQueryResult> {
    const connection = target.connection;
    if (connection === null)
      throw databaseError(target.failure ?? "read_failed", target.publicTarget.id);
    if (connection.backend === "postgres") {
      return runPostgresQuery(connection.connectionString, sql, limit, signal).catch((cause) => {
        if (options?.relationMissingAsNotFound === true && postgresErrorCode(cause) === "42P01") {
          throw databaseError("relation_not_found", target.publicTarget.id);
        }
        throw mapAdapterError(cause, target.publicTarget.id, [connection.connectionString]);
      });
    }
    const cached = await this.#acquirePgliteSession(target, connection.snapshotPath);
    let evictAfterQuery = false;
    try {
      return await cached.session.query(sql, limit, signal);
    } catch (cause) {
      evictAfterQuery = signal?.aborted === true;
      if (options?.relationMissingAsNotFound === true && postgresErrorCode(cause) === "42P01") {
        throw databaseError("relation_not_found", target.publicTarget.id);
      }
      throw mapAdapterError(cause, target.publicTarget.id, [
        target.projectDirectory,
        connection.snapshotPath,
      ]);
    } finally {
      await this.#releasePgliteSession(cached, evictAfterQuery);
    }
  }

  async #acquirePgliteSession(target: ResolvedDatabaseTarget, snapshotPath: string) {
    const key = `${target.projectDirectory}\0${target.publicTarget.id}\0${snapshotPath}`;
    return this.#withSessionMutation(async () => {
      if (this.#closing) {
        throw databaseError("read_failed", target.publicTarget.id, {
          message: "The database inspector is shutting down.",
        });
      }
      await this.#evictIdleWithoutLock();
      const cached =
        this.#sessions.get(key) ?? (await this.#openPgliteSession(target, snapshotPath, key));
      if (cached.idleTimer !== null) {
        NodeTimers.clearTimeout(cached.idleTimer);
        cached.idleTimer = null;
      }
      cached.activeRequests += 1;
      cached.lastUsedAt = performance.now();
      return cached;
    });
  }

  async #openPgliteSession(
    target: ResolvedDatabaseTarget,
    snapshotPath: string,
    key: string,
  ): Promise<CachedPgliteSession> {
    while (this.#sessions.size >= PGLITE_SESSION_LIMIT) {
      const oldest = [...this.#sessions.values()]
        .filter((session) => session.activeRequests === 0)
        .toSorted((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
      if (oldest === undefined) {
        throw databaseError("read_failed", target.publicTarget.id, {
          message: "Both PGlite inspection sessions are busy. Try again in a moment.",
        });
      }
      await this.#evictWithoutLock(oldest);
    }
    let restored: Awaited<ReturnType<typeof restorePowerhouseSnapshot>> | undefined;
    try {
      restored = await restorePowerhouseSnapshot(snapshotPath);
      const runtimeEntry = resolvePowerhousePgliteRuntime(
        target.projectDirectory,
        restored.postgresMajorVersion,
      );
      const session = await PowerhousePgliteSession.open({
        runtimeEntry,
        pgDataDirectory: restored.pgDataDirectory,
      });
      const cached: CachedPgliteSession = {
        key,
        projectDirectory: target.projectDirectory,
        target: target.publicTarget.id,
        snapshotPath,
        snapshotWrittenAtUtcIso: restored.snapshotWrittenAtUtcIso,
        restoredDirectory: restored.directory,
        session,
        lastUsedAt: performance.now(),
        activeRequests: 0,
        idleTimer: null,
      };
      this.#sessions.set(key, cached);
      return cached;
    } catch (cause) {
      if (restored !== undefined) {
        await removeRestoredPowerhouseSnapshot(restored.directory).catch(() => undefined);
      }
      if (cause instanceof PowerhouseSnapshotDecodeError) {
        throw databaseError(
          cause.reason === "too_large" ? "snapshot_too_large" : "decode_failed",
          target.publicTarget.id,
        );
      }
      if (
        isNodeErrorCode(cause, "MODULE_NOT_FOUND") ||
        isNodeErrorCode(cause, "ERR_MODULE_NOT_FOUND") ||
        isNodeErrorCode(cause, "ERR_PACKAGE_PATH_NOT_EXPORTED")
      ) {
        throw databaseError("runtime_missing", target.publicTarget.id);
      }
      throw mapAdapterError(cause, target.publicTarget.id, [target.projectDirectory, snapshotPath]);
    }
  }

  #targetWithLoadedSnapshot(target: ResolvedDatabaseTarget): PowerhouseDatabaseTarget {
    if (target.connection?.backend !== "pglite_snapshot") return target.publicTarget;
    const key = `${target.projectDirectory}\0${target.publicTarget.id}\0${target.connection.snapshotPath}`;
    const cached = this.#sessions.get(key);
    return cached === undefined
      ? target.publicTarget
      : { ...target.publicTarget, snapshotWrittenAtUtcIso: cached.snapshotWrittenAtUtcIso };
  }

  async #evictMatching(projectDirectory: string, target: PowerhouseDatabaseTargetId) {
    await this.#withSessionMutation(async () => {
      const matches = [...this.#sessions.values()].filter(
        (session) => session.projectDirectory === projectDirectory && session.target === target,
      );
      await Promise.all(matches.map((session) => this.#evictWithoutLock(session)));
    });
  }

  async #evictIdleWithoutLock() {
    const cutoff = performance.now() - PGLITE_IDLE_MILLIS;
    const idle = [...this.#sessions.values()].filter(
      (session) => session.activeRequests === 0 && session.lastUsedAt < cutoff,
    );
    await Promise.all(idle.map((session) => this.#evictWithoutLock(session)));
  }

  async #releasePgliteSession(cached: CachedPgliteSession, evict: boolean) {
    await this.#withSessionMutation(async () => {
      cached.activeRequests = Math.max(0, cached.activeRequests - 1);
      cached.lastUsedAt = performance.now();
      if (evict && this.#sessions.get(cached.key) === cached) {
        await this.#evictWithoutLock(cached);
      } else if (cached.activeRequests === 0 && this.#sessions.get(cached.key) === cached) {
        this.#scheduleIdleEvictionWithoutLock(cached);
      }
    });
  }

  async #evictWithoutLock(cached: CachedPgliteSession) {
    if (cached.idleTimer !== null) {
      NodeTimers.clearTimeout(cached.idleTimer);
      cached.idleTimer = null;
    }
    if (this.#sessions.get(cached.key) === cached) this.#sessions.delete(cached.key);
    await this.#closeSession(cached);
  }

  #scheduleIdleEvictionWithoutLock(cached: CachedPgliteSession) {
    if (cached.idleTimer !== null) NodeTimers.clearTimeout(cached.idleTimer);
    cached.idleTimer = NodeTimers.setTimeout(() => {
      cached.idleTimer = null;
      void this.#withSessionMutation(async () => {
        if (
          this.#sessions.get(cached.key) === cached &&
          cached.activeRequests === 0 &&
          performance.now() - cached.lastUsedAt >= PGLITE_IDLE_MILLIS
        ) {
          await this.#evictWithoutLock(cached);
        }
      }).catch(() => undefined);
    }, PGLITE_IDLE_MILLIS);
    cached.idleTimer.unref();
  }

  #withSessionMutation<A>(operation: () => Promise<A>): Promise<A> {
    const result = this.#sessionMutation.then(operation);
    this.#sessionMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #closeSession(cached: CachedPgliteSession) {
    if (cached.idleTimer !== null) {
      NodeTimers.clearTimeout(cached.idleTimer);
      cached.idleTimer = null;
    }
    await cached.session.close().catch(() => undefined);
    await removeRestoredPowerhouseSnapshot(cached.restoredDirectory).catch(() => undefined);
  }
}

const postgresErrorCode = (cause: unknown) => {
  if (cause instanceof PowerhousePgliteWorkerError) return cause.code;
  return typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
    ? cause.code
    : undefined;
};

const mapAdapterError = (
  cause: unknown,
  target: PowerhouseDatabaseTargetId,
  secrets: string[],
): PowerhouseDatabaseError => {
  if (isPowerhouseDatabaseError(cause)) return cause;
  const code = postgresErrorCode(cause);
  if (code === "57014") return databaseError("timeout", target);
  if (code === "VETRA_RESPONSE_TOO_LARGE") {
    return databaseError("response_too_large", target);
  }
  const failure =
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ECONNRESET"
      ? "unreachable"
      : "read_failed";
  return databaseError(failure, target, {
    message: safeErrorMessage(cause, secrets),
    secrets,
  });
};

const mapQueryError = (
  cause: unknown,
  targetId: PowerhouseDatabaseTargetId,
  target: ResolvedDatabaseTarget,
) => {
  if (isPowerhouseDatabaseError(cause)) {
    if (cause.failure !== "read_failed") return cause;
    const secrets =
      target.connection?.backend === "postgres"
        ? [target.connection.connectionString]
        : target.connection?.backend === "pglite_snapshot"
          ? [target.projectDirectory, target.connection.snapshotPath]
          : [];
    return databaseError("query_rejected", targetId, {
      message: cause.message,
      secrets,
    });
  }
  if (cause instanceof PowerhouseSqlRejectedError) {
    return databaseError("query_rejected", targetId, { message: cause.message });
  }
  return mapAdapterError(cause, targetId, []);
};

const mapUnexpectedDatabaseError = (
  cause: unknown,
  target?: PowerhouseDatabaseTargetId,
): PowerhouseDatabaseError => {
  if (isPowerhouseDatabaseError(cause)) return cause;
  if (cause instanceof PowerhouseSqlRejectedError) {
    return new PowerhouseDatabaseError({
      failure: "query_rejected",
      ...(target === undefined ? {} : { target }),
      message: cause.message,
    });
  }
  return new PowerhouseDatabaseError({
    failure: "read_failed",
    ...(target === undefined ? {} : { target }),
  });
};

export const make = Effect.gen(function* () {
  const project = yield* PowerhouseProject.PowerhouseProject;
  const runtime = new InspectorRuntime();
  yield* Effect.addFinalizer(() => Effect.promise(() => runtime.close()));

  const withProject = <A>(
    input: ProjectDatabaseRef,
    target: PowerhouseDatabaseTargetId | undefined,
    operation: (projectDirectory: string, signal: AbortSignal) => Promise<A>,
  ) =>
    Effect.gen(function* () {
      const projectDirectory = yield* project.resolveProjectDirectory(input);
      return yield* Effect.tryPromise({
        try: (signal) => operation(projectDirectory, signal),
        catch: (cause) => mapUnexpectedDatabaseError(cause, target),
      });
    });

  return PowerhouseDatabaseInspector.of({
    discover: (input) =>
      withProject(input, undefined, (projectDirectory) => runtime.discover(projectDirectory)),
    catalog: (input) =>
      withProject(input, input.target, (projectDirectory, signal) =>
        runtime.catalog(projectDirectory, input, signal),
      ),
    getRelation: (input) =>
      withProject(input, input.target, (projectDirectory, signal) =>
        runtime.getRelation(projectDirectory, input, signal),
      ),
    previewRelation: (input) =>
      withProject(input, input.target, (projectDirectory, signal) =>
        runtime.previewRelation(projectDirectory, input, signal),
      ),
    executeQuery: (input) =>
      withProject(input, input.target, (projectDirectory, signal) =>
        runtime.executeQuery(projectDirectory, input, signal),
      ),
    refreshSnapshot: (input) =>
      withProject(input, input.target, (projectDirectory) =>
        runtime.refreshSnapshot(projectDirectory, input.target),
      ),
  });
});

export const layer = Layer.effect(PowerhouseDatabaseInspector, make);
