// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  GitHubIssueSnapshot,
  ProjectId,
  ThreadId,
  TicketId,
  TicketStatusId,
  type TicketActor,
  type TicketDetail,
  type TicketListEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import * as TicketService from "./TicketService.ts";

const USER = { type: "user" } as const;
const encodeSnapshot = Schema.encodeSync(Schema.fromJsonString(GitHubIssueSnapshot));
const status = TicketStatusId.make;

const testLayer = TicketService.layer.pipe(
  Layer.provideMerge(Layer.mock(TicketGitHub.TicketGitHub)({})),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-tickets-" })),
  Layer.provideMerge(NodeServices.layer),
);

const withTickets = <A, E, R>(
  body: (tickets: TicketService.TicketService["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    return yield* body(yield* TicketService.TicketService);
  }).pipe(Effect.provide(testLayer));

const countRows = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM ${sql(table)}
    `;
    return row!.count;
  });

describe("TicketService", () => {
  it.effect("numbers tickets in sequence and never reuses a deleted number", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const first = (yield* tickets.create({ title: "First" }, USER)).ticket;
        const second = (yield* tickets.create({ title: "Second" }, USER)).ticket;
        yield* tickets.delete({ ticketId: second.id });
        const third = (yield* tickets.create({ title: "Third" }, USER)).ticket;

        assert.deepStrictEqual(
          [first, third].map((ticket) => [ticket.number, ticket.statusId, ticket.sortKey]),
          [
            [1, "todo", "a0"],
            [3, "todo", "a1"],
          ],
        );
        assert.strictEqual((yield* tickets.resolveRef("T-3")).title, "Third");
        const missing = yield* tickets.resolveRef("T-2").pipe(Effect.flip);
        assert.strictEqual(missing._tag, "TicketNotFoundError");
      }),
    ),
  );

  it.effect("rejects updates and moves against a stale revision", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const created = (yield* tickets.create({ title: "Draft" }, USER)).ticket;
        const updated = (yield* tickets.update(
          { ticketId: created.id, expectedRevision: 1, title: "Renamed", labels: ["bug", "bug"] },
          USER,
        )).ticket;
        assert.deepStrictEqual(
          [updated.title, updated.labels, updated.revision],
          ["Renamed", ["bug"], 2],
        );

        const staleUpdate = yield* tickets
          .update({ ticketId: created.id, expectedRevision: 1, title: "Lost" }, USER)
          .pipe(Effect.flip);
        const staleMove = yield* tickets
          .move(
            { ticketId: created.id, expectedRevision: 1, statusId: status("done"), sortKey: "a0" },
            USER,
          )
          .pipe(Effect.flip);
        assert.deepStrictEqual(
          [staleUpdate, staleMove].map((error) =>
            error._tag === "TicketRevisionConflictError"
              ? [error.expectedRevision, error.actualRevision]
              : error._tag,
          ),
          [
            [1, 2],
            [1, 2],
          ],
        );

        const unchanged = (yield* tickets.update(
          { ticketId: created.id, expectedRevision: 2, title: "Renamed" },
          USER,
        )).ticket;
        assert.strictEqual(unchanged.revision, 2);
      }),
    ),
  );

  it.effect("keeps the revision for links and comments so they never conflict with an editor", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const created = (yield* tickets.create({ title: "Draft" }, USER)).ticket;
        const agent = { type: "agent", threadId: ThreadId.make("thread-7") } as const;
        const linked = (yield* tickets.link(
          { ticketId: created.id, target: { kind: "thread", threadId: ThreadId.make("thread-7") } },
          agent,
        )).ticket;
        const commented = yield* tickets.addComment(
          { ticketId: created.id, body: "Looking" },
          agent,
        );
        const edited = (yield* tickets.update(
          { ticketId: created.id, expectedRevision: 1, title: "Renamed" },
          USER,
        )).ticket;
        const stale = yield* tickets
          .update({ ticketId: created.id, expectedRevision: 1, title: "Lost" }, USER)
          .pipe(Effect.flip);

        assert.deepStrictEqual(
          [
            linked.revision,
            commented.revision,
            [edited.title, edited.revision],
            stale._tag === "TicketRevisionConflictError"
              ? [stale.expectedRevision, stale.actualRevision]
              : stale._tag,
          ],
          [1, 1, ["Renamed", 2], [1, 2]],
        );
        const detail = yield* tickets.get(created.id);
        assert.deepStrictEqual(
          detail.activity.map((activity) => activity.entry.type),
          ["created", "linked", "comment", "edited"],
        );
      }),
    ),
  );

  it.effect("moves a ticket between columns and records the status change", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const created = (yield* tickets.create({ title: "Ship it" }, USER)).ticket;
        const moved = yield* tickets.move(
          {
            ticketId: created.id,
            expectedRevision: 1,
            statusId: status("in_progress"),
            sortKey: "a0V",
          },
          USER,
        );
        assert.deepStrictEqual(
          [moved.statusId, moved.sortKey, moved.revision],
          ["in_progress", "a0V", 2],
        );

        const reordered = yield* tickets.move(
          {
            ticketId: created.id,
            expectedRevision: 2,
            statusId: status("in_progress"),
            sortKey: "a1",
          },
          USER,
        );
        assert.deepStrictEqual([reordered.sortKey, reordered.revision], ["a1", 3]);

        const badKey = yield* tickets
          .move(
            { ticketId: created.id, expectedRevision: 3, statusId: status("done"), sortKey: "a00" },
            USER,
          )
          .pipe(Effect.flip);
        assert.strictEqual(badKey.message, 'Invalid sort key "a00".');

        const detail = yield* tickets.get(created.id);
        assert.deepStrictEqual(
          detail.activity.map((activity) => activity.entry),
          [
            { type: "created" },
            { type: "status_changed", from: status("todo"), to: status("in_progress") },
          ],
        );
      }),
    ),
  );

  it.effect("keeps every category's status and default when statuses change", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const parked = (yield* tickets.create(
          { title: "Someday", statusId: status("backlog") },
          USER,
        )).ticket;
        yield* tickets.create({ title: "Next" }, USER);

        const afterTodo = yield* tickets.deleteStatus(
          { statusId: status("todo"), reassignTo: status("backlog") },
          USER,
        );
        assert.deepStrictEqual(
          afterTodo.statuses.map((entry) => [entry.id, entry.isDefault]),
          [
            ["backlog", true],
            ["in_progress", true],
            ["in_review", false],
            ["done", true],
            ["canceled", false],
          ],
        );
        const next = yield* tickets.resolveRef("T-2");
        assert.deepStrictEqual([next.statusId, next.sortKey, next.revision], ["backlog", "a1", 2]);
        assert.strictEqual((yield* tickets.resolveRef("T-1")).id, parked.id);

        const lastOpen = yield* tickets
          .deleteStatus({ statusId: status("backlog"), reassignTo: status("done") }, USER)
          .pipe(Effect.flip);
        assert.strictEqual(lastOpen.message, "Move Backlog's tickets to another open status.");

        const unsetDefault = yield* tickets
          .upsertStatus({
            statusId: status("done"),
            name: "Done",
            color: "green",
            category: "closed",
            closeReason: "completed",
            isDefault: false,
          })
          .pipe(Effect.flip);
        assert.strictEqual(
          unsetDefault.message,
          "The closed category needs exactly one default status.",
        );

        const added = yield* tickets.upsertStatus({
          name: "Shipped",
          color: "violet",
          category: "closed",
          closeReason: "completed",
          isDefault: true,
        });
        const shipped = added.statuses.at(-1)!;
        assert.deepStrictEqual(
          added.statuses
            .filter((entry) => entry.category === "closed")
            .map((entry) => [entry.name, entry.position, entry.isDefault]),
          [
            ["Done", 4, false],
            ["Canceled", 5, false],
            ["Shipped", 6, true],
          ],
        );

        const reordered = yield* tickets.reorderStatuses({
          statusIds: [
            shipped.id,
            status("backlog"),
            status("in_progress"),
            status("in_review"),
            status("done"),
            status("canceled"),
          ],
        });
        assert.deepStrictEqual(
          reordered.statuses.map((entry) => entry.name),
          ["Shipped", "Backlog", "In progress", "In review", "Done", "Canceled"],
        );
      }),
    ),
  );

  it.effect("replaces an analyzer's caller link with the recorded source thread and project", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO ticket_drafts (thread_id, source_thread_id, project_id, instruction, created_at)
          VALUES ('analyzer-thread', 'source-thread', 'source-project', '', '2026-10-01T00:00:00.000Z')
        `;
        const actor = { type: "agent", threadId: ThreadId.make("analyzer-thread") } as const;
        const created = (yield* tickets.create(
          {
            title: "Captured selection",
            links: [
              { kind: "project", projectId: ProjectId.make("source-project") },
              { kind: "thread", threadId: actor.threadId },
            ],
          },
          actor,
        )).ticket;

        assert.deepStrictEqual(created.linkRefs, [
          { kind: "project", targetKey: "source-project" },
          { kind: "thread", targetKey: "source-thread" },
        ]);
        assert.deepStrictEqual(created.createdBy, actor);
        assert.deepStrictEqual(
          yield* tickets.listForTarget({ kind: "thread", targetKey: actor.threadId }),
          [],
        );
      }),
    ),
  );

  it.effect("keeps only the project when an analyzer draft has no source thread", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO ticket_drafts (thread_id, source_thread_id, project_id, instruction, created_at)
          VALUES ('analyzer-thread', NULL, 'source-project', '', '2026-10-01T00:00:00.000Z')
        `;
        const actor = { type: "agent", threadId: ThreadId.make("analyzer-thread") } as const;
        const created = (yield* tickets.create(
          {
            title: "Draft without a selection",
            links: [{ kind: "thread", threadId: actor.threadId }],
          },
          actor,
        )).ticket;

        assert.deepStrictEqual(created.linkRefs, [
          { kind: "project", targetKey: "source-project" },
        ]);
      }),
    ),
  );

  it.effect("links tickets to targets and finds them from the target", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const agent = { type: "agent", threadId: ThreadId.make("thread-7") } as const;
        const created = (yield* tickets.create(
          { title: "Investigate", links: [{ kind: "project", projectId: ProjectId.make("p-1") }] },
          agent,
        )).ticket;
        const linked = (yield* tickets.link(
          {
            ticketId: created.id,
            target: {
              kind: "pull_request",
              ref: { host: "github.com", repository: "acme/app", number: 12 },
              snapshot: {
                title: "Fix it",
                state: "open",
                url: "https://github.com/acme/app/pull/12",
              },
            },
          },
          USER,
        )).ticket;
        assert.deepStrictEqual(linked.linkRefs, [
          { kind: "project", targetKey: "p-1" },
          { kind: "pull_request", targetKey: "github.com/acme/app#12" },
        ]);

        const found = yield* tickets.listForTarget({
          kind: "pull_request",
          targetKey: "github.com/acme/app#12",
        });
        assert.deepStrictEqual(
          found.map((ticket) => ticket.id),
          [created.id],
        );

        yield* tickets.unlink(
          { ticketId: created.id, kind: "pull_request", targetKey: "github.com/acme/app#12" },
          USER,
        );
        const detail = yield* tickets.get(created.id);
        assert.deepStrictEqual(
          [
            detail.summary.createdBy,
            detail.links.map((link) => [link.target.kind, link.source]),
            detail.activity.map((activity) => activity.entry.type),
          ],
          [
            { type: "agent", threadId: "thread-7" },
            [["project", "agent"]],
            ["created", "linked", "unlinked"],
          ],
        );
        assert.deepStrictEqual(
          yield* tickets.listForTarget({
            kind: "pull_request",
            targetKey: "github.com/acme/app#12",
          }),
          [],
        );
      }),
    ),
  );

  it.effect("deletes a ticket with its links, activity and search entry", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const created = (yield* tickets.create(
          { title: "Doomed", links: [{ kind: "thread", threadId: ThreadId.make("thread-1") }] },
          USER,
        )).ticket;
        yield* tickets.addComment({ ticketId: created.id, body: "Last words" }, USER);
        yield* tickets.delete({ ticketId: created.id });

        assert.deepStrictEqual(
          [
            yield* countRows("tickets"),
            yield* countRows("ticket_links"),
            yield* countRows("ticket_activity"),
            yield* countRows("tickets_fts"),
          ],
          [0, 0, 0, 0],
        );
        const gone = yield* tickets.get(created.id).pipe(Effect.flip);
        assert.strictEqual(gone._tag, "TicketNotFoundError");
      }),
    ),
  );

  it.effect("finds tickets by words in their body", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const hit = (yield* tickets.create(
          { title: "Time machine", body: "The flux capacitor overheats at 88 mph." },
          USER,
        )).ticket;
        yield* tickets.create({ title: "Unrelated", body: "Nothing to see." }, USER);

        assert.deepStrictEqual(yield* tickets.search({ query: "capac" }), {
          truncated: false,
          hits: [
            {
              ticketId: hit.id,
              number: 1,
              title: "Time machine",
              snippet: "The flux [capacitor] overheats at 88 mph.",
            },
          ],
        });
        assert.deepStrictEqual(yield* tickets.search({ query: '"unbalanced' }), {
          hits: [],
          truncated: false,
        });
      }),
    ),
  );

  it.effect("reports truncation when matching bodies exceed the requested limit", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        yield* tickets.create({ title: "First", body: "needle" }, USER);
        yield* tickets.create({ title: "Second", body: "needle" }, USER);
        const result = yield* tickets.search({ query: "needle", limit: 1 });
        assert.strictEqual(result.hits.length, 1);
        assert.strictEqual(result.truncated, true);
        assert.strictEqual((yield* tickets.search({ query: "needle", limit: 2 })).truncated, false);
      }),
    ),
  );

  it.effect("streams a snapshot, then one delta per burst with each changed ticket once", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const existing = (yield* tickets.create({ title: "Existing" }, USER)).ticket;
        const events = yield* Queue.unbounded<TicketListEvent>();
        yield* tickets.subscribeList().pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped,
        );
        const describeEvent = (event: TicketListEvent) =>
          event.type === "snapshot"
            ? { type: event.type, titles: event.tickets.map((ticket) => ticket.title) }
            : {
                type: event.type,
                upserted: event.upserted.map((ticket) => [ticket.title, ticket.revision]),
                removed: event.removed,
              };

        assert.deepStrictEqual(describeEvent(yield* Queue.take(events)), {
          type: "snapshot",
          titles: ["Existing"],
        });
        const added = (yield* tickets.create({ title: "Added" }, USER)).ticket;
        for (const [revision, title] of [
          [1, "Edited"],
          [2, "Edited again"],
          [3, "Edited thrice"],
        ] as const) {
          yield* tickets.update({ ticketId: existing.id, expectedRevision: revision, title }, USER);
        }
        yield* TestClock.adjust("50 millis");
        assert.deepStrictEqual(describeEvent(yield* Queue.take(events)), {
          type: "delta",
          upserted: [
            ["Edited thrice", 4],
            ["Added", 1],
          ],
          removed: [],
        });

        yield* tickets.delete({ ticketId: added.id });
        yield* TestClock.adjust("50 millis");
        assert.deepStrictEqual(describeEvent(yield* Queue.take(events)), {
          type: "delta",
          upserted: [],
          removed: [added.id],
        });
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("snapshots more tickets than SQLite binds in one statement", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 33000)
          INSERT INTO tickets (
            ticket_id, number, kind, title, status_id, sort_key, created_by_json, created_at,
            updated_at
          )
          SELECT 'bulk-' || i, i, 'local', 'Bulk', 'todo', 'a0', '{"type":"user"}',
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          FROM n
        `;
        const [snapshot] = yield* tickets.subscribeList().pipe(Stream.take(1), Stream.runCollect);
        assert.strictEqual(snapshot?.type === "snapshot" ? snapshot.tickets.length : -1, 33000);
      }),
    ),
  );

  it.effect("streams one ticket's detail until it is deleted", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const watched = (yield* tickets.create({ title: "Watched" }, USER)).ticket;
        const other = (yield* tickets.create({ title: "Other" }, USER)).ticket;
        const details = yield* Queue.unbounded<ReadonlyArray<string>>();
        const done = yield* tickets.subscribeDetail(watched.id).pipe(
          Stream.runForEach((detail) =>
            Queue.offer(
              details,
              detail.activity.map((activity) => activity.entry.type),
            ),
          ),
          Effect.flip,
          Effect.forkScoped,
        );

        assert.deepStrictEqual(yield* Queue.take(details), ["created"]);
        yield* tickets.addComment({ ticketId: other.id, body: "Elsewhere" }, USER);
        yield* tickets.addComment({ ticketId: watched.id, body: "Here" }, USER);
        assert.deepStrictEqual(yield* Queue.take(details), ["created", "comment"]);
        yield* tickets.delete({ ticketId: watched.id });
        assert.strictEqual((yield* Fiber.join(done))._tag, "TicketNotFoundError");
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("claims uploads, returns each pending id's new id, and points the body at it", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        NodeFS.mkdirSync(config.attachmentsDir, { recursive: true });
        const stage = (text: string) => {
          const id = ChatAttachmentId.make(createPendingAttachmentId(".txt"));
          NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.txt`), text);
          return {
            type: "file",
            id,
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
          } as const;
        };
        const upload = stage("notes");

        const created = yield* tickets.create(
          {
            title: "With file",
            body: `See vetra-attachment://${upload.id}`,
            attachments: [upload],
          },
          USER,
        );
        const ticketId = created.ticket.id;
        const detail = yield* tickets.get(ticketId);
        const [attachment] = detail.attachments;
        assert.deepStrictEqual(
          [
            created.ticket.attachmentCount,
            created.attachments,
            attachment!.id.startsWith(`ticket-${ticketId}-`),
            detail.body,
          ],
          [
            1,
            [{ pendingId: upload.id, attachmentId: attachment!.id }],
            true,
            `See vetra-attachment://${attachment!.id}`,
          ],
        );
        const storedPath = NodePath.join(config.attachmentsDir, `${attachment!.id}.txt`);
        assert.strictEqual(NodeFS.readFileSync(storedPath, "utf8"), "notes");

        yield* tickets.update({ ticketId, expectedRevision: 1, title: "Renamed" }, USER);
        const removed = (yield* tickets.update(
          { ticketId, expectedRevision: 1, removeAttachmentIds: [attachment!.id] },
          USER,
        )).ticket;
        assert.deepStrictEqual(
          [removed.attachmentCount, removed.revision, NodeFS.existsSync(storedPath)],
          [0, 2, false],
        );

        const late = stage("later");
        const stale = yield* tickets
          .update({ ticketId, expectedRevision: 1, title: "Lost", attachments: [late] }, USER)
          .pipe(Effect.flip);
        const claimedFiles = NodeFS.readdirSync(config.attachmentsDir).filter((name) =>
          name.startsWith(`ticket-${ticketId}-`),
        );
        assert.deepStrictEqual([stale._tag, claimedFiles], ["TicketRevisionConflictError", []]);
      }),
    ),
  );

  it.effect("folds one actor's edits within five minutes into one activity entry", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Draft" }, USER)).ticket.id;
        const agent = { type: "agent", threadId: ThreadId.make("thread-7") } as const;
        const edit = (
          revision: number,
          change: { title?: string; body?: string },
          actor: TicketActor = USER,
        ) => tickets.update({ ticketId, expectedRevision: revision, ...change }, actor);

        yield* edit(1, { body: "One" });
        yield* TestClock.adjust("4 minutes");
        yield* edit(2, { title: "Titled" });
        yield* TestClock.adjust("4 minutes");
        yield* edit(3, { body: "Two" });
        yield* TestClock.adjust("6 minutes");
        yield* edit(4, { body: "Three" });
        yield* edit(5, { body: "Four" }, agent);

        const detail = yield* tickets.get(ticketId);
        assert.deepStrictEqual(
          detail.activity.map((activity) => [
            activity.actor.type,
            activity.entry,
            activity.createdAt,
          ]),
          [
            ["user", { type: "created" }, "1970-01-01T00:00:00.000Z"],
            ["user", { type: "edited", fields: ["title", "body"] }, "1970-01-01T00:08:00.000Z"],
            ["user", { type: "edited", fields: ["body"] }, "1970-01-01T00:14:00.000Z"],
            ["agent", { type: "edited", fields: ["body"] }, "1970-01-01T00:14:00.000Z"],
          ],
        );
        assert.strictEqual(detail.summary.revision, 6);
      }),
    ),
  );

  it.effect(
    "stores one normalized link per pull request and refreshes its snapshot for every viewer",
    () =>
      withTickets((tickets) =>
        Effect.gen(function* () {
          const ticketId = (yield* tickets.create({ title: "Fix login" }, USER)).ticket.id;
          const agent = { type: "agent", threadId: ThreadId.make("thread-7") } as const;
          const pullRequest = (
            repository: string,
            snapshot: { title: string; state: "open" | "merged"; url: string },
          ) => ({
            ticketId,
            target: {
              kind: "pull_request" as const,
              ref: { host: "GitHub.com", repository, number: 12 },
              snapshot,
            },
          });
          const details = yield* Queue.unbounded<TicketDetail>();
          yield* tickets.subscribeDetail(ticketId).pipe(
            Stream.runForEach((detail) => Queue.offer(details, detail)),
            Effect.forkScoped,
          );
          yield* Queue.take(details);

          const first = yield* tickets.link(
            pullRequest("Acme/App", {
              title: "acme/app#12",
              state: "open",
              url: "https://evil.test/acme/app/pull/12",
            }),
            agent,
          );
          yield* Queue.take(details);
          const refreshed = yield* tickets.link(
            pullRequest("acme/app", {
              title: "Fix the login loop",
              state: "merged",
              url: "https://github.com/acme/app/pull/12",
            }),
            { type: "automation" },
          );
          const refreshedDetail = yield* Queue.take(details);
          const agentAgain = yield* tickets.link(
            pullRequest("ACME/APP", { title: "stale", state: "open", url: "https://x.test/" }),
            agent,
          );

          const stored = (yield* tickets.get(ticketId)).links.map((link) => link.target);
          assert.deepStrictEqual(
            [first.previous, refreshed.previous?.kind, agentAgain.previous],
            [
              null,
              "pull_request",
              {
                kind: "pull_request",
                ref: { host: "github.com", repository: "acme/app", number: 12 },
                snapshot: {
                  title: "Fix the login loop",
                  state: "merged",
                  url: "https://github.com/acme/app/pull/12",
                },
              },
            ],
          );
          assert.deepStrictEqual(stored, [
            {
              kind: "pull_request",
              ref: { host: "github.com", repository: "acme/app", number: 12 },
              snapshot: {
                title: "Fix the login loop",
                state: "merged",
                url: "https://github.com/acme/app/pull/12",
              },
            },
          ]);
          assert.deepStrictEqual(
            [
              refreshedDetail.links[0]?.target.kind === "pull_request"
                ? refreshedDetail.links[0].target.snapshot.state
                : null,
              refreshedDetail.summary.revision,
              refreshedDetail.activity.map((activity) => activity.entry.type),
            ],
            ["merged", 1, ["created", "linked"]],
          );
          assert.deepStrictEqual(
            (yield* tickets.get(ticketId)).activity.map((activity) => activity.entry),
            [
              { type: "created" },
              {
                type: "linked",
                target: {
                  kind: "pull_request",
                  ref: { host: "github.com", repository: "acme/app", number: 12 },
                  snapshot: {
                    title: "acme/app#12",
                    state: "open",
                    url: "https://github.com/acme/app/pull/12",
                  },
                },
              },
            ],
          );
        }).pipe(Effect.scoped),
      ),
  );

  it.effect("keeps a GitHub ticket's issue fields read only", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const ticketId = TicketId.make("github-ticket");
        const snapshot = encodeSnapshot({
          host: "github.com",
          repository: "acme/app",
          number: 7,
          state: "open",
          stateReason: null,
          author: "octocat",
          assignees: [],
          updatedAt: "2026-10-01T00:00:00.000Z",
          syncedAt: "2026-10-01T00:00:00.000Z",
          url: "https://github.com/acme/app/issues/7",
        });
        yield* sql`
          INSERT INTO tickets (
            ticket_id, number, kind, title, body, labels_json, status_id, sort_key, revision,
            created_by_json, created_at, updated_at, github_host, github_repository,
            github_number, github_snapshot_json
          ) VALUES (
            ${ticketId}, 1, 'github', 'Issue title', 'Issue body', '[]', 'todo', 'a0', 1,
            '{"type":"sync"}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
            'github.com', 'acme/app', 7, ${snapshot}
          )
        `;

        const resolved = yield* tickets.resolveRef("Acme/App#7");
        assert.deepStrictEqual([resolved.kind, resolved.id], ["github", ticketId]);

        const edit = yield* tickets
          .update({ ticketId, expectedRevision: 1, title: "Mine now" }, USER)
          .pipe(Effect.flip);
        const remove = yield* tickets.delete({ ticketId }).pipe(Effect.flip);
        assert.deepStrictEqual(
          [edit.message, remove.message],
          [
            "GitHub tickets are read only here: edit the issue on GitHub.",
            "GitHub tickets cannot be deleted; stop tracking the issue instead.",
          ],
        );

        const moved = yield* tickets.move(
          { ticketId, expectedRevision: 1, statusId: status("in_progress"), sortKey: "a0" },
          USER,
        );
        assert.strictEqual(moved.statusId, "in_progress");
      }),
    ),
  );
});
