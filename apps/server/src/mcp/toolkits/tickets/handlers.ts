import {
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type TicketActor,
  TicketError,
  type TicketGitHubRef,
  type TicketLinkTarget,
  type TicketPlanComment,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { orderPlanCommentThreads } from "@t3tools/shared/ticketPlanAnchors";
import * as Effect from "effect/Effect";

import * as TicketService from "../../../ticket/TicketService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { type AgentTicketLinkTarget, TicketsToolkit } from "./tools.ts";

const reader = Effect.fn("TicketsToolkit.reader")(function* () {
  yield* McpInvocationContext.requireMcpCapability("tickets");
  return (yield* readCaller()).caller;
});

/**
 * Changes are recorded as the calling thread's agent, so a client outside a thread can only read.
 * `McpToolAccess.writes` has already refused read-only clients; thread callers need a live run.
 */
const writer = Effect.fn("TicketsToolkit.writer")(function* () {
  yield* McpInvocationContext.requireMcpCapability("tickets");
  const { caller } = yield* readCaller();
  if (caller === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_credential_required",
      message:
        "Changing tickets acts as the calling Vetra Code thread, so it needs an agent running inside Vetra Code. This MCP client signed in from outside a thread.",
    });
  }
  const actor: TicketActor = { type: "agent", threadId: caller.id };
  return { caller, actor };
});

/** An agent's link with a placeholder snapshot; a later sync or user link fills in the real one. */
const toLinkTarget = (
  target: AgentTicketLinkTarget,
): Effect.Effect<TicketLinkTarget, TicketError> => {
  if (target.kind === "project" || target.kind === "thread") return Effect.succeed(target);
  const placeholder = (ref: TicketGitHubRef, url: string) => ({
    ref: { host: ref.host, repository: ref.repository, number: ref.number },
    snapshot: { title: `${ref.repository}#${ref.number}`, state: "open" as const, url },
  });
  if ("url" in target) {
    const ref = parseChangeRequestUrl(target.url);
    return ref === null
      ? Effect.fail(new TicketError({ message: `${target.url} is not a pull request URL.` }))
      : Effect.succeed({ kind: "pull_request", ...placeholder(ref, target.url) });
  }
  const { host, repository, number } = target.ref;
  return Effect.succeed(
    target.kind === "issue"
      ? {
          kind: "issue",
          ...placeholder(target.ref, `https://${host}/${repository}/issues/${number}`),
        }
      : {
          kind: "pull_request",
          ...placeholder(target.ref, `https://${host}/${repository}/pull/${number}`),
        },
  );
};

/** A plan's threads in document order, with what agents need to find and answer each. */
const commentThreads = (
  body: string,
  comments: ReadonlyArray<TicketPlanComment>,
  includeResolved: boolean,
) => {
  const reply = ({ id, author, body, createdAt }: TicketPlanComment) => ({
    id,
    author,
    body,
    createdAt,
  });
  return orderPlanCommentThreads(body, comments)
    .filter(({ comment }) => includeResolved || comment.resolvedAt === null)
    .map(({ comment, location, replies }) => ({
      ...reply(comment),
      quote: comment.anchor?.quote?.text,
      source: comment.anchor?.source,
      ...(comment.anchor?.sourceContext === undefined
        ? {}
        : { sourceContext: comment.anchor.sourceContext }),
      outdated: location?.status === "outdated",
      resolved: comment.resolvedAt !== null,
      replies: replies.map(reply),
    }));
};

const make = Effect.gen(function* () {
  const tickets = yield* TicketService.TicketService;
  // `T-42` means the calling thread's project's ticket 42.
  const ticketId = (reference: string, caller: OrchestrationV2ThreadShell | undefined) =>
    tickets.resolveRef(reference, caller?.projectId).pipe(Effect.map((summary) => summary.id));
  const planId = (reference: string, caller: OrchestrationV2ThreadShell | undefined) =>
    tickets.resolvePlanRef(reference, caller?.projectId).pipe(Effect.map((plan) => plan.planId));

  return {
    t3_ticket_list: McpToolAccess.reads(({ limit, ...filter }) =>
      Effect.gen(function* () {
        const caller = yield* reader();
        // Unfiltered, a thread sees its own project's tickets, the ones its `T-42` names.
        const home =
          caller === undefined || filter.projectId !== undefined || filter.threadId !== undefined
            ? {}
            : { homeProjectId: caller.projectId };
        return yield* tickets.list({ ...filter, ...home, limit: limit ?? 50 });
      }),
    ),
    t3_ticket_get: McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const caller = yield* reader();
        return yield* tickets.get(yield* ticketId(input.ticket, caller), {
          before: input.before,
          limit: input.limit ?? 20,
        });
      }),
    ),
    t3_ticket_create: McpToolAccess.writes(({ linkCaller, links, status, ...input }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        const callerLinks: ReadonlyArray<TicketLinkTarget> =
          linkCaller === false
            ? []
            : [
                { kind: "project", projectId: caller.projectId },
                { kind: "thread", threadId: caller.id },
              ];
        const extraLinks = yield* Effect.forEach(links ?? [], toLinkTarget);
        const created = yield* tickets.create(
          { ...input, statusId: status, links: [...callerLinks, ...extraLinks] },
          actor,
        );
        return { ...created.ticket, attachments: created.storedAttachments };
      }),
    ),
    t3_ticket_update: McpToolAccess.writes(({ ticket, status, ...input }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        const updated = yield* tickets.update(
          { ...input, ticketId: yield* ticketId(ticket, caller), statusId: status },
          actor,
        );
        return { ...updated.ticket, attachments: updated.storedAttachments };
      }),
    ),
    t3_ticket_link: McpToolAccess.writes(({ ticket, target }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        const linked = yield* tickets.link(
          { ticketId: yield* ticketId(ticket, caller), target: yield* toLinkTarget(target) },
          actor,
        );
        return linked.ticket;
      }),
    ),
    t3_ticket_unlink: McpToolAccess.writes(({ ticket, kind, targetKey }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        return yield* tickets.unlink(
          { ticketId: yield* ticketId(ticket, caller), kind, targetKey },
          actor,
        );
      }),
    ),
    t3_ticket_note: McpToolAccess.writes(({ ticket, body }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        return yield* tickets.addComment(
          { ticketId: yield* ticketId(ticket, caller), body },
          actor,
        );
      }),
    ),
    t3_ticket_plan_list: McpToolAccess.reads(({ ticket }) =>
      Effect.gen(function* () {
        const caller = yield* reader();
        return { plans: yield* tickets.listPlans(yield* ticketId(ticket, caller)) };
      }),
    ),
    t3_ticket_plan_get: McpToolAccess.reads(({ plan, includeResolved }) =>
      Effect.gen(function* () {
        const caller = yield* reader();
        const current = yield* tickets.getPlan(yield* planId(plan, caller));
        return {
          plan: current.summary,
          body: current.body,
          attachments: current.attachments,
          comments: commentThreads(current.body, current.comments, includeResolved === true),
        };
      }),
    ),
    t3_ticket_plan_create: McpToolAccess.writes(({ ticket, ...input }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        const created = yield* tickets.createPlan(
          { ...input, ticketId: yield* ticketId(ticket, caller) },
          actor,
        );
        return { ...created.plan, attachments: created.storedAttachments };
      }),
    ),
    t3_ticket_plan_update: McpToolAccess.writes(({ plan, ...input }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        const updated = yield* tickets.updatePlan(
          { ...input, planId: yield* planId(plan, caller) },
          actor,
        );
        return { ...updated.plan, attachments: updated.storedAttachments };
      }),
    ),
    t3_ticket_plan_comment: McpToolAccess.writes(({ plan, quote, ...input }) =>
      Effect.gen(function* () {
        const { caller, actor } = yield* writer();
        return yield* tickets.addPlanComment(
          { ...input, planId: yield* planId(plan, caller), sourceQuote: quote },
          actor,
        );
      }),
    ),
    t3_ticket_plan_reopen_comment: McpToolAccess.writes(({ plan, commentId }) =>
      Effect.gen(function* () {
        const { caller } = yield* writer();
        return yield* tickets.reopenPlanComment({
          planId: yield* planId(plan, caller),
          commentId,
        });
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof TicketsToolkit.tools>;
});

export const TicketsToolkitHandlersLive = McpToolAccess.toLayer(TicketsToolkit, make);
