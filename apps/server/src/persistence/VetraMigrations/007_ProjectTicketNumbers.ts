import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * `T-42` counts per home project: `number` is unique within `number_scope`, a project id or ''
 * for a ticket with no project. `seq` keeps the old environment-wide number as the stable
 * internal key and the `tickets_fts` rowid. Existing tickets keep their numbers, so older
 * references stay valid. Altered in place: rebuilding `tickets` would cascade-delete its rows.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE tickets RENAME COLUMN number TO seq`;
  yield* sql`ALTER TABLE tickets ADD COLUMN number INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE tickets ADD COLUMN number_scope TEXT NOT NULL DEFAULT ''`;
  yield* sql`
    UPDATE tickets SET
      number = seq,
      number_scope = COALESCE(
        (
          SELECT l.target_key FROM ticket_links l
          WHERE l.ticket_id = tickets.ticket_id AND l.kind = 'project'
          ORDER BY l.created_at, l.rowid
          LIMIT 1
        ),
        ''
      )
  `;
  yield* sql`CREATE UNIQUE INDEX idx_tickets_number ON tickets(number_scope, number)`;

  // Numbers are never reused within a scope, even after a delete. A deleted ticket's project is
  // gone with its links, so every existing scope, '' included, resumes at the old global counter
  // and cannot hand out any number issued before. New projects start at 1.
  yield* sql`
    CREATE TABLE ticket_number_counters (
      number_scope TEXT PRIMARY KEY,
      next_number INTEGER NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO ticket_number_counters (number_scope, next_number)
    SELECT number_scope,
      MAX(MAX(number) + 1, (SELECT next_number FROM ticket_counter WHERE id = 1))
    FROM tickets GROUP BY number_scope
  `;
  yield* sql`
    INSERT OR IGNORE INTO ticket_number_counters (number_scope, next_number)
    SELECT '', next_number FROM ticket_counter WHERE id = 1 AND next_number > 1
  `;

  // A number a ticket had in a scope before it moved, so the old `T-42` still finds it there.
  yield* sql`
    CREATE TABLE ticket_number_aliases (
      number_scope TEXT NOT NULL,
      number INTEGER NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      PRIMARY KEY (number_scope, number)
    )
  `;
  yield* sql`CREATE INDEX idx_ticket_number_aliases_ticket ON ticket_number_aliases(ticket_id)`;
});
