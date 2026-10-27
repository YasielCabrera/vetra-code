import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// A side table, not a column: upstream has rebuilt auth_sessions before and would drop a fork column.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE vetra_auth_session_mcp_tools (
      session_id TEXT PRIMARY KEY,
      tools TEXT NOT NULL CHECK (tools IN ('tickets'))
    )
  `;
});
