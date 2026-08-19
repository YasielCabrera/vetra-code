import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  statements: [] as string[],
  cursorSql: "",
  cursorLimit: 0,
  cursorClosed: 0,
  endCalls: 0,
  rows: [["one"]] as unknown[][],
  readError: null as (Error & { code?: string }) | null,
  deferRead: false,
  pendingRead: null as ((error?: Error) => void) | null,
  readStarted: Promise.resolve(),
  resolveReadStarted: () => {},
}));

vi.mock("pg-cursor", () => ({
  default: class MockCursor {
    constructor(sql: string) {
      state.cursorSql = sql;
    }

    read(
      limit: number,
      callback: (
        error: Error | undefined,
        rows: unknown[][],
        result: { fields: unknown[] },
      ) => void,
    ) {
      state.cursorLimit = limit;
      state.resolveReadStarted();
      const finish = (overrideError?: Error) =>
        callback(overrideError ?? state.readError ?? (null as unknown as undefined), state.rows, {
          fields: [{ name: "value", dataTypeID: 25 }],
        });
      if (state.deferRead) {
        state.pendingRead = finish;
      } else {
        finish();
      }
    }

    async close() {
      state.cursorClosed += 1;
    }
  },
}));

vi.mock("pg", () => ({
  Client: class MockClient {
    async connect() {}

    query(query: unknown) {
      if (typeof query === "string") {
        state.statements.push(query);
        return Promise.resolve(query);
      }
      return query;
    }

    async end() {
      state.endCalls += 1;
      const pending = state.pendingRead;
      state.pendingRead = null;
      pending?.(new Error("connection closed"));
    }
  },
}));

import { runPostgresQuery } from "./PowerhouseDatabaseInspector.ts";

beforeEach(() => {
  state.statements = [];
  state.cursorSql = "";
  state.cursorLimit = 0;
  state.cursorClosed = 0;
  state.endCalls = 0;
  state.rows = [["one"]];
  state.readError = null;
  state.deferRead = false;
  state.pendingRead = null;
  state.readStarted = new Promise<void>((resolve) => {
    state.resolveReadStarted = resolve;
  });
});

describe("Powerhouse Postgres adapter", () => {
  it("uses a bounded cursor inside a read-only transaction and always rolls back", async () => {
    const result = await runPostgresQuery("postgresql://localhost/example", "SELECT value", 50);

    expect(state.statements).toEqual([
      "BEGIN TRANSACTION READ ONLY",
      "SET LOCAL statement_timeout = '10000ms'",
      "SELECT 1",
      "ROLLBACK",
    ]);
    expect(state.cursorSql).toBe("SELECT value");
    expect(state.cursorLimit).toBe(51);
    expect(state.cursorClosed).toBe(1);
    expect(state.endCalls).toBe(1);
    expect(result).toEqual({
      columns: [{ name: "value", dataTypeId: 25 }],
      rows: [["one"]],
    });
  });

  it("closes the client immediately when the RPC signal is interrupted", async () => {
    state.deferRead = true;
    const controller = new AbortController();
    const pending = runPostgresQuery(
      "postgresql://localhost/example",
      "SELECT pg_sleep(10)",
      50,
      controller.signal,
    );
    await state.readStarted;
    controller.abort(new Error("interrupted"));

    await expect(pending).rejects.toThrow("connection closed");
    expect(state.endCalls).toBe(1);
    expect(state.cursorClosed).toBe(0);
    expect(state.statements).not.toContain("ROLLBACK");
  });

  it("preserves the Postgres timeout code for structured error mapping", async () => {
    state.readError = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });

    await expect(
      runPostgresQuery("postgresql://localhost/example", "SELECT pg_sleep(11)", 50),
    ).rejects.toMatchObject({ code: "57014" });
    expect(state.statements).toContain("ROLLBACK");
    expect(state.endCalls).toBe(1);
  });
});
