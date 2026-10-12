import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "./Migrations.ts";
import { runVetraMigrations } from "./VetraMigrations.ts";
import Migration001 from "./VetraMigrations/001_Tickets.ts";
import Migration002 from "./VetraMigrations/002_TicketGitHubSources.ts";
import Migration003 from "./VetraMigrations/003_TicketDrafts.ts";
import Migration004 from "./VetraMigrations/004_TicketPlans.ts";
import Migration005 from "./VetraMigrations/005_TicketPlanReviewStatus.ts";
import Migration006 from "./VetraMigrations/006_TicketLinkTombstones.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

const createTable = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`CREATE TABLE ${name} (id TEXT PRIMARY KEY)`);
  });

const countRowsIn = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      readonly count: number;
    }>`SELECT COUNT(*) AS count FROM ${sql(table)}`;
    return row!.count;
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
    assert.deepStrictEqual(yield* runVetraMigrations(), [
      "005_TicketPlanReviewStatus",
      "006_TicketLinkTombstones",
      "007_ProjectTicketNumbers",
    ]);
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
        "006_TicketLinkTombstones",
        "007_ProjectTicketNumbers",
      ],
      upstream: ["1_OrchestrationEvents"],
    });
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("numbers existing tickets in their earliest project and keeps every row", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runVetraMigrations([
      ["001_Tickets", Migration001],
      ["002_TicketGitHubSources", Migration002],
      ["003_TicketDrafts", Migration003],
      ["004_TicketPlans", Migration004],
      ["005_TicketPlanReviewStatus", Migration005],
      ["006_TicketLinkTombstones", Migration006],
    ]);
    // T-4 and T-7 were deleted. T-7 sat above every surviving number, in a project now unknown.
    yield* sql`UPDATE ticket_counter SET next_number = 8`;
    yield* sql`
      INSERT INTO tickets (
        ticket_id, number, kind, title, status_id, sort_key, created_by_json, created_at, updated_at
      ) VALUES
        ('t1', 1, 'local', 'Alpha one', 'todo', 'a0', '{"type":"user"}', 'a', 'a'),
        ('t2', 2, 'local', 'Beta one', 'todo', 'a1', '{"type":"user"}', 'b', 'b'),
        ('t3', 3, 'local', 'Loose', 'todo', 'a2', '{"type":"user"}', 'c', 'c'),
        ('t5', 5, 'local', 'Alpha two', 'todo', 'a3', '{"type":"user"}', 'd', 'd'),
        ('t6', 6, 'local', 'Twins', 'todo', 'a4', '{"type":"user"}', 'e', 'e')
    `;
    yield* sql`
      INSERT INTO ticket_links (ticket_id, kind, target_key, target_json, source, created_at)
      VALUES
        ('t1', 'project', 'alpha', '{}', 'user', 'a'),
        ('t1', 'thread', 'thread-1', '{}', 'user', 'a'),
        ('t2', 'project', 'alpha', '{}', 'user', 'z'),
        ('t2', 'project', 'beta', '{}', 'user', 'b'),
        ('t5', 'project', 'alpha', '{}', 'user', 'd'),
        ('t6', 'project', 'gamma', '{}', 'user', 'e'),
        ('t6', 'project', 'delta', '{}', 'user', 'e')
    `;
    yield* sql`
      INSERT INTO tickets_fts (rowid, title, body, labels) VALUES
        (1, 'Alpha one', '', ''), (2, 'Beta one', '', ''), (3, 'Loose', '', ''),
        (5, 'Alpha two', '', ''), (6, 'Twins', '', '')
    `;
    yield* sql`
      INSERT INTO ticket_attachments (
        attachment_id, ticket_id, type, name, mime_type, size_bytes, created_at
      ) VALUES ('a1', 't1', 'file', 'notes.txt', 'text/plain', 5, 'a')
    `;
    yield* sql`
      INSERT INTO ticket_activity (ticket_id, actor_json, entry_json, created_at)
      VALUES ('t2', '{"type":"user"}', '{"type":"created"}', 'b')
    `;
    yield* sql`
      INSERT INTO ticket_plans (
        plan_id, ticket_id, number, title, status, created_by_json, updated_by_json, created_at,
        updated_at
      ) VALUES ('p1', 't5', 1, 'Plan', 'active', '{"type":"user"}', '{"type":"user"}', 'd', 'd')
    `;
    yield* sql`
      INSERT INTO ticket_link_tombstones (ticket_id, kind, target_key, target_json, removed_at)
      VALUES ('t3', 'project', 'beta', '{}', 'c')
    `;
    const childTables = [
      "ticket_links",
      "ticket_attachments",
      "ticket_activity",
      "ticket_plans",
      "ticket_link_tombstones",
    ];
    const readChildren = Effect.forEach(
      childTables,
      (table) => sql`SELECT * FROM ${sql(table)} ORDER BY rowid`,
    );
    const before = yield* readChildren;

    assert.deepStrictEqual(yield* runVetraMigrations(), ["007_ProjectTicketNumbers"]);

    assert.deepStrictEqual(
      yield* sql`SELECT ticket_id, seq, number, number_scope FROM tickets ORDER BY seq`,
      [
        { ticket_id: "t1", seq: 1, number: 1, number_scope: "alpha" },
        { ticket_id: "t2", seq: 2, number: 2, number_scope: "beta" },
        { ticket_id: "t3", seq: 3, number: 3, number_scope: "" },
        { ticket_id: "t5", seq: 5, number: 5, number_scope: "alpha" },
        { ticket_id: "t6", seq: 6, number: 6, number_scope: "gamma" },
      ],
    );
    assert.deepStrictEqual(
      yield* sql`SELECT number_scope, next_number FROM ticket_number_counters ORDER BY number_scope`,
      // Each scope's own maximum would have reissued the deleted 4 or 7.
      [
        { number_scope: "", next_number: 8 },
        { number_scope: "alpha", next_number: 8 },
        { number_scope: "beta", next_number: 8 },
        { number_scope: "gamma", next_number: 8 },
      ],
    );
    assert.deepStrictEqual(
      yield* sql`
        SELECT t.ticket_id FROM tickets_fts JOIN tickets t ON t.seq = tickets_fts.rowid
        WHERE tickets_fts MATCH 'alpha' ORDER BY t.seq
      `,
      [{ ticket_id: "t1" }, { ticket_id: "t5" }],
    );
    assert.deepStrictEqual(yield* readChildren, before);
    assert.deepStrictEqual(yield* countRowsIn("ticket_number_aliases"), 0);
    const duplicate = yield* sql`
      UPDATE tickets SET number = 1 WHERE ticket_id = 't5'
    `.pipe(Effect.flip);
    assert.strictEqual(duplicate._tag, "SqlError");
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
