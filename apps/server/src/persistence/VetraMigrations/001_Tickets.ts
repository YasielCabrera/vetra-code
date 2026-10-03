import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ticket_statuses (
      status_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('open', 'active', 'closed')),
      close_reason TEXT CHECK (close_reason IN ('completed', 'not_planned')),
      position INTEGER NOT NULL,
      collapsed_by_default INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      CHECK ((category = 'closed') = (close_reason IS NOT NULL))
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_ticket_statuses_category_default
    ON ticket_statuses(category) WHERE is_default = 1
  `;
  yield* sql`
    INSERT INTO ticket_statuses (
      status_id, name, color, category, close_reason, position, collapsed_by_default, is_default
    ) VALUES
      ('backlog', 'Backlog', 'gray', 'open', NULL, 0, 0, 0),
      ('todo', 'Todo', 'blue', 'open', NULL, 1, 0, 1),
      ('in_progress', 'In progress', 'amber', 'active', NULL, 2, 0, 1),
      ('in_review', 'In review', 'violet', 'active', NULL, 3, 0, 0),
      ('done', 'Done', 'green', 'closed', 'completed', 4, 0, 1),
      ('canceled', 'Canceled', 'gray', 'closed', 'not_planned', 5, 1, 0)
  `;

  yield* sql`
    CREATE TABLE tickets (
      ticket_id TEXT PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('local', 'github')),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      labels_json TEXT NOT NULL DEFAULT '[]',
      status_id TEXT NOT NULL REFERENCES ticket_statuses(status_id),
      sort_key TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      github_host TEXT,
      github_repository TEXT COLLATE NOCASE,
      github_number INTEGER,
      github_snapshot_json TEXT,
      hidden_at TEXT,
      hidden_reason TEXT CHECK (hidden_reason IN ('user', 'source')),
      CHECK ((kind = 'github') = (github_snapshot_json IS NOT NULL)),
      CHECK ((hidden_at IS NULL) = (hidden_reason IS NULL))
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_tickets_github_issue
    ON tickets(github_host, github_repository, github_number) WHERE kind = 'github'
  `;
  yield* sql`CREATE INDEX idx_tickets_status_sort ON tickets(status_id, sort_key)`;

  yield* sql`
    CREATE TABLE ticket_links (
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      target_key TEXT NOT NULL,
      target_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (ticket_id, kind, target_key)
    )
  `;
  yield* sql`CREATE INDEX idx_ticket_links_target ON ticket_links(kind, target_key)`;

  yield* sql`
    CREATE TABLE ticket_attachments (
      attachment_id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_ticket_attachments_ticket ON ticket_attachments(ticket_id)`;

  yield* sql`
    CREATE TABLE ticket_activity (
      activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
      actor_json TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_ticket_activity_ticket ON ticket_activity(ticket_id, activity_id)`;

  yield* sql`
    CREATE TABLE ticket_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_number INTEGER NOT NULL
    )
  `;
  yield* sql`INSERT INTO ticket_counter (id, next_number) VALUES (1, 1)`;

  yield* sql`CREATE VIRTUAL TABLE tickets_fts USING fts5(title, body, labels)`;
});
