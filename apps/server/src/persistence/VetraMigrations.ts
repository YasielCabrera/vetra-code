// Fork schema uses a separate ledger: an upstream id at or below its maximum never runs again.
// Missing fork entries run regardless of position; append entries without renaming applied ones.
// See docs/internals/legacy-orchestration-migration.md for the divergent upstream ids.
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import Migration001 from "./VetraMigrations/001_Tickets.ts";
import Migration002 from "./VetraMigrations/002_TicketGitHubSources.ts";
import Migration003 from "./VetraMigrations/003_TicketDrafts.ts";
import Migration004 from "./VetraMigrations/004_TicketPlans.ts";
import Migration005 from "./VetraMigrations/005_TicketPlanReviewStatus.ts";
import Migration006 from "./VetraMigrations/006_TicketLinkTombstones.ts";
import Migration007 from "./VetraMigrations/007_ProjectTicketNumbers.ts";
import Migration008 from "./VetraMigrations/008_TicketGitHubSyncCursor.ts";
import Migration009 from "./VetraMigrations/009_AuthSessionMcpTools.ts";

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
  ["007_ProjectTicketNumbers", Migration007],
  ["008_TicketGitHubSyncCursor", Migration008],
  ["009_AuthSessionMcpTools", Migration009],
];

export const hasPendingVetraMigrations = Effect.fn("hasPendingVetraMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vetra_schema_migrations'
  `;
  if (tables.length === 0) return true;
  const recorded = yield* sql<{ readonly id: string }>`SELECT id FROM vetra_schema_migrations`;
  const applied = new Set(recorded.map((row) => row.id));
  return vetraMigrations.some(([id]) => !applied.has(id));
});

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
