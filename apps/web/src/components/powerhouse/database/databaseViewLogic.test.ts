import { describe, expect, it, vi } from "vite-plus/test";

import {
  formatPowerhouseDatabaseTargetStatus,
  formatPowerhouseRelationChatContext,
  formatPowerhouseResultChatContext,
  insertPowerhouseChatContext,
  makePowerhouseSqlCompletionSchema,
  makePowerhouseRelationSelectSql,
  selectPowerhouseDatabaseRelation,
} from "./databaseViewLogic";

const relations = [
  { schema: "public", name: "documents", kind: "table" as const, estimatedRows: 12 },
  { schema: "processor_a1b2", name: "state", kind: "view" as const, estimatedRows: null },
];

describe("database panel presentation", () => {
  it("labels live and snapshot targets explicitly", () => {
    expect(
      formatPowerhouseDatabaseTargetStatus({
        id: "reactor",
        label: "Reactor",
        backend: "postgres",
        status: "ready",
        source: "project_env",
        snapshotWrittenAtUtcIso: null,
        detail: null,
      }),
    ).toBe("Live Postgres");
    expect(
      formatPowerhouseDatabaseTargetStatus({
        id: "read_models",
        label: "Read models",
        backend: "pglite_snapshot",
        status: "ready",
        source: "default",
        snapshotWrittenAtUtcIso: "2026-08-19T14:43:00.000Z",
        detail: null,
      }),
    ).toContain("Snapshot · written");
  });

  it("keeps hashed schemas honest and falls back when a selection disappears", () => {
    expect(selectPowerhouseDatabaseRelation(relations, "processor_a1b2", "state")).toEqual(
      relations[1],
    );
    expect(selectPowerhouseDatabaseRelation(relations, "removed", "table")).toEqual(relations[0]);
  });

  it("generates an identifier-safe bounded preview query", () => {
    expect(makePowerhouseRelationSelectSql({ schema: 'read"models', name: "document state" })).toBe(
      'SELECT *\nFROM "read""models"."document state"\nLIMIT 100;',
    );
  });

  it("derives SQL completion namespaces from the loaded catalog", () => {
    expect(
      makePowerhouseSqlCompletionSchema({
        target: {
          id: "read_models",
          label: "Read models",
          backend: "pglite_snapshot",
          status: "ready",
          source: "default",
          snapshotWrittenAtUtcIso: "2026-08-19T14:43:00.000Z",
          detail: null,
        },
        schemas: [
          { name: "public", system: false, relations },
          {
            name: "information_schema",
            system: true,
            relations: [
              { schema: "information_schema", name: "tables", kind: "view", estimatedRows: null },
            ],
          },
        ],
      }),
    ).toEqual({
      public: { documents: [], state: [] },
      information_schema: { tables: [] },
    });
  });

  it("formats capped schema and result context without sending it", () => {
    const schema = formatPowerhouseRelationChatContext("read_models", {
      schema: "processor_a1b2",
      name: "state",
      kind: "table",
      columns: [
        {
          name: "document_id",
          ordinal: 1,
          dataType: "text",
          nullable: false,
          defaultExpression: null,
          generated: false,
        },
      ],
      indexes: [],
      constraints: [],
      definition: "CREATE TABLE …",
      definitionKind: "reconstructed",
    });
    expect(schema).toContain("processor_a1b2.state");
    expect(schema).toContain("document_id: text NOT NULL");

    const result = formatPowerhouseResultChatContext({
      target: "reactor",
      sql: "SELECT value FROM state",
      result: {
        columns: [{ name: "value", dataType: "text" }],
        rows: [[null], ["x".repeat(13_000)]],
        truncated: false,
        elapsedMs: 2,
        rowLimit: 50,
      },
    });
    expect(result).toContain("NULL");
    expect(result).toContain("result context truncated by Vetra");
    expect(result.length).toBeLessThan(12_100);
  });

  it("lets chat insertion own deferred composer focus", () => {
    const composer = {
      insertTextAtEnd: vi.fn(() => true),
      focusAtEnd: vi.fn(),
    };

    expect(insertPowerhouseChatContext(composer, "database context")).toBe("inserted");
    expect(composer.insertTextAtEnd).toHaveBeenCalledWith("database context", {
      ensureLeadingBoundary: true,
    });
    expect(composer.focusAtEnd).not.toHaveBeenCalled();
    expect(insertPowerhouseChatContext(null, "database context")).toBe("unavailable");

    composer.insertTextAtEnd.mockReturnValue(false);
    expect(insertPowerhouseChatContext(composer, "database context")).toBe("rejected");
  });
});
