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
  TicketPlanCommentId,
  TicketPlanId,
  TicketStatusId,
  type TicketActor,
  type TicketDetail,
  type TicketListEvent,
  type TicketPlan,
  type TicketPlanUpdateInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { vi } from "vite-plus/test";

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
  it.effect("streams only the thread links that later writes add", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const first = (yield* tickets.create(
          { title: "Existing", links: [{ kind: "thread", threadId: ThreadId.make("existing") }] },
          USER,
        )).ticket;
        const seen = yield* Queue.unbounded<ReadonlyArray<ThreadId>>();
        yield* (yield* tickets.subscribeThreadLinks).pipe(
          Stream.runForEach((ids) => Queue.offer(seen, ids)),
          Effect.forkScoped,
        );
        const linked = ThreadId.make("linked-thread");
        yield* tickets.link(
          { ticketId: first.id, target: { kind: "thread", threadId: linked } },
          USER,
        );
        assert.deepStrictEqual(yield* Queue.take(seen), [linked]);
        const created = ThreadId.make("created-thread");
        yield* tickets.create(
          { title: "Created", links: [{ kind: "thread", threadId: created }] },
          USER,
        );
        assert.deepStrictEqual(yield* Queue.take(seen), [created]);
      }).pipe(Effect.scoped),
    ),
  );
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

describe("TicketService plans", () => {
  const agent = { type: "agent", threadId: ThreadId.make("thread-7") } as const;

  const stageUpload = (name: string, text: string) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      NodeFS.mkdirSync(config.attachmentsDir, { recursive: true });
      const id = ChatAttachmentId.make(createPendingAttachmentId(".txt"));
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.txt`), text);
      return {
        type: "file",
        id,
        name,
        mimeType: "text/plain",
        sizeBytes: text.length,
      } as const;
    });

  it.effect("stores Draft on every new plan and changes review metadata without revisions", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Review" }, USER)).ticket.id;
        const created = (yield* tickets.createPlan({ ticketId, title: "Plan" }, USER)).plan;
        const agentCreated = (yield* tickets.createPlan({ ticketId, title: "Alternative" }, agent))
          .plan;
        assert.deepStrictEqual(
          [created, agentCreated, ...(yield* tickets.listPlans(ticketId))].map((plan) => [
            plan.status,
            plan.reviewStatus,
            plan.revision,
          ]),
          Array.from({ length: 4 }, () => ["active", "draft", 1]),
        );
        const { planId } = created;
        yield* TestClock.adjust("1 minute");
        const ready = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, reviewStatus: "ready" },
          USER,
        )).plan;
        yield* TestClock.adjust("1 minute");
        const repeated = (yield* tickets.updatePlan(
          { planId, expectedRevision: 99, reviewStatus: "ready" },
          agent,
        )).plan;
        const draft = (yield* tickets.updatePlan(
          { planId, expectedRevision: 99, reviewStatus: "draft" },
          agent,
        )).plan;
        yield* TestClock.adjust("1 minute");
        const draftAgain = (yield* tickets.updatePlan(
          { planId, expectedRevision: 99, reviewStatus: "draft" },
          USER,
        )).plan;
        assert.deepStrictEqual(repeated, ready);
        assert.deepStrictEqual(draftAgain, draft);
        assert.deepStrictEqual(
          [ready, draft, (yield* tickets.getPlan(planId)).summary].map((plan) => [
            plan.reviewStatus,
            plan.revision,
            plan.updatedBy,
            plan.updatedAt,
          ]),
          [
            ["ready", 1, USER, "1970-01-01T00:01:00.000Z"],
            ["draft", 1, agent, "1970-01-01T00:02:00.000Z"],
            ["draft", 1, agent, "1970-01-01T00:02:00.000Z"],
          ],
        );
        const detail = yield* tickets.get(ticketId);
        assert.deepStrictEqual(
          [detail.summary.revision, detail.summary.updatedAt],
          [1, "1970-01-01T00:02:00.000Z"],
        );
        assert.deepStrictEqual(
          detail.activity
            .filter((activity) => activity.entry.type === "plan_review_status_changed")
            .map((activity) => [activity.actor, activity.entry]),
          [
            [
              USER,
              { type: "plan_review_status_changed", planId, number: 1, from: "draft", to: "ready" },
            ],
            [
              agent,
              { type: "plan_review_status_changed", planId, number: 1, from: "ready", to: "draft" },
            ],
          ],
        );
      }),
    ),
  );

  it.effect("receipts describe changed content, exact and stale no-ops, and mixed updates", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Receipt" }, USER)).ticket.id;
        const created = yield* tickets.createPlan({ ticketId, title: "Title", body: "Body" }, USER);
        assert.strictEqual(created.contentCommit, undefined);
        const { planId } = created.plan;
        const title = yield* tickets.updatePlan(
          { planId, expectedRevision: 1, title: "New title" },
          USER,
        );
        assert.deepStrictEqual(title.contentCommit, { observedRevision: 1, revision: 2 });
        const body = yield* tickets.updatePlan(
          { planId, expectedRevision: 2, body: "New body" },
          USER,
        );
        assert.deepStrictEqual(body.contentCommit, { observedRevision: 2, revision: 3 });
        const before = yield* tickets.get(ticketId);
        for (const expectedRevision of [1, 3]) {
          for (const fields of [{ title: "New title" }, { body: "New body" }]) {
            const noop = yield* tickets.updatePlan({ planId, expectedRevision, ...fields }, USER);
            assert.deepStrictEqual(noop.contentCommit, { observedRevision: 3, revision: 3 });
            assert.deepStrictEqual(noop.plan, body.plan);
          }
        }
        assert.deepStrictEqual(yield* tickets.get(ticketId), before);
        const ready = yield* tickets.updatePlan(
          { planId, expectedRevision: 3, reviewStatus: "ready" },
          USER,
        );
        const draft = yield* tickets.updatePlan(
          { planId, expectedRevision: 1, reviewStatus: "draft" },
          agent,
        );
        assert.deepStrictEqual(
          [ready.contentCommit, draft.contentCommit],
          [
            { observedRevision: 3, revision: 3 },
            { observedRevision: 3, revision: 3 },
          ],
        );
        const upload = yield* stageUpload("receipt.txt", "Attached");
        const mixed = yield* tickets.updatePlan(
          {
            planId,
            expectedRevision: 3,
            title: "Final title",
            body: `Final vetra-attachment://${upload.id}`,
            attachments: [upload],
            reviewStatus: "ready",
          },
          USER,
        );
        assert.deepStrictEqual(mixed.contentCommit, { observedRevision: 3, revision: 4 });
        assert.strictEqual(mixed.plan.reviewStatus, "ready");
        assert.strictEqual(mixed.attachments.length, 1);
        const stored = yield* tickets.getPlan(planId);
        assert.deepStrictEqual(stored.summary, mixed.plan);
        assert.strictEqual(
          stored.body,
          `Final vetra-attachment://${mixed.attachments[0]?.attachmentId}`,
        );
        const retry = yield* tickets.updatePlan(
          {
            planId,
            expectedRevision: 3,
            title: "Final title",
            body: stored.body,
            reviewStatus: "ready",
          },
          USER,
        );
        assert.deepStrictEqual(retry.contentCommit, { observedRevision: 4, revision: 4 });
        assert.deepStrictEqual(retry.plan, mixed.plan);
      }),
    ),
  );

  it.effect("keeps the committed receipt when another writer changes the later summary", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Interleaved receipt" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Title", body: "Before" },
          USER,
        )).plan;
        const sql = yield* SqlClient.SqlClient;
        const committed = yield* Deferred.make<void>();
        const resume = yield* Deferred.make<void>();
        const withTransaction = sql.withTransaction;
        let pauseNext = true;
        const gatedTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          withTransaction(effect).pipe(
            Effect.tap(() => {
              if (!pauseNext) return Effect.void;
              pauseNext = false;
              return Deferred.succeed(committed, undefined).pipe(
                Effect.andThen(Deferred.await(resume)),
              );
            }),
          );
        const gate = vi.spyOn(sql, "withTransaction").mockImplementation(gatedTransaction);
        yield* Effect.addFinalizer(() => Effect.sync(() => gate.mockRestore()));
        const local = yield* tickets
          .updatePlan({ planId, expectedRevision: 1, body: "Local" }, USER)
          .pipe(Effect.forkScoped);
        yield* Deferred.await(committed);
        const remote = yield* tickets.updatePlan(
          { planId, expectedRevision: 2, body: "Remote" },
          agent,
        );
        yield* Deferred.succeed(resume, undefined);
        const reply = yield* Fiber.join(local);
        assert.deepStrictEqual(reply.contentCommit, { observedRevision: 1, revision: 2 });
        assert.deepStrictEqual(remote.contentCommit, { observedRevision: 2, revision: 3 });
        assert.deepStrictEqual(reply.plan, remote.plan);
        assert.strictEqual((yield* tickets.getPlan(planId)).body, "Remote");
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("rejects stale Ready requests before changing content, comments or attachments", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const ticketId = (yield* tickets.create({ title: "Review" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Plan", body: "Original" },
          USER,
        )).plan;
        const comment = yield* tickets.addPlanComment({ planId, body: "Review this" }, USER);
        yield* tickets.updatePlan({ planId, expectedRevision: 1, body: "Remote content" }, agent);
        const before = yield* tickets.getPlan(planId);
        const ticketBefore = yield* tickets.get(ticketId);
        const upload = yield* stageUpload("rejected.txt", "rejected");
        const requests = [
          { reviewStatus: "ready" },
          {
            reviewStatus: "ready",
            status: "archived",
            title: "Unreviewed title",
            body: `Unreviewed vetra-attachment://${upload.id}`,
            attachments: [upload],
            resolveCommentIds: [comment.id],
          },
          { reviewStatus: "ready", edits: [{ find: "Missing", replace: "Ignored" }] },
        ] satisfies ReadonlyArray<Omit<TicketPlanUpdateInput, "planId" | "expectedRevision">>;
        const errors = yield* Effect.forEach(requests, (fields) =>
          tickets.updatePlan({ planId, expectedRevision: 1, ...fields }, USER).pipe(
            Effect.flip,
            Effect.map((error) =>
              error._tag === "TicketPlanRevisionConflictError"
                ? [error._tag, error.expectedRevision, error.actualRevision]
                : error._tag,
            ),
          ),
        );
        assert.deepStrictEqual(
          errors,
          Array.from({ length: 3 }, () => ["TicketPlanRevisionConflictError", 1, 2]),
        );
        assert.deepStrictEqual(yield* tickets.getPlan(planId), before);
        assert.deepStrictEqual(yield* tickets.get(ticketId), ticketBefore);
        assert.deepStrictEqual(
          NodeFS.readdirSync(config.attachmentsDir).filter((name) =>
            name.startsWith(`ticket-${ticketId}-`),
          ),
          [],
        );
        const ready = (yield* tickets.updatePlan(
          { planId, expectedRevision: 2, reviewStatus: "ready" },
          USER,
        )).plan;
        assert.deepStrictEqual([ready.reviewStatus, ready.revision], ["ready", 2]);
        const reverseWithStaleContent = yield* tickets
          .updatePlan({ planId, expectedRevision: 1, reviewStatus: "draft", title: "Lost" }, agent)
          .pipe(Effect.flip);
        assert.strictEqual(reverseWithStaleContent._tag, "TicketPlanRevisionConflictError");
        assert.deepStrictEqual((yield* tickets.getPlan(planId)).summary, ready);
      }),
    ),
  );

  it.effect(
    "protects stale saves with known content when the requested field already matches",
    () =>
      withTickets((tickets) =>
        Effect.gen(function* () {
          const ticketId = (yield* tickets.create({ title: "Review lineage" }, USER)).ticket.id;
          const { planId } = (yield* tickets.createPlan(
            { ticketId, title: "Before title", body: "Before body" },
            USER,
          )).plan;
          yield* tickets.updatePlan(
            { planId, expectedRevision: 1, title: "Reviewed title", body: "Unreviewed body" },
            agent,
          );
          const unguarded = (yield* tickets.updatePlan(
            { planId, expectedRevision: 1, title: "Reviewed title" },
            USER,
          )).plan;
          assert.deepStrictEqual(
            [unguarded.title, unguarded.revision, unguarded.reviewStatus],
            ["Reviewed title", 2, "draft"],
          );
          const titleGuard = yield* tickets
            .updatePlan(
              { planId, expectedRevision: 1, title: "Reviewed title", body: "Before body" },
              USER,
            )
            .pipe(Effect.flip);
          assert.strictEqual(titleGuard._tag, "TicketPlanRevisionConflictError");
          const protectedTitle = yield* tickets.getPlan(planId);
          assert.deepStrictEqual(
            [protectedTitle.summary, protectedTitle.body],
            [unguarded, "Unreviewed body"],
          );
          const second = (yield* tickets.createPlan(
            { ticketId, title: "Known title", body: "Before body" },
            USER,
          )).plan;
          yield* tickets.updatePlan(
            {
              planId: second.planId,
              expectedRevision: 1,
              title: "Unreviewed title",
              body: "Reviewed body",
            },
            agent,
          );
          const unguardedBody = (yield* tickets.updatePlan(
            { planId: second.planId, expectedRevision: 1, body: "Reviewed body" },
            USER,
          )).plan;
          assert.deepStrictEqual(
            [unguardedBody.title, unguardedBody.revision, unguardedBody.reviewStatus],
            ["Unreviewed title", 2, "draft"],
          );
          const bodyGuard = yield* tickets
            .updatePlan(
              {
                planId: second.planId,
                expectedRevision: 1,
                title: "Known title",
                body: "Reviewed body",
              },
              USER,
            )
            .pipe(Effect.flip);
          assert.strictEqual(bodyGuard._tag, "TicketPlanRevisionConflictError");
          const protectedBody = yield* tickets.getPlan(second.planId);
          assert.deepStrictEqual(
            [
              protectedBody.summary.title,
              protectedBody.body,
              protectedBody.summary.revision,
              protectedBody.summary.reviewStatus,
            ],
            ["Unreviewed title", "Reviewed body", 2, "draft"],
          );
        }),
      ),
  );

  it.effect(
    "atomically edits, marks Ready and resolves comments, and rolls back invalid requests",
    () =>
      withTickets((tickets) =>
        Effect.gen(function* () {
          const ticketId = (yield* tickets.create({ title: "Combined review" }, USER)).ticket.id;
          const { planId } = (yield* tickets.createPlan(
            { ticketId, title: "Draft title", body: "Before" },
            USER,
          )).plan;
          const comment = yield* tickets.addPlanComment({ planId, body: "Change it" }, USER);
          const failed = yield* tickets
            .updatePlan(
              {
                planId,
                expectedRevision: 1,
                body: "After",
                status: "archived",
                reviewStatus: "ready",
                resolveCommentIds: [TicketPlanCommentId.make("missing")],
              },
              agent,
            )
            .pipe(Effect.flip);
          assert.strictEqual(failed._tag, "TicketError");
          const before = yield* tickets.getPlan(planId);
          assert.deepStrictEqual(
            [
              before.summary.reviewStatus,
              before.summary.status,
              before.summary.revision,
              before.body,
            ],
            ["draft", "active", 1, "Before"],
          );
          const updated = (yield* tickets.updatePlan(
            {
              planId,
              expectedRevision: 1,
              title: "Reviewed title",
              edits: [{ find: "Before", replace: "After" }],
              reviewStatus: "ready",
              resolveCommentIds: [comment.id],
            },
            agent,
          )).plan;
          const stored = yield* tickets.getPlan(planId);
          assert.deepStrictEqual(
            [
              updated.title,
              updated.reviewStatus,
              updated.revision,
              updated.openCommentCount,
              stored.body,
            ],
            ["Reviewed title", "ready", 2, 0, "After"],
          );
          assert.deepStrictEqual(stored.summary, updated);
          assert.deepStrictEqual(
            stored.comments.map((entry) => entry.resolvedBy),
            [agent],
          );
          assert.strictEqual((yield* tickets.get(ticketId)).summary.revision, 1);
        }),
      ),
  );

  it.effect("retains Ready through edits and archive lifecycle, with archived review changes", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Sticky review" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Plan", body: "Before" },
          USER,
        )).plan;
        yield* tickets.updatePlan({ planId, expectedRevision: 1, reviewStatus: "ready" }, USER);
        const renamed = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, title: "Edited title" },
          agent,
        )).plan;
        const edited = (yield* tickets.updatePlan(
          { planId, expectedRevision: 2, body: "After" },
          agent,
        )).plan;
        const archived = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, status: "archived" },
          USER,
        )).plan;
        const draft = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, reviewStatus: "draft" },
          agent,
        )).plan;
        const stale = yield* tickets
          .updatePlan({ planId, expectedRevision: 1, reviewStatus: "ready" }, USER)
          .pipe(Effect.flip);
        const readOnly = yield* tickets
          .updatePlan({ planId, expectedRevision: 3, reviewStatus: "ready", body: "Lost" }, USER)
          .pipe(Effect.flip);
        const ready = (yield* tickets.updatePlan(
          { planId, expectedRevision: 3, reviewStatus: "ready" },
          USER,
        )).plan;
        const restored = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, status: "active" },
          agent,
        )).plan;
        assert.deepStrictEqual(
          [renamed, edited, archived, draft, ready, restored].map((plan) => [
            plan.status,
            plan.reviewStatus,
            plan.revision,
          ]),
          [
            ["active", "ready", 2],
            ["active", "ready", 3],
            ["archived", "ready", 3],
            ["archived", "draft", 3],
            ["archived", "ready", 3],
            ["active", "ready", 3],
          ],
        );
        assert.deepStrictEqual(
          [stale._tag, readOnly.message, (yield* tickets.getPlan(planId)).body],
          [
            "TicketPlanRevisionConflictError",
            "T-1/P1 is archived. Restore it before editing it.",
            "After",
          ],
        );
      }),
    ),
  );

  it.effect(
    "publishes review transitions through ticket and plan streams and reconnect snapshots",
    () =>
      withTickets((tickets) =>
        Effect.gen(function* () {
          const ticketId = (yield* tickets.create({ title: "Live review" }, USER)).ticket.id;
          const { planId } = (yield* tickets.createPlan({ ticketId, title: "Plan" }, USER)).plan;
          const plans = yield* Queue.unbounded<TicketPlan>();
          const details = yield* Queue.unbounded<TicketDetail>();
          const lists = yield* Queue.unbounded<TicketListEvent>();
          yield* tickets.subscribePlan(planId).pipe(
            Stream.runForEach((plan) => Queue.offer(plans, plan)),
            Effect.forkScoped,
          );
          yield* tickets.subscribeDetail(ticketId).pipe(
            Stream.runForEach((detail) => Queue.offer(details, detail)),
            Effect.forkScoped,
          );
          yield* tickets.subscribeList().pipe(
            Stream.runForEach((event) => Queue.offer(lists, event)),
            Effect.forkScoped,
          );
          assert.strictEqual((yield* Queue.take(plans)).summary.reviewStatus, "draft");
          assert.strictEqual((yield* Queue.take(details)).summary.plans[0]?.reviewStatus, "draft");
          const snapshot = yield* Queue.take(lists);
          assert.deepStrictEqual(
            snapshot.type === "snapshot"
              ? snapshot.tickets[0]?.plans[0]?.reviewStatus
              : snapshot.type,
            "draft",
          );
          for (const reviewStatus of ["ready", "draft"] as const) {
            yield* tickets.updatePlan({ planId, expectedRevision: 1, reviewStatus }, agent);
            const plan = yield* Queue.take(plans);
            const detail = yield* Queue.take(details);
            yield* TestClock.adjust("50 millis");
            const delta = yield* Queue.take(lists);
            assert.deepStrictEqual(
              [
                plan.summary.reviewStatus,
                plan.summary.revision,
                detail.summary.plans[0]?.reviewStatus,
                detail.summary.revision,
                detail.activity.at(-1)?.entry,
                delta.type === "delta" ? delta.upserted[0]?.plans[0]?.reviewStatus : delta.type,
              ],
              [
                reviewStatus,
                1,
                reviewStatus,
                1,
                {
                  type: "plan_review_status_changed",
                  planId,
                  number: 1,
                  from: reviewStatus === "ready" ? "draft" : "ready",
                  to: reviewStatus,
                },
                reviewStatus,
              ],
            );
            const reconnect = yield* tickets
              .subscribePlan(planId)
              .pipe(Stream.take(1), Stream.runCollect);
            assert.strictEqual(reconnect[0]?.summary.reviewStatus, reviewStatus);
          }
        }).pipe(Effect.scoped),
      ),
  );

  it.effect(
    "restores, edits and resolves comments together, and rolls all changes back on failure",
    () =>
      withTickets((tickets) =>
        Effect.gen(function* () {
          const ticketId = (yield* tickets.create({ title: "Ticket" }, USER)).ticket.id;
          const { planId } = (yield* tickets.createPlan(
            { ticketId, title: "Plan", body: "Before" },
            USER,
          )).plan;
          const comment = yield* tickets.addPlanComment({ planId, body: "Change this" }, USER);
          yield* tickets.updatePlan({ planId, expectedRevision: 1, status: "archived" }, USER);
          const stale = yield* tickets
            .updatePlan({ planId, expectedRevision: 2, status: "active", body: "After" }, USER)
            .pipe(Effect.flip);
          const unmatched = yield* tickets
            .updatePlan(
              {
                planId,
                expectedRevision: 1,
                status: "active",
                edits: [{ find: "Missing", replace: "After" }],
              },
              USER,
            )
            .pipe(Effect.flip);
          const invalidComment = yield* tickets
            .updatePlan(
              {
                planId,
                expectedRevision: 1,
                status: "active",
                body: "After",
                resolveCommentIds: [TicketPlanCommentId.make("missing")],
              },
              USER,
            )
            .pipe(Effect.flip);
          const unchanged = yield* tickets.getPlan(planId);
          assert.deepStrictEqual(
            [
              stale._tag,
              unmatched._tag,
              invalidComment._tag,
              unchanged.summary.status,
              unchanged.body,
              unchanged.summary.revision,
              unchanged.summary.openCommentCount,
            ],
            [
              "TicketPlanRevisionConflictError",
              "TicketError",
              "TicketError",
              "archived",
              "Before",
              1,
              1,
            ],
          );
          const updated = (yield* tickets.updatePlan(
            {
              planId,
              expectedRevision: 1,
              status: "active",
              edits: [{ find: "Before", replace: "After" }],
              resolveCommentIds: [comment.id],
            },
            agent,
          )).plan;
          const stored = yield* tickets.getPlan(planId);
          assert.deepStrictEqual(
            [updated.status, updated.revision, updated.openCommentCount, stored.body],
            ["active", 2, 0, "After"],
          );
        }),
      ),
  );

  it.effect("refreshes every plan referencing an attachment removed from its ticket", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const upload = yield* stageUpload("shared.txt", "shared");
        const created = yield* tickets.create(
          { title: "Shared file", attachments: [upload] },
          USER,
        );
        const attachmentId = created.attachments[0]!.attachmentId;
        const body = `See vetra-attachment://${attachmentId}`;
        const first = (yield* tickets.createPlan(
          { ticketId: created.ticket.id, title: "First", body },
          USER,
        )).plan;
        const second = (yield* tickets.createPlan(
          { ticketId: created.ticket.id, title: "Second", body },
          USER,
        )).plan;
        const seen = yield* Queue.unbounded<[string, number, number]>();
        yield* Effect.forEach([first, second], (plan) =>
          tickets.subscribePlan(plan.planId).pipe(
            Stream.runForEach((current) =>
              Queue.offer(seen, [
                current.summary.ref,
                current.attachments.length,
                current.summary.revision,
              ]),
            ),
            Effect.forkScoped,
          ),
        );
        assert.deepStrictEqual((yield* Effect.all([Queue.take(seen), Queue.take(seen)])).sort(), [
          ["T-1/P1", 1, 1],
          ["T-1/P2", 1, 1],
        ]);
        yield* tickets.update(
          { ticketId: created.ticket.id, expectedRevision: 1, removeAttachmentIds: [attachmentId] },
          USER,
        );
        assert.deepStrictEqual((yield* Effect.all([Queue.take(seen), Queue.take(seen)])).sort(), [
          ["T-1/P1", 0, 1],
          ["T-1/P2", 0, 1],
        ]);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("pushes replies to the plan's readers without a ticket list delta", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Review" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan({ ticketId, title: "Plan" }, USER)).plan;
        const question = yield* tickets.addPlanComment({ planId, body: "Question" }, USER);
        const lists = yield* Queue.unbounded<TicketListEvent>();
        const plans = yield* Queue.unbounded<void>();
        yield* tickets.subscribeList().pipe(
          Stream.runForEach((event) => Queue.offer(lists, event)),
          Effect.forkScoped,
        );
        yield* tickets.subscribePlan(planId).pipe(
          Stream.runForEach(() => Queue.offer(plans, undefined)),
          Effect.forkScoped,
        );
        yield* Queue.take(lists);
        yield* Queue.take(plans);

        const reply = yield* tickets.addPlanComment(
          { planId, body: "Answer", parentCommentId: question.id },
          USER,
        );
        yield* Queue.take(plans);
        yield* tickets.deletePlanComment({ planId, commentId: reply.id });
        yield* Queue.take(plans);
        yield* TestClock.adjust("50 millis");
        yield* tickets.addPlanComment({ planId, body: "Another question" }, USER);
        yield* TestClock.adjust("50 millis");
        const delta = yield* Queue.take(lists);
        assert.deepStrictEqual(
          delta.type === "delta"
            ? delta.upserted.map((ticket) => ticket.plans.map((plan) => plan.openCommentCount))
            : delta.type,
          [[2]],
        );
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("numbers plans per ticket, never reuses a number, and lists them on the summary", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const first = (yield* tickets.create({ title: "First" }, USER)).ticket;
        const second = (yield* tickets.create({ title: "Second" }, USER)).ticket;
        const plan = (ticketId: TicketId, title: string) =>
          tickets.createPlan({ ticketId, title }, USER).pipe(Effect.map((result) => result.plan));

        yield* plan(first.id, "Schema");
        const dropped = yield* plan(first.id, "Dropped");
        yield* tickets.deletePlan({ planId: dropped.planId }, USER);
        yield* plan(first.id, "Rollout");
        yield* plan(second.id, "Elsewhere");

        const describePlans = (summary: { plans: ReadonlyArray<TicketPlan["summary"]> }) =>
          summary.plans.map((entry) => [entry.ref, entry.title, entry.status, entry.revision]);
        assert.deepStrictEqual(describePlans(yield* tickets.resolveRef("T-1")), [
          ["T-1/P1", "Schema", "active", 1],
          ["T-1/P3", "Rollout", "active", 1],
        ]);
        assert.deepStrictEqual(describePlans({ plans: yield* tickets.listPlans(second.id) }), [
          ["T-2/P1", "Elsewhere", "active", 1],
        ]);
        const missing = yield* tickets
          .createPlan({ ticketId: TicketId.make("nope"), title: "Orphan" }, USER)
          .pipe(Effect.flip);
        assert.strictEqual(missing._tag, "TicketNotFoundError");
      }),
    ),
  );

  it.effect("checks the plan's own revision and leaves the ticket's revision alone", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticket = (yield* tickets.create({ title: "Ship plans" }, USER)).ticket;
        const { planId } = (yield* tickets.createPlan(
          { ticketId: ticket.id, title: "Approach" },
          agent,
        )).plan;
        yield* TestClock.adjust("1 minute");
        const renamed = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, title: "Approach B" },
          agent,
        )).plan;
        const stale = yield* tickets
          .updatePlan({ planId, expectedRevision: 1, body: "Lost" }, agent)
          .pipe(Effect.flip);
        const sameTitle = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, title: "Approach B" },
          agent,
        )).plan;
        const archived = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, status: "archived" },
          agent,
        )).plan;
        const afterPlanWrites = yield* tickets.resolveRef("T-1");
        const userEdit = (yield* tickets.update(
          { ticketId: ticket.id, expectedRevision: 1, body: "My notes" },
          USER,
        )).ticket;

        assert.deepStrictEqual(
          [
            renamed.revision,
            stale._tag === "TicketPlanRevisionConflictError"
              ? [stale.expectedRevision, stale.actualRevision]
              : stale._tag,
            sameTitle.revision,
            [archived.status, archived.revision],
            [afterPlanWrites.revision, afterPlanWrites.updatedAt],
            userEdit.revision,
          ],
          [2, [1, 2], 2, ["archived", 2], [1, "1970-01-01T00:01:00.000Z"], 2],
        );
      }),
    ),
  );

  it.effect("archives, restores and resolves on any revision without bumping it", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Status" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Plan", body: "Steps" },
          USER,
        )).plan;
        yield* tickets.updatePlan({ planId, expectedRevision: 1, body: "New steps" }, USER);
        const question = yield* tickets.addPlanComment({ planId, body: "Why?" }, USER);
        const reply = yield* tickets.addPlanComment(
          { planId, body: "Because.", parentCommentId: question.id },
          agent,
        );
        type Fields = Pick<TicketPlanUpdateInput, "status" | "resolveCommentIds">;
        const write = (fields: Fields) =>
          tickets.updatePlan({ planId, expectedRevision: 1, ...fields }, agent);
        const failure = (fields: Fields) =>
          write(fields).pipe(
            Effect.flip,
            Effect.map((error) => (error._tag === "TicketError" ? error.message : error._tag)),
          );

        const archived = (yield* write({ status: "archived" })).plan;
        const archivedAgain = (yield* write({ status: "archived" })).plan;
        const resolved = (yield* write({ resolveCommentIds: [question.id] })).plan;
        const resolvedAgain = (yield* write({ resolveCommentIds: [question.id] })).plan;
        const errors = [
          yield* failure({ resolveCommentIds: [reply.id] }),
          yield* failure({ resolveCommentIds: [TicketPlanCommentId.make("missing")] }),
          yield* tickets
            .updatePlan(
              { planId: TicketPlanId.make("missing"), expectedRevision: 1, status: "active" },
              agent,
            )
            .pipe(
              Effect.flip,
              Effect.map((error) => error._tag),
            ),
        ];
        const restored = (yield* write({ status: "active" })).plan;
        const plan = yield* tickets.getPlan(planId);

        assert.deepStrictEqual(
          [
            [archived, archivedAgain, resolved, resolvedAgain, restored].map((summary) => [
              summary.status,
              summary.revision,
              summary.openCommentCount,
            ]),
            errors,
            plan.comments.map((comment) => comment.resolvedBy),
            (yield* tickets.get(ticketId)).activity.map((activity) => [
              activity.actor.type,
              activity.entry.type,
            ]),
          ],
          [
            [
              ["archived", 2, 1],
              ["archived", 2, 1],
              ["archived", 2, 0],
              ["archived", 2, 0],
              ["active", 2, 0],
            ],
            [
              `Comment ${reply.id} is a reply; resolve the comment it replies to.`,
              "Comment missing is not on this plan.",
              "TicketPlanNotFoundError",
            ],
            [agent, null],
            [
              ["user", "created"],
              ["user", "plan_created"],
              ["user", "plan_edited"],
              ["agent", "plan_archived"],
              ["agent", "plan_restored"],
            ],
          ],
        );
      }),
    ),
  );

  it.effect("keeps an archived plan's title and body read-only until it is restored", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Retired" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Old", body: "Old steps" },
          agent,
        )).plan;
        const comment = yield* tickets.addPlanComment({ planId, body: "Still wrong" }, USER);
        yield* tickets.updatePlan({ planId, expectedRevision: 1, status: "archived" }, USER);
        const upload = yield* stageUpload("notes.txt", "notes");

        const refusals = yield* Effect.forEach(
          [
            { title: "New" },
            { body: "New steps" },
            { edits: [{ find: "Old", replace: "New" }] },
            { attachments: [upload] },
          ],
          (fields) =>
            tickets.updatePlan({ planId, expectedRevision: 1, ...fields }, agent).pipe(
              Effect.flip,
              Effect.map((error) => (error._tag === "TicketError" ? error.message : error._tag)),
            ),
        );
        const resolved = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, resolveCommentIds: [comment.id] },
          agent,
        )).plan;
        yield* tickets.updatePlan({ planId, expectedRevision: 1, status: "active" }, USER);
        const restored = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, title: "New" },
          agent,
        )).plan;

        assert.deepStrictEqual(
          [refusals, resolved.openCommentCount, [restored.title, restored.revision]],
          [Array(4).fill("T-1/P1 is archived. Restore it before editing it."), 0, ["New", 2]],
        );
      }),
    ),
  );

  it.effect("applies find-and-replace edits and leaves the plan untouched when one fails", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Edits" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Steps", body: "Step one\nStep two" },
          agent,
        )).plan;
        const failed = yield* tickets
          .updatePlan(
            {
              planId,
              expectedRevision: 1,
              edits: [
                { find: "one", replace: "1" },
                { find: "Step", replace: "Stage" },
              ],
            },
            agent,
          )
          .pipe(Effect.flip);
        const both = yield* tickets
          .updatePlan(
            { planId, expectedRevision: 1, body: "New", edits: [{ find: "one", replace: "1" }] },
            agent,
          )
          .pipe(Effect.flip);
        yield* tickets.updatePlan(
          { planId, expectedRevision: 1, edits: [{ find: "two", replace: "2" }] },
          agent,
        );
        const stale = yield* tickets
          .updatePlan(
            { planId, expectedRevision: 1, edits: [{ find: "one", replace: "1" }] },
            agent,
          )
          .pipe(Effect.flip);

        const plan = yield* tickets.getPlan(planId);
        assert.deepStrictEqual(
          [failed.message, both.message, stale._tag, plan.body, plan.summary.revision],
          [
            "Edit 2 matched more than once: add surrounding text to its find text so it matches once.",
            "Send a new body or edits, not both.",
            "TicketPlanRevisionConflictError",
            "Step one\nStep 2",
            2,
          ],
        );
      }),
    ),
  );

  it.effect("claims plan uploads onto the ticket and lists only those the body references", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const ticketUpload = yield* stageUpload("ticket.txt", "ticket");
        const ticketId = (yield* tickets.create(
          { title: "With files", attachments: [ticketUpload] },
          USER,
        )).ticket.id;
        yield* TestClock.adjust("1 minute");
        const sketch = yield* stageUpload("sketch.txt", "sketch");
        const created = yield* tickets.createPlan(
          {
            ticketId,
            title: "Design",
            body: `See vetra-attachment://${sketch.id}`,
            attachments: [sketch],
          },
          USER,
        );
        const sketchId = created.attachments[0]!.attachmentId;
        const { planId } = created.plan;

        yield* TestClock.adjust("1 minute");
        const late = yield* stageUpload("late.txt", "late");
        const updated = yield* tickets.updatePlan(
          {
            planId,
            expectedRevision: 1,
            edits: [{ find: "See", replace: `Also vetra-attachment://${late.id}. See` }],
            attachments: [late],
          },
          USER,
        );
        const lateId = updated.attachments[0]!.attachmentId;
        const plan = yield* tickets.getPlan(planId);
        assert.deepStrictEqual(
          [
            sketchId.startsWith(`ticket-${ticketId}-`),
            plan.body,
            plan.attachments.map((attachment) => attachment.name),
          ],
          [
            true,
            `Also vetra-attachment://${lateId}. See vetra-attachment://${sketchId}`,
            ["sketch.txt", "late.txt"],
          ],
        );

        const rejected = yield* stageUpload("rejected.txt", "rejected");
        const stale = yield* tickets
          .updatePlan({ planId, expectedRevision: 1, title: "Lost", attachments: [rejected] }, USER)
          .pipe(Effect.flip);
        const claimedFiles = () =>
          NodeFS.readdirSync(config.attachmentsDir).filter((name) =>
            name.startsWith(`ticket-${ticketId}-`),
          ).length;
        assert.deepStrictEqual(
          [stale._tag, claimedFiles()],
          ["TicketPlanRevisionConflictError", 3],
        );

        yield* tickets.deletePlan({ planId }, agent);
        const detail = yield* tickets.get(ticketId);
        assert.deepStrictEqual(
          [
            detail.summary.plans,
            detail.attachments.map((attachment) => attachment.name),
            claimedFiles(),
            detail.activity.map((activity) => activity.entry.type),
            [detail.activity.at(-1)?.actor, detail.activity.at(-1)?.entry],
          ],
          [
            [],
            ["ticket.txt", "sketch.txt", "late.txt"],
            3,
            [
              "created",
              "attachment_added",
              "plan_created",
              "attachment_added",
              "plan_edited",
              "attachment_added",
              "plan_deleted",
            ],
            [agent, { type: "plan_deleted", planId, number: 1 }],
          ],
        );
      }),
    ),
  );

  it.effect("resolves and reopens top-level comments and keeps replies on their thread", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Review" }, USER)).ticket.id;
        const { planId } = (yield* tickets.createPlan(
          { ticketId, title: "Plan", body: "1. Migrate\n2. Ship" },
          agent,
        )).plan;
        const openCount = () =>
          tickets.getPlan(planId).pipe(Effect.map((plan) => plan.summary.openCommentCount));

        const root = yield* tickets.addPlanComment(
          {
            planId,
            body: "Why migrate first?",
            anchor: {
              quote: { text: "Migrate", prefix: "1. ", suffix: "\n2. Ship" },
              source: "1. Migrate\n2. Ship",
              revision: 1,
            },
          },
          USER,
        );
        const reply = yield* tickets.addPlanComment(
          { planId, body: "It unblocks the rest.", parentCommentId: root.id },
          agent,
        );
        const nested = yield* tickets.addPlanComment(
          { planId, body: "Makes sense.", parentCommentId: reply.id },
          USER,
        );
        const anchoredReply = yield* tickets
          .addPlanComment(
            {
              planId,
              body: "Here",
              parentCommentId: root.id,
              anchor: { source: "2. Ship", revision: 1 },
            },
            USER,
          )
          .pipe(Effect.flip);
        const resolveReply = yield* tickets
          .updatePlan({ planId, expectedRevision: 1, resolveCommentIds: [reply.id] }, USER)
          .pipe(Effect.flip);
        assert.deepStrictEqual(
          [
            [reply.parentId, nested.parentId],
            yield* openCount(),
            anchoredReply.message,
            resolveReply.message,
          ],
          [
            [root.id, root.id],
            1,
            "A reply cannot carry an anchor: it belongs to the comment it replies to.",
            `Comment ${reply.id} is a reply; resolve the comment it replies to.`,
          ],
        );

        const resolved = (yield* tickets.updatePlan(
          { planId, expectedRevision: 1, resolveCommentIds: [root.id] },
          agent,
        )).plan;
        const reopened = yield* tickets.reopenPlanComment({ planId, commentId: root.id });
        const resolvedByEdit = (yield* tickets.updatePlan(
          {
            planId,
            expectedRevision: 1,
            body: "1. Ship\n2. Migrate",
            resolveCommentIds: [root.id],
          },
          agent,
        )).plan;
        const plan = yield* tickets.getPlan(planId);
        assert.deepStrictEqual(
          [
            resolved.openCommentCount,
            reopened.openCommentCount,
            [resolvedByEdit.openCommentCount, resolvedByEdit.revision],
            plan.comments.map((comment) => [
              comment.body,
              comment.anchor?.quote?.text ?? null,
              comment.resolvedBy?.type ?? null,
            ]),
            (yield* tickets.resolveRef("T-1")).revision,
          ],
          [
            0,
            1,
            [0, 2],
            [
              ["Why migrate first?", "Migrate", "agent"],
              ["It unblocks the rest.", null, null],
              ["Makes sense.", null, null],
            ],
            1,
          ],
        );

        yield* tickets.deletePlanComment({ planId, commentId: root.id });
        assert.deepStrictEqual((yield* tickets.getPlan(planId)).comments, []);
      }),
    ),
  );

  it.effect(
    "records plan history and folds one actor's edits to one plan within five minutes",
    () =>
      withTickets((tickets) =>
        Effect.gen(function* () {
          const ticketId = (yield* tickets.create({ title: "History" }, USER)).ticket.id;
          const first = (yield* tickets.createPlan({ ticketId, title: "First" }, USER)).plan;
          const second = (yield* tickets.createPlan({ ticketId, title: "Second" }, USER)).plan;
          let revision = 1;
          const editFirst = (body: string, actor: TicketActor = USER) =>
            tickets.updatePlan({ planId: first.planId, expectedRevision: revision++, body }, actor);

          yield* editFirst("One");
          yield* TestClock.adjust("4 minutes");
          yield* editFirst("Two");
          yield* TestClock.adjust("4 minutes");
          yield* editFirst("Three");
          yield* TestClock.adjust("6 minutes");
          yield* editFirst("Four");
          yield* tickets.updatePlan(
            { planId: second.planId, expectedRevision: 1, body: "Other" },
            USER,
          );
          yield* editFirst("Five", agent);
          yield* tickets.updatePlan(
            { planId: first.planId, expectedRevision: 1, status: "archived" },
            USER,
          );
          const restored = (yield* tickets.updatePlan(
            { planId: first.planId, expectedRevision: 1, status: "active" },
            USER,
          )).plan;

          const p1 = { planId: first.planId, number: 1 };
          const p2 = { planId: second.planId, number: 2 };
          assert.deepStrictEqual(
            (yield* tickets.get(ticketId)).activity.map((activity) => [
              activity.actor.type,
              activity.entry,
              activity.createdAt,
            ]),
            [
              ["user", { type: "created" }, "1970-01-01T00:00:00.000Z"],
              ["user", { type: "plan_created", ...p1 }, "1970-01-01T00:00:00.000Z"],
              ["user", { type: "plan_created", ...p2 }, "1970-01-01T00:00:00.000Z"],
              ["user", { type: "plan_edited", ...p1 }, "1970-01-01T00:08:00.000Z"],
              ["user", { type: "plan_edited", ...p1 }, "1970-01-01T00:14:00.000Z"],
              ["user", { type: "plan_edited", ...p2 }, "1970-01-01T00:14:00.000Z"],
              ["agent", { type: "plan_edited", ...p1 }, "1970-01-01T00:14:00.000Z"],
              ["user", { type: "plan_archived", ...p1 }, "1970-01-01T00:14:00.000Z"],
              ["user", { type: "plan_restored", ...p1 }, "1970-01-01T00:14:00.000Z"],
            ],
          );
          assert.deepStrictEqual([restored.status, restored.revision], ["active", 6]);
        }),
      ),
  );

  it.effect("resolves plan references by ticket number, GitHub issue and plan id", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const local = (yield* tickets.create({ title: "Local" }, USER)).ticket;
        const githubId = TicketId.make("github-ticket");
        const snapshot = encodeSnapshot({
          host: "github.com",
          repository: "acme/app",
          number: 123,
          state: "open",
          stateReason: null,
          author: "octocat",
          assignees: [],
          updatedAt: "2026-10-01T00:00:00.000Z",
          syncedAt: "2026-10-01T00:00:00.000Z",
          url: "https://github.com/acme/app/issues/123",
        });
        yield* sql`
          INSERT INTO tickets (
            ticket_id, number, kind, title, body, labels_json, status_id, sort_key, revision,
            created_by_json, created_at, updated_at, github_host, github_repository,
            github_number, github_snapshot_json
          ) VALUES (
            ${githubId}, 2, 'github', 'Issue title', 'Issue body', '[]', 'todo', 'a1', 1,
            '{"type":"sync"}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
            'github.com', 'acme/app', 123, ${snapshot}
          )
        `;
        const localPlan = (yield* tickets.createPlan({ ticketId: local.id, title: "A" }, USER))
          .plan;
        yield* tickets.createPlan({ ticketId: githubId, title: "B" }, USER);

        const refs = yield* Effect.forEach(
          ["T-1/P1", "Acme/App#123/p1", localPlan.planId],
          (reference) => tickets.resolvePlanRef(reference).pipe(Effect.map((plan) => plan.ref)),
        );
        const missing = yield* tickets.resolvePlanRef("T-1/P9").pipe(Effect.flip);
        const malformed = yield* tickets.resolvePlanRef("T-1").pipe(Effect.flip);
        assert.deepStrictEqual(
          [refs, missing.message, malformed.message],
          [
            ["T-1/P1", "T-2/P1", "T-1/P1"],
            "Plan T-1/P9 was not found.",
            '"T-1" is not a plan reference.',
          ],
        );
      }),
    ),
  );

  it.effect("streams one plan, never for another plan's writes, until its ticket is deleted", () =>
    withTickets((tickets) =>
      Effect.gen(function* () {
        const ticketId = (yield* tickets.create({ title: "Watched" }, USER)).ticket.id;
        const watched = (yield* tickets.createPlan({ ticketId, title: "Watched" }, USER)).plan;
        const other = (yield* tickets.createPlan({ ticketId, title: "Other" }, USER)).plan;
        yield* tickets.addPlanComment({ planId: watched.planId, body: "Before" }, USER);
        const seen = yield* Queue.unbounded<[string, number]>();
        const done = yield* tickets.subscribePlan(watched.planId).pipe(
          Stream.runForEach((plan) =>
            Queue.offer(seen, [plan.summary.title, plan.comments.length]),
          ),
          Effect.flip,
          Effect.forkScoped,
        );

        assert.deepStrictEqual(yield* Queue.take(seen), ["Watched", 1]);
        yield* tickets.updatePlan(
          { planId: other.planId, expectedRevision: 1, title: "Renamed" },
          USER,
        );
        // A subscriber woken by the other plan would emit here, before its wake could merge with
        // the next one.
        yield* Effect.yieldNow;
        yield* tickets.addPlanComment({ planId: watched.planId, body: "After" }, USER);
        assert.deepStrictEqual(yield* Queue.take(seen), ["Watched", 2]);

        yield* tickets.delete({ ticketId });
        assert.strictEqual((yield* Fiber.join(done))._tag, "TicketPlanNotFoundError");
        assert.deepStrictEqual(
          [yield* countRows("ticket_plans"), yield* countRows("ticket_plan_comments")],
          [0, 0],
        );
      }).pipe(Effect.scoped),
    ),
  );
});
