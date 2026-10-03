import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ticket_drafts (
      thread_id TEXT PRIMARY KEY,
      source_thread_id TEXT,
      project_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
});
