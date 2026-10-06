import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Links a user or agent removed, with their last stored target, so automation leaves them off. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE ticket_link_tombstones (
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      target_key TEXT NOT NULL,
      target_json TEXT NOT NULL,
      removed_at TEXT NOT NULL,
      PRIMARY KEY (ticket_id, kind, target_key)
    )
  `;
});
