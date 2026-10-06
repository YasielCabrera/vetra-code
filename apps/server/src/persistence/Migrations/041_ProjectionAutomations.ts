import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Automations, plus the two thread columns that keep their runs out of the
 * sidebar. `hidden_at` is deliberately generic: it means "exists but is not in
 * the inbox", and automations are only its first user.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_automations (
      automation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owns_project INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      model TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      env_mode TEXT NOT NULL,
      base_branch TEXT,
      start_from_origin INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      last_run_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  // The scheduler's only hot query: the enabled, undeleted, soonest-due set.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automations_due
    ON projection_automations(deleted_at, enabled, next_run_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_automations_project_id
    ON projection_automations(project_id)
  `;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!threadColumns.some((column) => column.name === "hidden_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN hidden_at TEXT
    `;
  }

  if (!threadColumns.some((column) => column.name === "automation_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN automation_id TEXT
    `;
  }

  // The sidebar reads active threads by project; hidden runs are filtered out
  // of that same read, so the flag belongs in its index.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_hidden_at
    ON projection_threads(hidden_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_automation_id
    ON projection_threads(automation_id)
  `;

  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!projectColumns.some((column) => column.name === "automation_id")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN automation_id TEXT
    `;
  }
});
