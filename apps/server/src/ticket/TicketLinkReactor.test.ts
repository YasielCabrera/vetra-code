import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ComposerContextId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TicketStatusId,
  type OrchestrationV2DomainEvent,
  type ServerSettings,
  type ThreadPullRequestLink,
  type TicketPlanSummary,
  type TicketSummary,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import * as TicketLinkReactor from "./TicketLinkReactor.ts";
import * as TicketService from "./TicketService.ts";

const USER = { type: "user" } as const;
const THREAD = ThreadId.make("thread-1");
const PROJECT = ProjectId.make("project-1");
const NOW = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const status = TicketStatusId.make;

const ticketsLayer = TicketService.layer.pipe(
  Layer.provideMerge(Layer.mock(TicketGitHub.TicketGitHub)({})),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ticket-links-" })),
  Layer.provideMerge(NodeServices.layer),
);

const withReactor = <A, E>(
  body: (input: {
    readonly tickets: TicketService.TicketService["Service"];
    readonly publish: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
    readonly setAutoAdvance: (
      patch: Partial<ServerSettings["ticketAutoAdvance"]>,
    ) => Effect.Effect<void>;
  }) => Effect.Effect<A, E, TicketService.TicketService | SqlClient.SqlClient>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
      const pulls = yield* Queue.unbounded<void>();
      const settings = yield* Ref.make(DEFAULT_SERVER_SETTINGS);
      const dependencies = Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.fromEffectRepeat(
            Queue.offer(pulls, undefined).pipe(Effect.andThen(Queue.take(events))),
          ),
        }),
        Layer.mock(ServerSettingsService)({ getSettings: Ref.get(settings) }),
      );
      return yield* Effect.gen(function* () {
        const reactor = yield* TicketLinkReactor.make;
        yield* reactor.start();
        return yield* body({
          tickets: yield* TicketService.TicketService,
          publish: (event) =>
            Effect.gen(function* () {
              yield* Queue.take(pulls);
              yield* Queue.offer(events, event);
              yield* Queue.take(pulls);
              yield* Queue.offer(pulls, undefined);
              yield* reactor.drain;
            }),
          setAutoAdvance: (patch) =>
            Ref.update(settings, (current) => ({
              ...current,
              ticketAutoAdvance: { ...current.ticketAutoAdvance, ...patch },
            })),
        });
      }).pipe(Effect.provide(dependencies));
    }),
  ).pipe(Effect.provide(ticketsLayer));

const ticketRecord = (ticket: TicketSummary) => ({
  version: 1 as const,
  kind: "ticket" as const,
  contextId: ComposerContextId.make(`ticket_${ticket.id}`),
  label: `T-${ticket.number} ${ticket.title}`,
  environmentId: EnvironmentId.make("environment-1"),
  ticketId: ticket.id,
  ref: `T-${ticket.number}`,
  title: ticket.title,
  links: [],
});

const planRecord = (ticket: TicketSummary, plan: TicketPlanSummary) => ({
  version: 1 as const,
  kind: "ticket-plan" as const,
  contextId: ComposerContextId.make(`ticket-plan_${plan.planId}`),
  label: `${plan.ref} ${plan.title}`,
  environmentId: EnvironmentId.make("environment-1"),
  ticketId: ticket.id,
  planId: plan.planId,
  ref: plan.ref,
  title: plan.title,
  revision: plan.revision,
  openCommentCount: plan.openCommentCount,
});

const sentMessage = (
  tickets: ReadonlyArray<TicketSummary>,
  id = "message-1",
  records: ReadonlyArray<
    ReturnType<typeof ticketRecord> | ReturnType<typeof planRecord>
  > = tickets.map(ticketRecord),
): OrchestrationV2DomainEvent => ({
  type: "message.updated",
  id: EventId.make(`event:${id}`),
  threadId: THREAD,
  occurredAt: NOW,
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: MessageId.make(id),
    threadId: THREAD,
    runId: null,
    nodeId: null,
    role: "user",
    text: tickets.map((ticket) => `[T-${ticket.number}](vetra-context://v1/ticket/x)`).join(" "),
    context: { version: 1, records },
    attachments: [],
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
});

const pullRequest = (state: "open" | "merged"): ThreadPullRequestLink => ({
  host: "github.com",
  repository: "acme/app",
  number: 7,
  url: "https://github.com/acme/app/pull/7",
  source: "agent",
  linkedAt: "2026-10-01T00:00:00.000Z",
  snapshot: {
    state,
    title: "Fix the login loop",
    headBranch: "fix/login",
    baseBranch: "main",
    isDraft: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
    syncedAt: "2026-10-01T00:00:00.000Z",
  },
  stack: null,
});

const pullRequestsSynced = (
  links: ReadonlyArray<ThreadPullRequestLink>,
): OrchestrationV2DomainEvent => ({
  type: "thread.pull-request-synced",
  id: EventId.make(`event:pr:${links.map((link) => link.snapshot?.state).join(",")}`),
  threadId: THREAD,
  occurredAt: NOW,
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: THREAD,
    projectId: PROJECT,
    title: "Fix login",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "fix/login",
    worktreePath: null,
    pullRequests: links,
    activeProviderThreadId: null,
    lineage: { rootThreadId: THREAD, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  },
});

const githubIssue = (number: number) => ({
  projectId: PROJECT,
  host: "github.com",
  repository: "acme/app",
  issue: {
    number,
    title: "Login loop on GitHub",
    url: `https://github.com/acme/app/issues/${number}`,
    author: null,
    state: "open" as const,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    closedAt: null,
    labels: [],
    assignees: [],
    milestone: null,
    body: "",
  },
});

const linksOf = (ticket: TicketSummary) =>
  ticket.linkRefs.map((ref) => `${ref.kind} ${ref.targetKey}`).toSorted();

describe("TicketLinkReactor", () => {
  it.effect("sending a ticket chip links the thread and moves an open ticket to In progress", () =>
    withReactor(({ tickets, publish }) =>
      Effect.gen(function* () {
        const ticket = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        yield* publish(sentMessage([ticket]));

        const detail = yield* tickets.get(ticket.id);
        assert.deepStrictEqual(
          [detail.summary.statusId, linksOf(detail.summary)],
          ["in_progress", ["thread thread-1"]],
        );
        assert.deepStrictEqual(
          detail.activity.map((activity) => [activity.actor.type, activity.entry.type]),
          [
            ["user", "created"],
            ["automation", "linked"],
            ["automation", "status_changed"],
          ],
        );
        assert.deepStrictEqual(detail.links[0]?.source, "auto");
      }),
    ),
  );

  it.effect("a plan chip links its ticket, once beside that ticket's own chip", () =>
    withReactor(({ tickets, publish }) =>
      Effect.gen(function* () {
        const first = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        const second = (yield* tickets.create({ title: "Logout" }, USER)).ticket;
        const firstPlan = (yield* tickets.createPlan({ ticketId: first.id, title: "SSO" }, USER))
          .plan;
        const secondPlan = (yield* tickets.createPlan({ ticketId: second.id, title: "Undo" }, USER))
          .plan;
        yield* publish(
          sentMessage([], "message-1", [
            ticketRecord(first),
            planRecord(first, firstPlan),
            planRecord(second, secondPlan),
          ]),
        );

        const linkedEntries = (detail: {
          readonly activity: ReadonlyArray<{ entry: { type: string } }>;
        }) => detail.activity.filter((activity) => activity.entry.type === "linked").length;
        const firstAfter = yield* tickets.get(first.id);
        const secondAfter = yield* tickets.get(second.id);
        assert.deepStrictEqual(
          [
            [firstAfter.summary.statusId, linksOf(firstAfter.summary), linkedEntries(firstAfter)],
            [
              secondAfter.summary.statusId,
              linksOf(secondAfter.summary),
              linkedEntries(secondAfter),
            ],
          ],
          [
            ["in_progress", ["thread thread-1"], 1],
            ["in_progress", ["thread thread-1"], 1],
          ],
        );
      }),
    ),
  );

  it.effect("an analyzer thread's chips neither link nor advance the tickets it drafts about", () =>
    withReactor(({ tickets, publish }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO ticket_drafts (thread_id, source_thread_id, project_id, instruction, created_at)
          VALUES (${THREAD}, NULL, ${PROJECT}, 'Follow up on this', '2026-10-01T00:00:00.000Z')
        `;
        const ticket = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        yield* publish(sentMessage([ticket]));

        const after = yield* tickets.resolveRef("T-1");
        assert.deepStrictEqual([after.statusId, linksOf(after)], ["todo", []]);
      }),
    ),
  );

  it.effect("with auto-advance off a sent chip only links", () =>
    withReactor(({ tickets, publish, setAutoAdvance }) =>
      Effect.gen(function* () {
        yield* setAutoAdvance({ enabled: false });
        const ticket = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        yield* publish(sentMessage([ticket]));
        yield* publish(pullRequestsSynced([pullRequest("merged")]));

        const after = yield* tickets.resolveRef("T-1");
        assert.deepStrictEqual(
          [after.statusId, linksOf(after)],
          ["todo", ["pull_request github.com/acme/app#7", "thread thread-1"]],
        );
      }),
    ),
  );

  it.effect("moves only forward and leaves closed tickets alone", () =>
    withReactor(({ tickets, publish }) =>
      Effect.gen(function* () {
        const inReview = (yield* tickets.create(
          { title: "Reviewing", statusId: status("in_review") },
          USER,
        )).ticket;
        const done = (yield* tickets.create({ title: "Shipped", statusId: status("done") }, USER))
          .ticket;
        const backlog = (yield* tickets.create(
          { title: "Someday", statusId: status("backlog") },
          USER,
        )).ticket;
        yield* publish(sentMessage([inReview, done, backlog]));
        yield* publish(sentMessage([inReview, done, backlog], "message-2"));

        const after = yield* Effect.forEach(["T-1", "T-2", "T-3"], tickets.resolveRef);
        assert.deepStrictEqual(
          after.map((ticket) => [ticket.statusId, ticket.revision, linksOf(ticket)]),
          [
            ["in_review", 1, ["thread thread-1"]],
            ["done", 1, ["thread thread-1"]],
            ["in_progress", 2, ["thread thread-1"]],
          ],
        );
      }),
    ),
  );

  it.effect(
    "a pull request on a linked thread links to its tickets and moves them to In review",
    () =>
      withReactor(({ tickets, publish }) =>
        Effect.gen(function* () {
          const ticket = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
          const unrelated = (yield* tickets.create({ title: "Elsewhere" }, USER)).ticket;
          yield* publish(sentMessage([ticket]));
          yield* publish(pullRequestsSynced([pullRequest("open")]));

          const detail = yield* tickets.get(ticket.id);
          assert.deepStrictEqual(
            [detail.summary.statusId, linksOf(detail.summary)],
            ["in_review", ["pull_request github.com/acme/app#7", "thread thread-1"]],
          );
          assert.deepStrictEqual(
            detail.links.find((link) => link.target.kind === "pull_request")?.target,
            {
              kind: "pull_request",
              ref: { host: "github.com", repository: "acme/app", number: 7 },
              snapshot: {
                title: "Fix the login loop",
                state: "open",
                url: "https://github.com/acme/app/pull/7",
              },
            },
          );
          const untouched = yield* tickets.resolveRef(`T-${unrelated.number}`);
          assert.deepStrictEqual([untouched.statusId, linksOf(untouched)], ["todo", []]);
        }),
      ),
  );

  it.effect("a merge moves local tickets to Done; a GitHub ticket follows its issue", () =>
    withReactor(({ tickets, publish }) =>
      Effect.gen(function* () {
        const local = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        yield* tickets.upsertGitHubIssue(githubIssue(12));
        const github = yield* tickets.resolveRef("acme/app#12");
        yield* publish(sentMessage([local, github]));
        yield* publish(pullRequestsSynced([pullRequest("open")]));
        yield* publish(pullRequestsSynced([pullRequest("merged")]));

        const after = yield* Effect.forEach([local.id, github.id], (id) =>
          tickets.get(id).pipe(Effect.map((detail) => detail.summary)),
        );
        assert.deepStrictEqual(
          after.map((ticket) => [ticket.kind, ticket.statusId, linksOf(ticket)]),
          [
            ["local", "done", ["pull_request github.com/acme/app#7", "thread thread-1"]],
            [
              "github",
              "in_review",
              ["project project-1", "pull_request github.com/acme/app#7", "thread thread-1"],
            ],
          ],
        );
      }),
    ),
  );

  it.effect("a target status deleted since falls back to its category default", () =>
    withReactor(({ tickets, publish, setAutoAdvance }) =>
      Effect.gen(function* () {
        yield* setAutoAdvance({ threadStartedStatusId: status("removed-status") });
        const ticket = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        yield* publish(sentMessage([ticket]));

        assert.strictEqual((yield* tickets.resolveRef("T-1")).statusId, "in_progress");
      }),
    ),
  );

  it.effect("repeated events never re-advance a ticket the user moved back", () =>
    withReactor(({ tickets, publish }) =>
      Effect.gen(function* () {
        const ticket = (yield* tickets.create({ title: "Login loop" }, USER)).ticket;
        const moveBack = (statusId: string) =>
          Effect.gen(function* () {
            const current = yield* tickets.resolveRef("T-1");
            yield* tickets.move(
              {
                ticketId: ticket.id,
                expectedRevision: current.revision,
                statusId: status(statusId),
                sortKey: "a0",
              },
              USER,
            );
          });
        const statusAfter = (event: OrchestrationV2DomainEvent) =>
          publish(event).pipe(
            Effect.andThen(tickets.resolveRef("T-1")),
            Effect.map((current) => current.statusId),
          );

        const started = yield* statusAfter(sentMessage([ticket]));
        yield* moveBack("todo");
        const resent = yield* statusAfter(sentMessage([ticket]));
        const opened = yield* statusAfter(pullRequestsSynced([pullRequest("open")]));
        yield* moveBack("in_progress");
        const resynced = yield* statusAfter(pullRequestsSynced([pullRequest("open")]));
        const merged = yield* statusAfter(pullRequestsSynced([pullRequest("merged")]));
        yield* moveBack("in_review");
        const otherThread = ThreadId.make("other-thread");
        yield* tickets.link(
          { ticketId: ticket.id, target: { kind: "thread", threadId: otherThread } },
          USER,
        );
        const staleOpen = yield* statusAfter({
          ...pullRequestsSynced([pullRequest("open")]),
          threadId: otherThread,
        });
        const staleSnapshot = (yield* tickets.get(ticket.id)).links.find(
          (link) => link.target.kind === "pull_request",
        )?.target;
        assert.strictEqual(
          staleSnapshot?.kind === "pull_request" ? staleSnapshot.snapshot.state : null,
          "merged",
        );
        const remerged = yield* statusAfter(pullRequestsSynced([pullRequest("merged")]));

        assert.deepStrictEqual(
          [started, resent, opened, resynced, merged, staleOpen, remerged],
          ["in_progress", "todo", "in_review", "in_progress", "done", "in_review", "in_review"],
        );
      }),
    ),
  );
});
