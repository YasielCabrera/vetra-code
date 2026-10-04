import {
  type OrchestrationV2DomainEvent,
  type ThreadId,
  type ThreadPullRequestLink,
  type TicketActor,
  type TicketAutoAdvanceSettings,
  type TicketId,
  type TicketLinkTarget,
  type TicketStatusCategory,
  type TicketStatusDefinition,
  type TicketSummary,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TicketService from "./TicketService.ts";

type AutoAdvanceEvent = "threadStarted" | "pullRequestLinked" | "pullRequestMerged";

const AUTO_ADVANCE_RULES: Record<
  AutoAdvanceEvent,
  {
    readonly setting: Exclude<keyof TicketAutoAdvanceSettings, "enabled">;
    readonly fallback: TicketStatusCategory;
    readonly from: ReadonlyArray<TicketStatusCategory>;
  }
> = {
  threadStarted: { setting: "threadStartedStatusId", fallback: "active", from: ["open"] },
  pullRequestLinked: {
    setting: "pullRequestLinkedStatusId",
    fallback: "active",
    from: ["open", "active"],
  },
  pullRequestMerged: {
    setting: "pullRequestMergedStatusId",
    fallback: "closed",
    from: ["open", "active"],
  },
};

const CATEGORY_RANK: Record<TicketStatusCategory, number> = { open: 0, active: 1, closed: 2 };

const isForward = (from: TicketStatusDefinition, to: TicketStatusDefinition) =>
  CATEGORY_RANK[to.category] !== CATEGORY_RANK[from.category]
    ? CATEGORY_RANK[to.category] > CATEGORY_RANK[from.category]
    : to.position > from.position;

function autoAdvanceTarget(input: {
  readonly event: AutoAdvanceEvent;
  readonly ticket: TicketSummary;
  readonly statuses: ReadonlyArray<TicketStatusDefinition>;
  readonly settings: TicketAutoAdvanceSettings;
}): TicketStatusDefinition | null {
  if (!input.settings.enabled) return null;
  const rule = AUTO_ADVANCE_RULES[input.event];
  const current = input.statuses.find((status) => status.id === input.ticket.statusId);
  if (current === undefined || !rule.from.includes(current.category)) return null;
  const target =
    input.statuses.find((status) => status.id === input.settings[rule.setting]) ??
    input.statuses.find((status) => status.category === rule.fallback && status.isDefault);
  if (target === undefined || !isForward(current, target)) return null;
  if (input.ticket.kind === "github" && target.category === "closed") return null;
  return target;
}

const AUTOMATION: TicketActor = { type: "automation" };

/**
 * The event a pull request link moves its tickets on: its first link to the ticket, or its stored
 * snapshot turning merged. A repeated sync of the same state moves nothing, so a user's move back
 * sticks.
 */
const pullRequestTransition = (
  target: Extract<TicketLinkTarget, { readonly kind: "pull_request" }>,
  previous: TicketLinkTarget | null,
): AutoAdvanceEvent | null => {
  const state = target.snapshot.state;
  if (previous === null) {
    return state === "merged" ? "pullRequestMerged" : state === "open" ? "pullRequestLinked" : null;
  }
  return state === "merged" &&
    previous.kind === "pull_request" &&
    previous.snapshot.state !== "merged"
    ? "pullRequestMerged"
    : null;
};

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const tickets = yield* TicketService.TicketService;
  const settingsService = yield* ServerSettingsService;
  const sql = yield* SqlClient.SqlClient;

  const linkAndAdvance = (
    ticketId: TicketId,
    target: TicketLinkTarget,
    transition: (previous: TicketLinkTarget | null) => AutoAdvanceEvent | null,
    context: {
      readonly statuses: ReadonlyArray<TicketStatusDefinition>;
      readonly settings: TicketAutoAdvanceSettings;
    },
  ) =>
    Effect.gen(function* () {
      const { ticket, previous } = yield* tickets.link({ ticketId, target }, AUTOMATION);
      const event = transition(previous);
      const status = event === null ? null : autoAdvanceTarget({ event, ticket, ...context });
      if (status === null) return;
      yield* tickets.update(
        { ticketId, expectedRevision: ticket.revision, statusId: status.id },
        AUTOMATION,
      );
    }).pipe(
      Effect.catchTags({
        TicketNotFoundError: () => Effect.void,
        TicketRevisionConflictError: () => Effect.void,
      }),
    );

  const readContext = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const { statuses } = yield* tickets.readStatuses;
    return { statuses, settings: settings.ticketAutoAdvance };
  });

  const onMessageSent = (threadId: ThreadId, ticketIds: ReadonlyArray<TicketId>) =>
    Effect.gen(function* () {
      // An analyzer thread's tickets are what it was asked to file a ticket about, not work it
      // started on; TicketService.create links the drafted ticket to the source thread instead.
      const [draft] = yield* sql`SELECT 1 FROM ticket_drafts WHERE thread_id = ${threadId}`;
      if (draft !== undefined) return;
      const context = yield* readContext;
      yield* Effect.forEach(
        ticketIds,
        (ticketId) =>
          linkAndAdvance(
            ticketId,
            { kind: "thread", threadId },
            (previous) => (previous === null ? "threadStarted" : null),
            context,
          ),
        { discard: true },
      );
    });

  const onPullRequestsSynced = (
    threadId: ThreadId,
    links: ReadonlyArray<ThreadPullRequestLink> | undefined,
  ) =>
    Effect.gen(function* () {
      const pullRequests = visibleThreadPullRequests(links ?? []);
      if (pullRequests.length === 0) return;
      const linked = yield* tickets.listForTarget({ kind: "thread", targetKey: threadId });
      if (linked.length === 0) return;
      const context = yield* readContext;
      for (const pullRequest of pullRequests) {
        const state = pullRequest.snapshot?.state ?? "open";
        const target = {
          kind: "pull_request" as const,
          ref: {
            host: pullRequest.host,
            repository: pullRequest.repository,
            number: pullRequest.number,
          },
          snapshot: {
            title: pullRequest.snapshot?.title ?? `${pullRequest.repository}#${pullRequest.number}`,
            state,
            url: pullRequest.url,
          },
        };
        yield* Effect.forEach(
          linked,
          (ticket) =>
            linkAndAdvance(
              ticket.id,
              target,
              (previous) => pullRequestTransition(target, previous),
              context,
            ),
          { discard: true },
        );
      }
    });

  const process = (event: OrchestrationV2DomainEvent) => {
    switch (event.type) {
      case "message.updated": {
        const message = event.payload;
        if (message.role !== "user" || message.streaming) return Effect.void;
        const ticketIds = [
          ...new Set(
            (message.context?.records ?? []).flatMap((record) =>
              (record.kind === "ticket" || record.kind === "ticket-plan") && "ticketId" in record
                ? [record.ticketId]
                : [],
            ),
          ),
        ];
        return ticketIds.length === 0 ? Effect.void : onMessageSent(message.threadId, ticketIds);
      }
      case "thread.pull-request-synced":
        return onPullRequestsSynced(event.threadId, event.payload.pullRequests);
      default:
        return Effect.void;
    }
  };

  const worker = yield* makeDrainableWorker((event: OrchestrationV2DomainEvent) =>
    process(event).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("ticket link update skipped", {
            threadId: event.threadId,
            cause: Cause.pretty(cause),
          }),
      ),
    ),
  );

  const start = Effect.fn("TicketLinkReactor.start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "message.updated" || event.type === "thread.pull-request-synced"
          ? worker.enqueue(event)
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("ticket link event stream failed", { cause: Cause.pretty(cause) }),
        ),
      ),
    );
  });

  return { start, drain: worker.drain };
});
