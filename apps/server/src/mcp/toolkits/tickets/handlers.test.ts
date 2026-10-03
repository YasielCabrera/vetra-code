import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  GitHubIssueSnapshot,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TicketId,
  TicketStatusId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as Tool from "effect/unstable/ai/Tool";

import * as ServerConfig from "../../../config.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as TicketGitHub from "../../../ticket/TicketGitHub.ts";
import * as TicketService from "../../../ticket/TicketService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { TicketsToolkitHandlersLive } from "./handlers.ts";
import { TicketsToolkit } from "./tools.ts";

const callerId = ThreadId.make("caller-thread");
const projectId = ProjectId.make("caller-project");
const providerInstanceId = ProviderInstanceId.make("codex");

const layerFor = (caller: { readonly activeRunId: string | null }) =>
  TicketsToolkitHandlersLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment"),
          threadId: callerId,
          providerSessionId: "session",
          providerInstanceId,
          issuedAt: 0,
          capabilities: new Set(["orchestration", "tickets"] as const),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: callerId,
              projectId,
              providerInstanceId,
              activeRunId: caller.activeRunId,
              archivedAt: null,
              deletedAt: null,
            } as OrchestrationV2ThreadShell),
        }),
      ),
    ),
    Layer.provideMerge(TicketService.layer),
    Layer.provideMerge(Layer.mock(TicketGitHub.TicketGitHub)({})),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ticket-tools-" })),
    Layer.provideMerge(NodeServices.layer),
  );

type Tools = (typeof TicketsToolkit)["tools"];

const call = <Name extends keyof Tools & string>(
  name: Name,
  params: Tool.Parameters<Tools[Name]>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* TicketsToolkit;
    const results = yield* toolkit.handle(name, params).pipe(Stream.unwrap, Stream.runCollect);
    return results.at(-1)!.result as Tool.Success<Tools[Name]>;
  });

const failure = <Name extends keyof Tools & string>(
  name: Name,
  params: Tool.Parameters<Tools[Name]>,
) => call(name, params).pipe(Effect.flip);

const AGENT = { type: "agent", threadId: callerId } as const;

const githubSnapshot = Schema.encodeSync(Schema.fromJsonString(GitHubIssueSnapshot))({
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

const seedGitHubTicket = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO tickets (
      ticket_id, number, kind, title, body, labels_json, status_id, sort_key, revision,
      created_by_json, created_at, updated_at, github_host, github_repository,
      github_number, github_snapshot_json
    ) VALUES (
      ${TicketId.make("github-ticket")}, 100, 'github', 'Issue title', 'Issue body', '[]',
      'todo', 'a0', 1, '{"type":"sync"}', '2026-10-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z', 'github.com', 'acme/app', 7, ${githubSnapshot}
    )
  `;
});

describe("TicketsToolkit", () => {
  it.effect("links a created ticket to the calling thread and its project unless told not to", () =>
    Effect.gen(function* () {
      const linked = yield* call("t3_ticket_create", { title: "Flaky login test" });
      const unlinked = yield* call("t3_ticket_create", { title: "Unrelated", linkCaller: false });

      assert.deepStrictEqual(
        [linked.number, linked.statusId, linked.createdBy, linked.linkRefs],
        [
          1,
          "todo",
          AGENT,
          [
            { kind: "project", targetKey: "caller-project" },
            { kind: "thread", targetKey: "caller-thread" },
          ],
        ],
      );
      assert.deepStrictEqual(unlinked.linkRefs, []);
      const listed = yield* call("t3_ticket_list", { threadId: callerId });
      assert.deepStrictEqual(
        listed.tickets.map((ticket) => ticket.title),
        ["Flaky login test"],
      );
    }).pipe(Effect.provide(layerFor({ activeRunId: "run-1" }))),
  );

  it.effect("links analyzer-created tickets only to the recorded source thread and project", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO ticket_drafts (thread_id, source_thread_id, project_id, instruction, created_at)
        VALUES (${callerId}, 'source-thread', ${projectId}, '', '2026-10-01T00:00:00.000Z')
      `;
      const linked = yield* call("t3_ticket_create", { title: "Captured selection" });
      const withoutCaller = yield* call("t3_ticket_create", {
        title: "Another captured selection",
        linkCaller: false,
        links: [{ kind: "thread", threadId: callerId }],
      });

      for (const ticket of [linked, withoutCaller]) {
        assert.deepStrictEqual(ticket.linkRefs, [
          { kind: "project", targetKey: "caller-project" },
          { kind: "thread", targetKey: "source-thread" },
        ]);
        assert.deepStrictEqual(ticket.createdBy, AGENT);
      }
      const listed = yield* call("t3_ticket_list", { threadId: callerId });
      assert.deepStrictEqual(listed.tickets, []);
      const sourceTickets = yield* call("t3_ticket_list", {
        threadId: ThreadId.make("source-thread"),
      });
      assert.strictEqual(sourceTickets.tickets.length, 2);
    }).pipe(Effect.provide(layerFor({ activeRunId: "run-1" }))),
  );

  it.effect("updates fields and status in one revision and rejects a stale revision", () =>
    Effect.gen(function* () {
      yield* call("t3_ticket_create", { title: "Draft" });
      const updated = yield* call("t3_ticket_update", {
        ticket: "T-1",
        expectedRevision: 1,
        title: "Renamed",
        status: TicketStatusId.make("in_progress"),
      });
      assert.deepStrictEqual(
        [updated.title, updated.statusId, updated.revision],
        ["Renamed", "in_progress", 2],
      );

      const stale = yield* failure("t3_ticket_update", {
        ticket: "T-1",
        expectedRevision: 1,
        body: "Overwrite",
      });
      assert.deepStrictEqual(
        [stale._tag, stale.message],
        [
          "TicketRevisionConflictError",
          "The ticket changed since it was loaded. Reload it and try again.",
        ],
      );

      const detail = yield* call("t3_ticket_get", { ticket: "T-1" });
      assert.deepStrictEqual(
        [detail.body, detail.activity.map((entry) => entry.entry.type)],
        ["", ["created", "edited", "status_changed"]],
      );
    }).pipe(Effect.provide(layerFor({ activeRunId: "run-1" }))),
  );

  it.effect("refuses to edit a GitHub ticket's issue fields or close its issue", () =>
    Effect.gen(function* () {
      yield* seedGitHubTicket;
      const edit = yield* failure("t3_ticket_update", {
        ticket: "acme/app#7",
        expectedRevision: 1,
        body: "Rewritten",
      });
      const close = yield* failure("t3_ticket_update", {
        ticket: "T-100",
        expectedRevision: 1,
        status: TicketStatusId.make("done"),
      });
      assert.deepStrictEqual(
        [edit.message, close.message],
        [
          "GitHub tickets are read only here: edit the issue on GitHub.",
          "Moving T-100 to a closed status would close its GitHub issue. Agents cannot do that: ask the user to move it in Vetra Code.",
        ],
      );

      const started = yield* call("t3_ticket_update", {
        ticket: "T-100",
        expectedRevision: 1,
        status: TicketStatusId.make("in_progress"),
      });
      assert.strictEqual(started.statusId, "in_progress");
    }).pipe(Effect.provide(layerFor({ activeRunId: "run-1" }))),
  );

  it.effect("reads without an active run but refuses to write", () =>
    Effect.gen(function* () {
      const tickets = yield* TicketService.TicketService;
      yield* tickets.create({ title: "Seeded", labels: ["bug"] }, { type: "user" });

      const listed = yield* call("t3_ticket_list", { status: "open", label: "bug" });
      const detail = yield* call("t3_ticket_get", { ticket: "T-1" });
      const write = yield* failure("t3_ticket_note", { ticket: "T-1", body: "Progress" });

      assert.deepStrictEqual(
        [listed.tickets.map((ticket) => ticket.title), listed.truncated, detail.summary.title],
        [["Seeded"], false, "Seeded"],
      );
      assert.deepStrictEqual(
        [write._tag, write.message],
        ["OrchestratorMcpFailure", "The calling provider no longer owns an active thread run."],
      );
    }).pipe(Effect.provide(layerFor({ activeRunId: null }))),
  );

  it.effect("links what an agent names by ref or URL with a derived URL and placeholder", () =>
    Effect.gen(function* () {
      yield* call("t3_ticket_create", { title: "Fix login", linkCaller: false });
      yield* call("t3_ticket_link", {
        ticket: "T-1",
        target: { kind: "pull_request", url: "https://github.com/Acme/App/pull/12/files" },
      });
      const again = yield* call("t3_ticket_link", {
        ticket: "T-1",
        target: {
          kind: "pull_request",
          ref: { host: "GitHub.com", repository: "ACME/app", number: 12 },
        },
      });
      yield* call("t3_ticket_link", {
        ticket: "T-1",
        target: { kind: "issue", ref: { host: "github.com", repository: "Acme/App", number: 3 } },
      });
      const notPullRequest = yield* failure("t3_ticket_link", {
        ticket: "T-1",
        target: { kind: "pull_request", url: "https://evil.test/acme/app/pull/12" },
      });

      const detail = yield* call("t3_ticket_get", { ticket: "T-1" });
      assert.deepStrictEqual(again.linkRefs, [
        { kind: "pull_request", targetKey: "github.com/acme/app#12" },
      ]);
      assert.deepStrictEqual(
        detail.links.map((link) => link.target),
        [
          {
            kind: "issue",
            ref: { host: "github.com", repository: "acme/app", number: 3 },
            snapshot: {
              title: "Acme/App#3",
              state: "open",
              url: "https://github.com/acme/app/issues/3",
            },
          },
          {
            kind: "pull_request",
            ref: { host: "github.com", repository: "acme/app", number: 12 },
            snapshot: {
              title: "acme/app#12",
              state: "open",
              url: "https://github.com/Acme/App/pull/12/files",
            },
          },
        ],
      );
      assert.strictEqual(
        notPullRequest.message,
        "https://evil.test/acme/app/pull/12 is not a pull request URL.",
      );
    }).pipe(Effect.provide(layerFor({ activeRunId: "run-1" }))),
  );

  it.effect("refuses to link a GitHub ticket to its own issue in any casing", () =>
    Effect.gen(function* () {
      yield* seedGitHubTicket;
      const own = yield* failure("t3_ticket_link", {
        ticket: "T-100",
        target: { kind: "issue", ref: { host: "GitHub.com", repository: "ACME/App", number: 7 } },
      });
      assert.strictEqual(own.message, "A GitHub ticket is already its own issue.");
    }).pipe(Effect.provide(layerFor({ activeRunId: "run-1" }))),
  );
});
