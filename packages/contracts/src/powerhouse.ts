/**
 * Powerhouse panel contracts.
 *
 * Two independent read-only surfaces share this module: document models parsed
 * from a project's working tree, and reactor data the Vetra server fetches over
 * GraphQL on the client's behalf (browsers on a remote/relay connection cannot
 * reach the reactor's loopback port themselves).
 *
 * Everything the panel puts on the wire lives here so the whole surface can be
 * lifted out in one deletion — see `docs/internals/powerhouse-panel.md`.
 */
import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";

import { NonNegativeInt, PortSchema, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const POWERHOUSE_PATH_MAX_LENGTH = 512;
const POWERHOUSE_URL_MAX_LENGTH = 2048;
const POWERHOUSE_DIRECTORY_NAME_MAX_LENGTH = 255;
export const POWERHOUSE_REACTOR_ID_MAX_LENGTH = 2048;
const POWERHOUSE_REACTOR_CURSOR_MAX_LENGTH = 8192;
const POWERHOUSE_REACTOR_LABEL_MAX_LENGTH = 4096;
export const POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH = 1024;
const POWERHOUSE_TIMESTAMP_MAX_LENGTH = 128;
export const POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH = 8192;
const POWERHOUSE_REACTOR_METADATA_MAX_LENGTH = 4096;
export const POWERHOUSE_DATABASE_SQL_MAX_LENGTH = 64 * 1024;
export const POWERHOUSE_DATABASE_ROW_LIMITS = [50, 100, 200] as const;
const POWERHOUSE_DATABASE_IDENTIFIER_MAX_LENGTH = 255;
const POWERHOUSE_DATABASE_TYPE_MAX_LENGTH = 1024;
const POWERHOUSE_DATABASE_DEFINITION_MAX_LENGTH = 256 * 1024;
const POWERHOUSE_DATABASE_MESSAGE_MAX_LENGTH = 4096;

/** Bounds list-valued Switchboard filters before they cross the websocket. */
export const POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT = 100;

export const POWERHOUSE_MODEL_SUMMARY_ID_MAX_LENGTH = 512;
export const POWERHOUSE_MODEL_SUMMARY_NAME_MAX_LENGTH = 256;
export const POWERHOUSE_MODEL_SUMMARY_EXTENSION_MAX_LENGTH = 128;
export const POWERHOUSE_MODEL_SUMMARY_DESCRIPTION_MAX_LENGTH = 1024;

const PowerhouseConfiguredPath = Schema.String.check(
  Schema.isMaxLength(POWERHOUSE_PATH_MAX_LENGTH),
);

/** Marker file that makes a workspace a Powerhouse project. */
export const POWERHOUSE_CONFIG_FILE_NAME = "powerhouse.config.json";
/** `documentModelsDir` when the config omits it, matching Powerhouse's own default. */
export const POWERHOUSE_DEFAULT_DOCUMENT_MODELS_DIR = "./document-models";
/** Reactor port used by the `ph` CLI and the `ph init` scaffold. */
export const POWERHOUSE_DEFAULT_REACTOR_PORT = 4001;
/** Reactor port used when reactor-api is embedded as a library rather than run by the CLI. */
export const POWERHOUSE_FALLBACK_REACTOR_PORT = 4000;

/**
 * The parts of `powerhouse.config.json` this panel reads. The file itself
 * carries much more (editors, processors, auth, connect runtime options) and is
 * fully optional — `{}` is a valid config — so anything unread is ignored.
 */
export const PowerhouseProjectConfig = Schema.Struct({
  documentModelsDir: Schema.optional(PowerhouseConfiguredPath),
  reactorPort: Schema.optional(PortSchema),
});
export type PowerhouseProjectConfig = typeof PowerhouseProjectConfig.Type;

export type PowerhouseConfigParseResult =
  | { readonly status: "valid"; readonly config: PowerhouseProjectConfig }
  /** Present but not parseable as JSON. Still a Powerhouse project; defaults apply. */
  | { readonly status: "invalid" }
  /** Connect ships a same-named runtime config. It carries `schemaVersion`; a project config never does. */
  | { readonly status: "runtime-config" };

/**
 * Read the fields the panel needs out of a `powerhouse.config.json` body.
 *
 * Deliberately lenient in the same way Powerhouse's own `getConfig` is: fields
 * of the wrong type are dropped rather than rejected, because real projects
 * ship configs that violate the published schema.
 */
export function parsePowerhouseConfig(text: string): PowerhouseConfigParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "invalid" };
  }
  if (!Predicate.isObject(parsed)) {
    return { status: "invalid" };
  }
  if ("schemaVersion" in parsed) {
    return { status: "runtime-config" };
  }
  const documentModelsDir =
    typeof parsed.documentModelsDir === "string" &&
    parsed.documentModelsDir.trim().length > 0 &&
    parsed.documentModelsDir.length <= POWERHOUSE_PATH_MAX_LENGTH
      ? parsed.documentModelsDir
      : undefined;
  const reactor = Predicate.isObject(parsed.reactor) ? parsed.reactor : undefined;
  const reactorPort =
    typeof reactor?.port === "number" &&
    Number.isInteger(reactor.port) &&
    reactor.port >= 1 &&
    reactor.port <= 65535
      ? reactor.port
      : undefined;
  return {
    status: "valid",
    config: {
      ...(documentModelsDir === undefined ? {} : { documentModelsDir }),
      ...(reactorPort === undefined ? {} : { reactorPort }),
    },
  };
}

// ---------------------------------------------------------------------------
// Project discovery
// ---------------------------------------------------------------------------

const PowerhouseCwd = TrimmedNonEmptyString.check(Schema.isMaxLength(POWERHOUSE_PATH_MAX_LENGTH));

/**
 * Workspace-relative path of a Powerhouse project. Empty when the workspace root
 * is itself the project; otherwise a POSIX-separated path such as `apps/connect`.
 */
export const PowerhouseProjectPath = Schema.String.check(
  Schema.isMaxLength(POWERHOUSE_PATH_MAX_LENGTH),
);

export const PowerhouseProjectLocation = Schema.Struct({
  path: PowerhouseProjectPath,
  /** Last path segment, or the workspace's own name for a root project. */
  name: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DIRECTORY_NAME_MAX_LENGTH)),
  /** As configured, defaulted when the config omits it. */
  documentModelsDir: PowerhouseConfiguredPath,
  reactorPort: Schema.NullOr(PortSchema),
  /**
   * False when the config exists but is not readable JSON. Still a Powerhouse
   * project — defaults apply — and the panel says so.
   */
  configValid: Schema.Boolean,
});
export type PowerhouseProjectLocation = typeof PowerhouseProjectLocation.Type;

export const PowerhouseListProjectsInput = Schema.Struct({
  cwd: PowerhouseCwd,
});
export type PowerhouseListProjectsInput = typeof PowerhouseListProjectsInput.Type;

/**
 * Every Powerhouse project in the workspace. Empty for workspaces that have
 * none, which is not an error — it is how the panel knows to stay hidden.
 */
export const PowerhouseListProjectsResult = Schema.Struct({
  projects: Schema.Array(PowerhouseProjectLocation),
});
export type PowerhouseListProjectsResult = typeof PowerhouseListProjectsResult.Type;

// ---------------------------------------------------------------------------
// Document models (from disk)
// ---------------------------------------------------------------------------

const PowerhouseDirectoryName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(POWERHOUSE_DIRECTORY_NAME_MAX_LENGTH),
);

/**
 * Per-model list entry. Counts describe the newest specification, since that is
 * what the list row summarizes; older specifications stay reachable in detail.
 */
export const PowerhouseDocumentModelSummary = Schema.Struct({
  /** Directory under `documentModelsDir`; the stable key for `getDocumentModel`. */
  directoryName: PowerhouseDirectoryName,
  id: Schema.String.check(Schema.isMaxLength(POWERHOUSE_MODEL_SUMMARY_ID_MAX_LENGTH)),
  name: Schema.String.check(Schema.isMaxLength(POWERHOUSE_MODEL_SUMMARY_NAME_MAX_LENGTH)),
  extension: Schema.String.check(Schema.isMaxLength(POWERHOUSE_MODEL_SUMMARY_EXTENSION_MAX_LENGTH)),
  description: Schema.String.check(
    Schema.isMaxLength(POWERHOUSE_MODEL_SUMMARY_DESCRIPTION_MAX_LENGTH),
  ),
  specCount: NonNegativeInt,
  latestVersion: Schema.NullOr(Schema.Int),
  moduleCount: NonNegativeInt,
  operationCount: NonNegativeInt,
});
export type PowerhouseDocumentModelSummary = typeof PowerhouseDocumentModelSummary.Type;

export const PowerhouseDocumentModelFailureReason = Schema.Literals([
  "missing_json",
  "invalid_json",
  "invalid_shape",
  "read_failed",
  "too_large",
]);
export type PowerhouseDocumentModelFailureReason = typeof PowerhouseDocumentModelFailureReason.Type;

/**
 * A model directory that could not be read. Reported alongside the models that
 * did load so one broken file does not blank the list.
 */
export const PowerhouseDocumentModelFailure = Schema.Struct({
  directoryName: PowerhouseDirectoryName,
  reason: PowerhouseDocumentModelFailureReason,
});
export type PowerhouseDocumentModelFailure = typeof PowerhouseDocumentModelFailure.Type;

export const PowerhouseListDocumentModelsInput = Schema.Struct({
  cwd: PowerhouseCwd,
  /** Which project in the workspace; absent or empty means the workspace root. */
  projectPath: Schema.optional(PowerhouseProjectPath),
});
export type PowerhouseListDocumentModelsInput = typeof PowerhouseListDocumentModelsInput.Type;

export const PowerhouseListDocumentModelsResult = Schema.Struct({
  /** As configured, so the panel can name the directory it scanned. */
  documentModelsDir: PowerhouseConfiguredPath,
  models: Schema.Array(PowerhouseDocumentModelSummary),
  failures: Schema.Array(PowerhouseDocumentModelFailure),
  /** More model directories existed than the bounded listing inspected. */
  truncated: Schema.Boolean,
});
export type PowerhouseListDocumentModelsResult = typeof PowerhouseListDocumentModelsResult.Type;

export const PowerhouseGetDocumentModelInput = Schema.Struct({
  cwd: PowerhouseCwd,
  projectPath: Schema.optional(PowerhouseProjectPath),
  directoryName: PowerhouseDirectoryName,
});
export type PowerhouseGetDocumentModelInput = typeof PowerhouseGetDocumentModelInput.Type;

export const PowerhouseDocumentModelOperation = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** GraphQL SDL for the operation's input type. */
  schema: Schema.NullOr(Schema.String),
  scope: Schema.NullOr(Schema.String),
});
export type PowerhouseDocumentModelOperation = typeof PowerhouseDocumentModelOperation.Type;

export const PowerhouseDocumentModelModule = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  operations: Schema.Array(PowerhouseDocumentModelOperation),
});
export type PowerhouseDocumentModelModule = typeof PowerhouseDocumentModelModule.Type;

/**
 * One version of a model. Powerhouse stores versions as repeated entries in a
 * single file's `specifications` array rather than as separate files.
 */
export const PowerhouseDocumentModelSpecification = Schema.Struct({
  version: Schema.NullOr(Schema.Int),
  changeLog: Schema.Array(Schema.String),
  /** GraphQL SDL for global state. Empty when the model declares none. */
  globalSchema: Schema.String,
  /** GraphQL SDL for local state. Commonly empty. */
  localSchema: Schema.String,
  modules: Schema.Array(PowerhouseDocumentModelModule),
});
export type PowerhouseDocumentModelSpecification = typeof PowerhouseDocumentModelSpecification.Type;

export const PowerhouseDocumentModelAuthor = Schema.Struct({
  name: Schema.String,
  website: Schema.NullOr(Schema.String),
});
export type PowerhouseDocumentModelAuthor = typeof PowerhouseDocumentModelAuthor.Type;

export const PowerhouseDocumentModel = Schema.Struct({
  directoryName: PowerhouseDirectoryName,
  id: Schema.String,
  name: Schema.String,
  extension: Schema.String,
  description: Schema.String,
  author: Schema.NullOr(PowerhouseDocumentModelAuthor),
  specifications: Schema.Array(PowerhouseDocumentModelSpecification),
});
export type PowerhouseDocumentModel = typeof PowerhouseDocumentModel.Type;

export const PowerhouseProjectFailure = Schema.Literals([
  "not_a_powerhouse_project",
  "invalid_project_path",
  "models_dir_missing",
  "invalid_model_name",
  "model_not_found",
  "read_failed",
]);
export type PowerhouseProjectFailure = typeof PowerhouseProjectFailure.Type;

const POWERHOUSE_PROJECT_FAILURE_MESSAGES: Record<PowerhouseProjectFailure, string> = {
  not_a_powerhouse_project: `No ${POWERHOUSE_CONFIG_FILE_NAME} at the project root.`,
  invalid_project_path: "The requested project is not inside this workspace.",
  models_dir_missing: "The configured document models directory does not exist.",
  invalid_model_name: "The requested document model name is not a valid directory name.",
  model_not_found: "No document model with that name.",
  read_failed: "Failed to read document models from disk.",
};

export class PowerhouseProjectError extends Schema.TaggedErrorClass<PowerhouseProjectError>()(
  "PowerhouseProjectError",
  {
    failure: PowerhouseProjectFailure,
    cwd: Schema.optional(TrimmedNonEmptyString),
    /** Set for the failures that name one: `models_dir_missing`, `model_not_found`. */
    detail: Schema.optional(Schema.String),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly failure: PowerhouseProjectFailure;
    readonly cwd?: string | undefined;
    readonly detail?: string | undefined;
    readonly cause?: unknown;
    /** Supplied by schema decoding so a wire-safe message survives a round trip. */
    readonly message?: string | undefined;
  }) {
    super({
      ...props,
      message: props.message ?? POWERHOUSE_PROJECT_FAILURE_MESSAGES[props.failure],
    });
  }
}

// ---------------------------------------------------------------------------
// Database inspector (server-side PGlite snapshots or live local Postgres)
// ---------------------------------------------------------------------------

export const PowerhouseDatabaseTargetId = Schema.Literals(["read_models", "reactor"]);
export type PowerhouseDatabaseTargetId = typeof PowerhouseDatabaseTargetId.Type;

export const PowerhouseDatabaseBackend = Schema.Literals(["pglite_snapshot", "postgres"]);
export type PowerhouseDatabaseBackend = typeof PowerhouseDatabaseBackend.Type;

export const PowerhouseDatabaseTargetStatus = Schema.Literals([
  "ready",
  "missing",
  "unsupported",
  "unreachable",
]);
export type PowerhouseDatabaseTargetStatus = typeof PowerhouseDatabaseTargetStatus.Type;

export const PowerhouseDatabaseTargetSource = Schema.Literals([
  "default",
  "project_env",
  "server_env",
]);
export type PowerhouseDatabaseTargetSource = typeof PowerhouseDatabaseTargetSource.Type;

const PowerhouseDatabaseIdentifier = TrimmedNonEmptyString.check(
  Schema.isMaxLength(POWERHOUSE_DATABASE_IDENTIFIER_MAX_LENGTH),
);

const PowerhouseDatabaseBaseInput = Schema.Struct({
  cwd: PowerhouseCwd,
  projectPath: Schema.optional(PowerhouseProjectPath),
  target: PowerhouseDatabaseTargetId,
});

export const PowerhouseDatabaseDiscoverInput = Schema.Struct({
  cwd: PowerhouseCwd,
  projectPath: Schema.optional(PowerhouseProjectPath),
});
export type PowerhouseDatabaseDiscoverInput = typeof PowerhouseDatabaseDiscoverInput.Type;

export const PowerhouseDatabaseTarget = Schema.Struct({
  id: PowerhouseDatabaseTargetId,
  label: TrimmedNonEmptyString,
  backend: PowerhouseDatabaseBackend,
  status: PowerhouseDatabaseTargetStatus,
  source: PowerhouseDatabaseTargetSource,
  /** File mtime for PGlite. Null for Postgres and missing snapshots. */
  snapshotWrittenAtUtcIso: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_TIMESTAMP_MAX_LENGTH)),
  ),
  /** Actionable, credential-free status detail for non-ready targets. */
  detail: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_MESSAGE_MAX_LENGTH)),
  ),
});
export type PowerhouseDatabaseTarget = typeof PowerhouseDatabaseTarget.Type;

export const PowerhouseDatabaseDiscoverResult = Schema.Struct({
  targets: Schema.Array(PowerhouseDatabaseTarget),
});
export type PowerhouseDatabaseDiscoverResult = typeof PowerhouseDatabaseDiscoverResult.Type;

export const PowerhouseDatabaseRelationKind = Schema.Literals([
  "table",
  "partitioned_table",
  "view",
  "materialized_view",
  "foreign_table",
]);
export type PowerhouseDatabaseRelationKind = typeof PowerhouseDatabaseRelationKind.Type;

export const PowerhouseDatabaseRelationSummary = Schema.Struct({
  schema: PowerhouseDatabaseIdentifier,
  name: PowerhouseDatabaseIdentifier,
  kind: PowerhouseDatabaseRelationKind,
  estimatedRows: Schema.NullOr(Schema.Number),
});
export type PowerhouseDatabaseRelationSummary = typeof PowerhouseDatabaseRelationSummary.Type;

export const PowerhouseDatabaseSchemaSummary = Schema.Struct({
  name: PowerhouseDatabaseIdentifier,
  system: Schema.Boolean,
  relations: Schema.Array(PowerhouseDatabaseRelationSummary),
});
export type PowerhouseDatabaseSchemaSummary = typeof PowerhouseDatabaseSchemaSummary.Type;

export const PowerhouseDatabaseCatalogInput = Schema.Struct({
  ...PowerhouseDatabaseBaseInput.fields,
  includeSystemSchemas: Schema.optional(Schema.Boolean),
});
export type PowerhouseDatabaseCatalogInput = typeof PowerhouseDatabaseCatalogInput.Type;

export const PowerhouseDatabaseCatalogResult = Schema.Struct({
  target: PowerhouseDatabaseTarget,
  schemas: Schema.Array(PowerhouseDatabaseSchemaSummary),
});
export type PowerhouseDatabaseCatalogResult = typeof PowerhouseDatabaseCatalogResult.Type;

const PowerhouseDatabaseRelationInputFields = {
  ...PowerhouseDatabaseBaseInput.fields,
  schema: PowerhouseDatabaseIdentifier,
  relation: PowerhouseDatabaseIdentifier,
};

export const PowerhouseDatabaseGetRelationInput = Schema.Struct(
  PowerhouseDatabaseRelationInputFields,
);
export type PowerhouseDatabaseGetRelationInput = typeof PowerhouseDatabaseGetRelationInput.Type;

export const PowerhouseDatabaseColumn = Schema.Struct({
  name: PowerhouseDatabaseIdentifier,
  ordinal: PositiveInt,
  dataType: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_TYPE_MAX_LENGTH)),
  nullable: Schema.Boolean,
  defaultExpression: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_DEFINITION_MAX_LENGTH)),
  ),
  generated: Schema.Boolean,
});
export type PowerhouseDatabaseColumn = typeof PowerhouseDatabaseColumn.Type;

export const PowerhouseDatabaseIndex = Schema.Struct({
  name: PowerhouseDatabaseIdentifier,
  unique: Schema.Boolean,
  primary: Schema.Boolean,
  definition: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_DEFINITION_MAX_LENGTH)),
});
export type PowerhouseDatabaseIndex = typeof PowerhouseDatabaseIndex.Type;

export const PowerhouseDatabaseConstraint = Schema.Struct({
  name: PowerhouseDatabaseIdentifier,
  type: Schema.Literals(["check", "foreign_key", "primary_key", "unique", "exclusion"]),
  definition: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_DEFINITION_MAX_LENGTH)),
});
export type PowerhouseDatabaseConstraint = typeof PowerhouseDatabaseConstraint.Type;

export const PowerhouseDatabaseRelationDetail = Schema.Struct({
  schema: PowerhouseDatabaseIdentifier,
  name: PowerhouseDatabaseIdentifier,
  kind: PowerhouseDatabaseRelationKind,
  columns: Schema.Array(PowerhouseDatabaseColumn),
  indexes: Schema.Array(PowerhouseDatabaseIndex),
  constraints: Schema.Array(PowerhouseDatabaseConstraint),
  definition: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_DEFINITION_MAX_LENGTH)),
  definitionKind: Schema.Literals(["exact", "reconstructed"]),
});
export type PowerhouseDatabaseRelationDetail = typeof PowerhouseDatabaseRelationDetail.Type;

export const PowerhouseDatabaseGetRelationResult = Schema.Struct({
  target: PowerhouseDatabaseTarget,
  relation: PowerhouseDatabaseRelationDetail,
});
export type PowerhouseDatabaseGetRelationResult = typeof PowerhouseDatabaseGetRelationResult.Type;

export const PowerhouseDatabaseRowLimit = Schema.Literals(POWERHOUSE_DATABASE_ROW_LIMITS);
export type PowerhouseDatabaseRowLimit = typeof PowerhouseDatabaseRowLimit.Type;

export const PowerhouseDatabasePreviewRelationInput = Schema.Struct({
  ...PowerhouseDatabaseRelationInputFields,
  limit: Schema.optional(PowerhouseDatabaseRowLimit),
});
export type PowerhouseDatabasePreviewRelationInput =
  typeof PowerhouseDatabasePreviewRelationInput.Type;

export const PowerhouseDatabaseQueryColumn = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_IDENTIFIER_MAX_LENGTH)),
  dataType: Schema.String.check(Schema.isMaxLength(POWERHOUSE_DATABASE_TYPE_MAX_LENGTH)),
});
export type PowerhouseDatabaseQueryColumn = typeof PowerhouseDatabaseQueryColumn.Type;

export const PowerhouseDatabaseQueryResult = Schema.Struct({
  columns: Schema.Array(PowerhouseDatabaseQueryColumn),
  rows: Schema.Array(Schema.Array(Schema.NullOr(Schema.String))).check(
    Schema.isMaxLength(POWERHOUSE_DATABASE_ROW_LIMITS.at(-1) ?? 200),
  ),
  truncated: Schema.Boolean,
  elapsedMs: NonNegativeInt,
  rowLimit: PowerhouseDatabaseRowLimit,
});
export type PowerhouseDatabaseQueryResult = typeof PowerhouseDatabaseQueryResult.Type;

export const PowerhouseDatabasePreviewRelationResult = Schema.Struct({
  target: PowerhouseDatabaseTarget,
  result: PowerhouseDatabaseQueryResult,
});
export type PowerhouseDatabasePreviewRelationResult =
  typeof PowerhouseDatabasePreviewRelationResult.Type;

export const PowerhouseDatabaseExecuteQueryInput = Schema.Struct({
  ...PowerhouseDatabaseBaseInput.fields,
  sql: TrimmedNonEmptyString.check(Schema.isMaxLength(POWERHOUSE_DATABASE_SQL_MAX_LENGTH)),
  limit: Schema.optional(PowerhouseDatabaseRowLimit),
});
export type PowerhouseDatabaseExecuteQueryInput = typeof PowerhouseDatabaseExecuteQueryInput.Type;

export const PowerhouseDatabaseExecuteQueryResult = Schema.Struct({
  target: PowerhouseDatabaseTarget,
  result: PowerhouseDatabaseQueryResult,
});
export type PowerhouseDatabaseExecuteQueryResult = typeof PowerhouseDatabaseExecuteQueryResult.Type;

export const PowerhouseDatabaseRefreshSnapshotInput = PowerhouseDatabaseBaseInput;
export type PowerhouseDatabaseRefreshSnapshotInput =
  typeof PowerhouseDatabaseRefreshSnapshotInput.Type;

export const PowerhouseDatabaseRefreshSnapshotResult = Schema.Struct({
  target: PowerhouseDatabaseTarget,
});
export type PowerhouseDatabaseRefreshSnapshotResult =
  typeof PowerhouseDatabaseRefreshSnapshotResult.Type;

export const PowerhouseDatabaseFailure = Schema.Literals([
  "missing",
  "unsupported_backend",
  "snapshot_too_large",
  "runtime_missing",
  "unreachable",
  "timeout",
  "query_rejected",
  "relation_not_found",
  "decode_failed",
  "response_too_large",
  "read_failed",
]);
export type PowerhouseDatabaseFailure = typeof PowerhouseDatabaseFailure.Type;

const POWERHOUSE_DATABASE_FAILURE_MESSAGES: Record<PowerhouseDatabaseFailure, string> = {
  missing: "The Powerhouse database has not been created yet.",
  unsupported_backend: "This Powerhouse database configuration is not supported.",
  snapshot_too_large: "The Powerhouse PGlite snapshot is too large to inspect safely.",
  runtime_missing: "The matching Powerhouse PGlite runtime is not installed.",
  unreachable: "The Powerhouse database could not be reached.",
  timeout: "The database query exceeded the time limit.",
  query_rejected: "Only one read-only row-producing SQL statement is allowed.",
  relation_not_found: "The requested database relation no longer exists.",
  decode_failed: "The Powerhouse PGlite snapshot could not be decoded.",
  response_too_large: "The database result exceeded the transfer limit.",
  read_failed: "The Powerhouse database could not be inspected.",
};

export class PowerhouseDatabaseError extends Schema.TaggedErrorClass<PowerhouseDatabaseError>()(
  "PowerhouseDatabaseError",
  {
    failure: PowerhouseDatabaseFailure,
    target: Schema.optional(PowerhouseDatabaseTargetId),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly failure: PowerhouseDatabaseFailure;
    readonly target?: PowerhouseDatabaseTargetId | undefined;
    readonly cause?: unknown;
    readonly message?: string | undefined;
  }) {
    super({
      ...props,
      message: props.message ?? POWERHOUSE_DATABASE_FAILURE_MESSAGES[props.failure],
    });
  }
}

// ---------------------------------------------------------------------------
// Reactor (over GraphQL, proxied by the server)
// ---------------------------------------------------------------------------

/**
 * Base URL of a reactor, without a path. The server appends `/graphql` itself
 * and only ever sends its own fixed queries, so this cannot be steered into a
 * general-purpose HTTP proxy.
 */
export const PowerhouseReactorUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(POWERHOUSE_URL_MAX_LENGTH),
);

export const PowerhouseReactorProbeInput = Schema.Struct({
  cwd: PowerhouseCwd,
  projectPath: Schema.optional(PowerhouseProjectPath),
  /** When set, the only candidate tried: an explicit override never silently falls back. */
  overrideUrl: Schema.optional(PowerhouseReactorUrl),
});
export type PowerhouseReactorProbeInput = typeof PowerhouseReactorProbeInput.Type;

/** Answer to `{ system { version gitHash gitUrl } }` — the reactor's fingerprint. */
export const PowerhouseReactorSystemInfo = Schema.Struct({
  version: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_METADATA_MAX_LENGTH)),
  ),
  gitHash: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_METADATA_MAX_LENGTH)),
  ),
  gitUrl: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_METADATA_MAX_LENGTH)),
  ),
});
export type PowerhouseReactorSystemInfo = typeof PowerhouseReactorSystemInfo.Type;

export const PowerhouseReactorConnection = Schema.Struct({
  url: PowerhouseReactorUrl,
  source: Schema.Literals(["override", "config", "default"]),
  system: PowerhouseReactorSystemInfo,
});
export type PowerhouseReactorConnection = typeof PowerhouseReactorConnection.Type;

export const PowerhouseReactorIdentifier = TrimmedNonEmptyString.check(
  Schema.isMaxLength(POWERHOUSE_REACTOR_ID_MAX_LENGTH),
);

export const PowerhouseReactorCursor = Schema.String.check(
  Schema.isMaxLength(POWERHOUSE_REACTOR_CURSOR_MAX_LENGTH),
);

export const PowerhouseReactorDocumentSummary = Schema.Struct({
  id: PowerhouseReactorIdentifier,
  slug: Schema.NullOr(Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_LABEL_MAX_LENGTH))),
  name: Schema.NullOr(Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_LABEL_MAX_LENGTH))),
  documentType: Schema.String.check(
    Schema.isMaxLength(POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH),
  ),
  createdAtUtcIso: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_TIMESTAMP_MAX_LENGTH)),
  ),
  lastModifiedAtUtcIso: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_TIMESTAMP_MAX_LENGTH)),
  ),
});
export type PowerhouseReactorDocumentSummary = typeof PowerhouseReactorDocumentSummary.Type;

export const PowerhouseReactorListDrivesInput = Schema.Struct({
  url: PowerhouseReactorUrl,
});
export type PowerhouseReactorListDrivesInput = typeof PowerhouseReactorListDrivesInput.Type;

export const PowerhouseReactorListDrivesResult = Schema.Struct({
  drives: Schema.Array(PowerhouseReactorDocumentSummary),
  /** The reactor exposed more drives than this diagnostic surface will transfer. */
  truncated: Schema.Boolean,
});
export type PowerhouseReactorListDrivesResult = typeof PowerhouseReactorListDrivesResult.Type;

/** The document search fields exposed by Switchboard's `SearchFilterInput`. */
export const PowerhouseReactorDocumentSearchFilter = Schema.Struct({
  type: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH)),
  ),
  parentId: Schema.optional(PowerhouseReactorIdentifier),
  identifiers: Schema.optional(
    Schema.Array(PowerhouseReactorIdentifier).check(
      Schema.isMaxLength(POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT),
    ),
  ),
});
export type PowerhouseReactorDocumentSearchFilter =
  typeof PowerhouseReactorDocumentSearchFilter.Type;

/** The document projection fields exposed by Switchboard's `ViewFilterInput`. */
export const PowerhouseReactorDocumentViewFilter = Schema.Struct({
  branch: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  ),
  scopes: Schema.optional(
    Schema.Array(
      TrimmedNonEmptyString.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
    ).check(Schema.isMaxLength(POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT)),
  ),
});
export type PowerhouseReactorDocumentViewFilter = typeof PowerhouseReactorDocumentViewFilter.Type;

export const PowerhouseReactorListDocumentsInput = Schema.Struct({
  url: PowerhouseReactorUrl,
  search: PowerhouseReactorDocumentSearchFilter,
  view: Schema.optional(PowerhouseReactorDocumentViewFilter),
  cursor: Schema.optional(PowerhouseReactorCursor),
  limit: Schema.optional(PositiveInt),
});
export type PowerhouseReactorListDocumentsInput = typeof PowerhouseReactorListDocumentsInput.Type;

/**
 * No total: the reactor reports the page length as `totalCount`, so a "N of M"
 * would be a lie.
 *
 * `nextCursor` is honoured when present, but `findDocuments` does not issue one
 * even when it has capped a result, so a listing is normally a single bounded
 * response and `truncated` is what says whether children were left behind.
 */
export const PowerhouseReactorListDocumentsResult = Schema.Struct({
  documents: Schema.Array(PowerhouseReactorDocumentSummary),
  nextCursor: Schema.NullOr(PowerhouseReactorCursor),
  /** The reactor may hold more matching documents than this listing will transfer. */
  truncated: Schema.Boolean,
});
export type PowerhouseReactorListDocumentsResult = typeof PowerhouseReactorListDocumentsResult.Type;

export const PowerhouseReactorGetDocumentInput = Schema.Struct({
  url: PowerhouseReactorUrl,
  documentId: PowerhouseReactorIdentifier,
  view: Schema.optional(PowerhouseReactorDocumentViewFilter),
});
export type PowerhouseReactorGetDocumentInput = typeof PowerhouseReactorGetDocumentInput.Type;

export const PowerhouseReactorDocumentRevision = Schema.Struct({
  scope: Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  revision: Schema.Int,
});
export type PowerhouseReactorDocumentRevision = typeof PowerhouseReactorDocumentRevision.Type;

export const PowerhouseReactorDocument = Schema.Struct({
  ...PowerhouseReactorDocumentSummary.fields,
  preferredEditor: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_LABEL_MAX_LENGTH)),
  ),
  /** Opaque document state. `null` when omitted by the reactor or dropped by the size guard. */
  state: Schema.Unknown,
  /** The state was too large to send; the panel says so instead of showing nothing. */
  stateTruncated: Schema.Boolean,
  revisions: Schema.Array(PowerhouseReactorDocumentRevision),
  revisionsTruncated: Schema.Boolean,
  childIds: Schema.Array(PowerhouseReactorIdentifier),
  childIdsTruncated: Schema.Boolean,
});
export type PowerhouseReactorDocument = typeof PowerhouseReactorDocument.Type;

export const PowerhouseReactorGetOperationsInput = Schema.Struct({
  url: PowerhouseReactorUrl,
  documentId: PowerhouseReactorIdentifier,
  /** Branch and scopes follow the document view selected in Explorer. */
  view: Schema.optional(PowerhouseReactorDocumentViewFilter),
  cursor: Schema.optional(PowerhouseReactorCursor),
  limit: Schema.optional(PositiveInt),
});
export type PowerhouseReactorGetOperationsInput = typeof PowerhouseReactorGetOperationsInput.Type;

/**
 * One entry of a document's operation log. `actionType`/`actionInput`/`scope`
 * are lifted out of the reactor's nested `action` object.
 */
export const PowerhouseReactorOperation = Schema.Struct({
  index: Schema.Int,
  timestampUtcMs: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_TIMESTAMP_MAX_LENGTH)),
  ),
  hash: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  ),
  skip: Schema.NullOr(Schema.Int),
  error: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  ),
  actionType: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  ),
  actionInput: Schema.Unknown,
  /** The operation input exceeded the panel's websocket payload guard and was dropped. */
  actionInputTruncated: Schema.Boolean,
  scope: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  ),
  signer: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
  ),
});
export type PowerhouseReactorOperation = typeof PowerhouseReactorOperation.Type;

export const PowerhouseReactorGetOperationsResult = Schema.Struct({
  operations: Schema.Array(PowerhouseReactorOperation),
  nextCursor: Schema.NullOr(PowerhouseReactorCursor),
});
export type PowerhouseReactorGetOperationsResult = typeof PowerhouseReactorGetOperationsResult.Type;

export const PowerhouseReactorFailure = Schema.Literals([
  "invalid_url",
  /** Nothing accepted a connection on any candidate. */
  "unreachable",
  /** Something answered, but not with a reactor's system fingerprint. */
  "not_a_reactor",
  "http_error",
  "graphql_error",
  "decode_failed",
  "timeout",
]);
export type PowerhouseReactorFailure = typeof PowerhouseReactorFailure.Type;

const POWERHOUSE_REACTOR_FAILURE_MESSAGES: Record<PowerhouseReactorFailure, string> = {
  invalid_url: "The reactor URL must be an http or https address.",
  unreachable: "No reactor is listening.",
  not_a_reactor: "Something is listening, but it is not a Powerhouse reactor.",
  http_error: "The reactor rejected the request.",
  graphql_error: "The reactor returned an error.",
  decode_failed: "The reactor returned data this build cannot read.",
  timeout: "The reactor did not respond in time.",
};

export class PowerhouseReactorError extends Schema.TaggedErrorClass<PowerhouseReactorError>()(
  "PowerhouseReactorError",
  {
    failure: PowerhouseReactorFailure,
    url: Schema.optional(Schema.String),
    /** Probe only: every candidate URL tried, in order, so the panel can name them. */
    attempted: Schema.optional(Schema.Array(Schema.String)),
    status: Schema.optional(Schema.Int),
    graphqlMessages: Schema.optional(
      Schema.Array(
        Schema.String.check(Schema.isMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)),
      ),
    ),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly failure: PowerhouseReactorFailure;
    readonly url?: string | undefined;
    readonly attempted?: ReadonlyArray<string> | undefined;
    readonly status?: number | undefined;
    readonly graphqlMessages?: ReadonlyArray<string> | undefined;
    readonly cause?: unknown;
    /** Supplied by schema decoding so a wire-safe message survives a round trip. */
    readonly message?: string | undefined;
  }) {
    super({
      ...props,
      message: props.message ?? POWERHOUSE_REACTOR_FAILURE_MESSAGES[props.failure],
    });
  }
}
