import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "./Migrations.ts";
import { runVetraMigrations } from "./VetraMigrations.ts";
import Migration001 from "./VetraMigrations/001_Tickets.ts";
import Migration002 from "./VetraMigrations/002_TicketGitHubSources.ts";
import Migration003 from "./VetraMigrations/003_TicketDrafts.ts";
import Migration004 from "./VetraMigrations/004_TicketPlans.ts";

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

it.effect("defaults existing active and archived plans to Draft and preserves data on rerun", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 1 });
    yield* runVetraMigrations([
      ["001_Tickets", Migration001],
      ["002_TicketGitHubSources", Migration002],
      ["003_TicketDrafts", Migration003],
      ["004_TicketPlans", Migration004],
    ]);
    yield* sql`
      INSERT INTO tickets (
        ticket_id, number, kind, title, status_id, sort_key, created_by_json, created_at, updated_at
      ) VALUES ('t1', 1, 'local', 'Ticket', 'todo', 'a0', '{"type":"user"}', 'before', 'before')
    `;
    yield* sql`
      INSERT INTO ticket_plans (
        plan_id, ticket_id, number, title, body, status, revision,
        created_by_json, updated_by_json, created_at, updated_at
      ) VALUES
        ('p1', 't1', 1, 'Active plan', '# Content', 'active', 4,
          '{"type":"user"}', '{"type":"user"}', 'created', 'updated'),
        ('p2', 't1', 2, 'Archived plan', 'Archived content', 'archived', 7,
          '{"type":"user"}', '{"type":"agent","threadId":"agent1"}', 'created', 'updated')
    `;
    yield* sql`
      INSERT INTO ticket_plan_comments (comment_id, plan_id, body, actor_json, created_at)
      VALUES ('c1', 'p2', 'Keep this comment', '{"type":"user"}', 'commented')
    `;
    const beforePlans = yield* sql`SELECT ticket_plans.* FROM ticket_plans ORDER BY number`;
    const beforeComments = yield* sql`SELECT * FROM ticket_plan_comments`;
    assert.deepStrictEqual(yield* runVetraMigrations(), ["005_TicketPlanReviewStatus"]);
    const migratedPlans = yield* sql`
      SELECT plan_id, ticket_id, number, title, body, status, revision,
        created_by_json, updated_by_json, created_at, updated_at, review_status
      FROM ticket_plans ORDER BY number
    `;
    assert.deepStrictEqual(
      migratedPlans,
      beforePlans.map((row) => ({ ...row, review_status: "draft" })),
    );
    assert.deepStrictEqual(yield* sql`SELECT * FROM ticket_plan_comments`, beforeComments);
    const invalid =
      yield* sql`UPDATE ticket_plans SET review_status = 'approved' WHERE plan_id = 'p1'`.pipe(
        Effect.flip,
      );
    assert.strictEqual(invalid._tag, "SqlError");
    yield* sql`UPDATE ticket_plans SET review_status = 'ready' WHERE plan_id = 'p2'`;
    const readyPlans = yield* sql`SELECT * FROM ticket_plans ORDER BY number`;
    assert.deepStrictEqual(yield* runVetraMigrations(), []);
    assert.deepStrictEqual(yield* sql`SELECT * FROM ticket_plans ORDER BY number`, readyPlans);
    assert.deepStrictEqual(yield* sql`SELECT * FROM ticket_plan_comments`, beforeComments);
    assert.deepStrictEqual(yield* readLedgers, {
      vetra: [
        "001_Tickets",
        "002_TicketGitHubSources",
        "003_TicketDrafts",
        "004_TicketPlans",
        "005_TicketPlanReviewStatus",
      ],
      upstream: ["1_OrchestrationEvents"],
    });
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
