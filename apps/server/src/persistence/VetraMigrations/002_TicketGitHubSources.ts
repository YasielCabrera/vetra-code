import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ticket_github_sources (
      project_id TEXT NOT NULL,
      host TEXT NOT NULL COLLATE NOCASE,
      repository TEXT NOT NULL COLLATE NOCASE,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      issue_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, host, repository)
    )
  `;
});
