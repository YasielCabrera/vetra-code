import {
  type TicketActor,
  TicketError,
  type TicketGitHubRef,
  type TicketLinkTarget,
  type TicketPlanComment,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { anchorFromSourceQuote, locatePlanAnchor } from "@t3tools/shared/ticketPlanAnchors";
import * as Effect from "effect/Effect";

import * as TicketService from "../../../ticket/TicketService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { readCaller, readMutationCaller } from "../../threadAccess.ts";
import { type AgentTicketLinkTarget, TicketsToolkit } from "./tools.ts";

const RECENT_ACTIVITY = 20;

const reader = Effect.fn("TicketsToolkit.reader")(function* () {
  yield* McpInvocationContext.requireMcpCapability("tickets");
  return (yield* readCaller()).caller;
});

const writer = Effect.fn("TicketsToolkit.writer")(function* () {
  yield* McpInvocationContext.requireMcpCapability("tickets");
  const { caller } = yield* readMutationCaller();
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

/**
 * Top-level comments with their replies nested, in document order: anchored comments by where
 * their passage is now, then outdated and whole-plan comments oldest first.
 */
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
  const threads = comments
    .filter(
      (comment) => comment.parentId === null && (includeResolved || comment.resolvedAt === null),
    )
    .map((comment) => {
      const location = comment.anchor === null ? null : locatePlanAnchor(body, comment.anchor);
      return {
        start: location === null || location.status === "outdated" ? Infinity : location.start,
        thread: {
          ...reply(comment),
          quote: comment.anchor?.quote?.text,
          source: comment.anchor?.source,
          outdated: location?.status === "outdated",
          resolved: comment.resolvedAt !== null,
          replies: comments.filter((candidate) => candidate.parentId === comment.id).map(reply),
        },
      };
    });
  // The sort is stable, so the comments without a place stay last in creation order.
  return threads
    .sort((left, right) => (left.start === right.start ? 0 : left.start - right.start))
    .map(({ thread }) => thread);
};

const make = Effect.gen(function* () {
  const tickets = yield* TicketService.TicketService;
  const ticketId = (reference: string) =>
    tickets.resolveRef(reference).pipe(Effect.map((summary) => summary.id));
  const readPlan = (reference: string) =>
    tickets.resolvePlanRef(reference).pipe(Effect.flatMap(({ planId }) => tickets.getPlan(planId)));

  return TicketsToolkit.of({
    t3_ticket_list: ({ limit, ...filter }) =>
      reader().pipe(Effect.andThen(tickets.list({ ...filter, limit: limit ?? 50 }))),
    t3_ticket_get: (input) =>
      Effect.gen(function* () {
        yield* reader();
        const detail = yield* tickets.get(yield* ticketId(input.ticket));
        return { ...detail, activity: detail.activity.slice(-RECENT_ACTIVITY) };
      }),
    t3_ticket_create: ({ linkCaller, links, status, ...input }) =>
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
        return created.ticket;
      }),
    t3_ticket_update: ({ ticket, status, ...input }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        const updated = yield* tickets.update(
          { ...input, ticketId: yield* ticketId(ticket), statusId: status },
          actor,
        );
        return updated.ticket;
      }),
    t3_ticket_link: ({ ticket, target }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        const linked = yield* tickets.link(
          { ticketId: yield* ticketId(ticket), target: yield* toLinkTarget(target) },
          actor,
        );
        return linked.ticket;
      }),
    t3_ticket_unlink: ({ ticket, kind, targetKey }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        return yield* tickets.unlink({ ticketId: yield* ticketId(ticket), kind, targetKey }, actor);
      }),
    t3_ticket_note: ({ ticket, body }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        return yield* tickets.addComment({ ticketId: yield* ticketId(ticket), body }, actor);
      }),
    t3_ticket_plan_list: ({ ticket }) =>
      Effect.gen(function* () {
        yield* reader();
        const id = yield* ticketId(ticket);
        const plans = yield* tickets.listPlans(id);
        return { plans: plans.map((plan) => ({ ticketId: id, ...plan })) };
      }),
    t3_ticket_plan_get: ({ plan, includeResolved }) =>
      Effect.gen(function* () {
        yield* reader();
        const current = yield* readPlan(plan);
        return {
          ticketId: current.ticketId,
          plan: current.summary,
          body: current.body,
          comments: commentThreads(current.body, current.comments, includeResolved === true),
        };
      }),
    t3_ticket_plan_create: ({ ticket, ...input }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        const id = yield* ticketId(ticket);
        const created = yield* tickets.createPlan({ ...input, ticketId: id }, actor);
        return { ticketId: id, ...created.plan };
      }),
    t3_ticket_plan_update: ({ plan, status, ...input }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        const current = yield* readPlan(plan);
        const { planId } = current.summary;
        const updated = yield* tickets.updatePlan({ ...input, planId }, actor);
        return {
          ticketId: current.ticketId,
          ...(status === undefined
            ? updated.plan
            : yield* tickets.setPlanStatus({ planId, status }, actor)),
        };
      }),
    t3_ticket_plan_comment: ({ plan, quote, ...input }) =>
      Effect.gen(function* () {
        const { actor } = yield* writer();
        const { summary, body } = yield* readPlan(plan);
        const anchor =
          quote === undefined ? undefined : anchorFromSourceQuote(body, quote, summary.revision);
        if (anchor !== undefined && "matches" in anchor) {
          return yield* new TicketError({
            message:
              anchor.matches === 0
                ? `The quote is not in ${summary.ref}. Quote its Markdown source exactly, as t3_ticket_plan_get returns it.`
                : `The quote matches ${anchor.matches} places in ${summary.ref}. Quote more of the passage so it matches once.`,
          });
        }
        return yield* tickets.addPlanComment({ ...input, planId: summary.planId, anchor }, actor);
      }),
  });
});

export const TicketsToolkitHandlersLive = TicketsToolkit.toLayer(make);
