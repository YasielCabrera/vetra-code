/**
 * Schema migrations for fork-owned tables, recorded in `vetra_schema_migrations`.
 *
 * Upstream's `effect_sql_migrations` skips every id at or below its recorded maximum, so a fork id
 * there would hide a future upstream migration (docs/internals/legacy-orchestration-migration.md).
 * This ledger records each applied id instead, so an entry missing from a database is applied
 * wherever it sits in the list. Append new entries; never rename or reorder applied ones.
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import Migration001 from "./VetraMigrations/001_Tickets.ts";
import Migration002 from "./VetraMigrations/002_TicketGitHubSources.ts";
import Migration003 from "./VetraMigrations/003_TicketDrafts.ts";
import Migration004 from "./VetraMigrations/004_TicketPlans.ts";
import Migration005 from "./VetraMigrations/005_TicketPlanReviewStatus.ts";
import Migration006 from "./VetraMigrations/006_TicketLinkTombstones.ts";

type VetraMigration = readonly [
  id: string,
  migration: Effect.Effect<void, SqlError, SqlClient.SqlClient>,
];

const vetraMigrations: ReadonlyArray<VetraMigration> = [
  ["001_Tickets", Migration001],
  ["002_TicketGitHubSources", Migration002],
  ["003_TicketDrafts", Migration003],
  ["004_TicketPlans", Migration004],
  ["005_TicketPlanReviewStatus", Migration005],
  ["006_TicketLinkTombstones", Migration006],
];

export const runVetraMigrations = Effect.fn("runVetraMigrations")(function* (
  migrations: ReadonlyArray<VetraMigration> = vetraMigrations,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS vetra_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `;
  const recorded = yield* sql<{ readonly id: string }>`SELECT id FROM vetra_schema_migrations`;
  const applied = new Set(recorded.map((row) => row.id));
  const executed: Array<string> = [];
  for (const [id, migration] of migrations) {
    if (applied.has(id)) continue;
    // Claiming the id first takes the write lock, so a second process waits and then skips.
    const ran = yield* sql.withTransaction(
      Effect.gen(function* () {
        const appliedAt = DateTime.formatIso(yield* DateTime.now);
        const claimed = yield* sql<{ readonly id: string }>`
          INSERT INTO vetra_schema_migrations (id, applied_at)
          VALUES (${id}, ${appliedAt})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        if (claimed.length === 0) return false;
        yield* migration;
        return true;
      }),
    );
    if (ran) executed.push(id);
  }
  if (executed.length > 0) {
    yield* Effect.log("Vetra migrations ran successfully").pipe(
      Effect.annotateLogs({ migrations: executed }),
    );
  }
  return executed;
});
