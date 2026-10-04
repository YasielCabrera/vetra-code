import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Plan numbers are never reused within a ticket, like ticket numbers.
  yield* sql`ALTER TABLE tickets ADD COLUMN next_plan_number INTEGER NOT NULL DEFAULT 1`;

  yield* sql`
    CREATE TABLE ticket_plans (
      plan_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_by_json TEXT NOT NULL,
      updated_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (ticket_id, number)
    )
  `;

  yield* sql`
    CREATE TABLE ticket_plan_comments (
      comment_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES ticket_plans(plan_id) ON DELETE CASCADE,
      parent_comment_id TEXT REFERENCES ticket_plan_comments(comment_id) ON DELETE CASCADE,
      anchor_json TEXT,
      body TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by_json TEXT,
      created_at TEXT NOT NULL,
      CHECK ((resolved_at IS NULL) = (resolved_by_json IS NULL)),
      CHECK (parent_comment_id IS NULL OR anchor_json IS NULL)
    )
  `;
  yield* sql`
    CREATE INDEX idx_ticket_plan_comments_plan ON ticket_plan_comments(plan_id, created_at)
  `;
  // Each cascaded comment delete looks up its replies by parent.
  yield* sql`
    CREATE INDEX idx_ticket_plan_comments_parent ON ticket_plan_comments(parent_comment_id)
  `;
});
