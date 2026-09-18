import type {
  PowerhouseDatabaseCatalogResult,
  PowerhouseDatabaseQueryResult,
  PowerhouseDatabaseRelationDetail,
  PowerhouseDatabaseRelationSummary,
  PowerhouseDatabaseTarget,
  PowerhouseDatabaseTargetId,
} from "@t3tools/contracts";

const CHAT_CONTEXT_CHARACTER_LIMIT = 12_000;

type PowerhouseChatComposer = {
  readonly insertTextAtEnd: (
    text: string,
    options?: { readonly ensureLeadingBoundary?: boolean },
  ) => boolean;
};

export function insertPowerhouseChatContext(
  composer: PowerhouseChatComposer | null | undefined,
  context: string,
) {
  if (composer === null || composer === undefined) return "unavailable";

  // Insertion schedules focus after the controlled editor commits. Refocusing
  // synchronously here would read its previous snapshot and restore stale text.
  return composer.insertTextAtEnd(context, { ensureLeadingBoundary: true })
    ? "inserted"
    : "rejected";
}

export function makePowerhouseSqlCompletionSchema(catalog: PowerhouseDatabaseCatalogResult) {
  return Object.fromEntries(
    catalog.schemas.map((schema) => [
      schema.name,
      Object.fromEntries(schema.relations.map((relation) => [relation.name, []])),
    ]),
  );
}

export const quoteDatabaseIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`;

export function makePowerhouseRelationSelectSql(relation: {
  readonly schema: string;
  readonly name: string;
}) {
  return `SELECT *\nFROM ${quoteDatabaseIdentifier(relation.schema)}.${quoteDatabaseIdentifier(relation.name)}\nLIMIT 100;`;
}

export function selectPowerhouseDatabaseRelation(
  relations: ReadonlyArray<PowerhouseDatabaseRelationSummary>,
  schema: string | null,
  relation: string | null,
) {
  return (
    relations.find((entry) => entry.schema === schema && entry.name === relation) ??
    relations[0] ??
    null
  );
}

export function formatPowerhouseDatabaseTargetStatus(
  target: PowerhouseDatabaseTarget,
  locale?: string,
) {
  if (target.backend === "postgres") return "Live Postgres";
  if (target.snapshotWrittenAtUtcIso === null) return "Snapshot unavailable";
  const date = new Date(target.snapshotWrittenAtUtcIso);
  const written = Number.isNaN(date.valueOf())
    ? target.snapshotWrittenAtUtcIso
    : new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  return `Snapshot · written ${written}`;
}

const capChatContext = (text: string, kind: "schema" | "result") =>
  text.length <= CHAT_CONTEXT_CHARACTER_LIMIT
    ? text
    : `${text.slice(0, CHAT_CONTEXT_CHARACTER_LIMIT)}\n… ${kind} context truncated by Vetra`;

export function formatPowerhouseRelationChatContext(
  target: PowerhouseDatabaseTargetId,
  relation: PowerhouseDatabaseRelationDetail,
) {
  return capChatContext(
    [
      `[Powerhouse database schema · ${target === "read_models" ? "Read models" : "Reactor"}]`,
      `${relation.schema}.${relation.name} (${relation.kind.replaceAll("_", " ")})`,
      "",
      "Columns:",
      ...relation.columns.map(
        (column) =>
          `- ${column.name}: ${column.dataType}${column.nullable ? "" : " NOT NULL"}${column.defaultExpression === null ? "" : ` DEFAULT ${column.defaultExpression}`}`,
      ),
      "",
      "Indexes:",
      ...(relation.indexes.length === 0
        ? ["- none"]
        : relation.indexes.map((index) => `- ${index.definition}`)),
      "",
      "Constraints:",
      ...(relation.constraints.length === 0
        ? ["- none"]
        : relation.constraints.map((constraint) => `- ${constraint.definition}`)),
    ].join("\n"),
    "schema",
  );
}

export function formatPowerhouseResultChatContext(input: {
  readonly target: PowerhouseDatabaseTargetId;
  readonly sql: string;
  readonly result: PowerhouseDatabaseQueryResult;
}) {
  return capChatContext(
    [
      `[Powerhouse database query · ${input.target === "read_models" ? "Read models" : "Reactor"}]`,
      "SQL:",
      input.sql,
      "",
      input.result.columns.map((column) => column.name).join("\t"),
      ...input.result.rows.map((row) => row.map((cell) => cell ?? "NULL").join("\t")),
    ].join("\n"),
    "result",
  );
}
