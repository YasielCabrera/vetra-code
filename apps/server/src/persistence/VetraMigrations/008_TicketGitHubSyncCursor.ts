import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE ticket_github_sources ADD COLUMN sync_watermark_at TEXT`;
  yield* sql`
    CREATE TABLE ticket_github_sync_pending (
      host TEXT NOT NULL COLLATE NOCASE,
      repository TEXT NOT NULL COLLATE NOCASE,
      number INTEGER NOT NULL,
      last_attempt_at TEXT,
      PRIMARY KEY (host, repository, number)
    )
  `;
});
