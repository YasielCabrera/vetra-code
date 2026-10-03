import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "./Migrations.ts";
import { runVetraMigrations } from "./VetraMigrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

const createTable = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`CREATE TABLE ${name} (id TEXT PRIMARY KEY)`);
  });

const readLedgers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const vetra = yield* sql<{ readonly id: string }>`
    SELECT id FROM vetra_schema_migrations ORDER BY id
  `;
  const upstream = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return {
    vetra: vetra.map((row) => row.id),
    upstream: upstream.map((row) => `${row.migration_id}_${row.name}`),
  };
});

layer("runVetraMigrations", (it) => {
  it.effect("applies each migration once in its own ledger and never writes upstream's", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 1 });

      const first = yield* runVetraMigrations([
        ["001_Alpha", createTable("alpha")],
        ["003_Gamma", createTable("gamma")],
      ]);
      assert.deepStrictEqual(first, ["001_Alpha", "003_Gamma"]);

      const rerun = yield* runVetraMigrations([
        ["001_Alpha", createTable("alpha")],
        ["003_Gamma", createTable("gamma")],
      ]);
      assert.deepStrictEqual(rerun, []);

      const merged = yield* runVetraMigrations([
        ["001_Alpha", createTable("alpha")],
        ["002_Beta", createTable("beta")],
        ["003_Gamma", createTable("gamma")],
      ]);
      assert.deepStrictEqual(merged, ["002_Beta"]);

      assert.deepStrictEqual(yield* readLedgers, {
        vetra: ["001_Alpha", "002_Beta", "003_Gamma"],
        upstream: ["1_OrchestrationEvents"],
      });
    }),
  );

  it.effect("rolls back a failed migration so the next start retries it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const failing = Effect.gen(function* () {
        yield* createTable("half_done");
        yield* sql.unsafe(`INSERT INTO missing_table VALUES (1)`);
      });

      const failure = yield* runVetraMigrations([["004_Delta", failing]]).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "SqlError");

      const retried = yield* runVetraMigrations([["004_Delta", createTable("half_done")]]);
      assert.deepStrictEqual(retried, ["004_Delta"]);
    }),
  );
});
