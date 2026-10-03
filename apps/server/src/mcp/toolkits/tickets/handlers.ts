import {
  type TicketActor,
  TicketError,
  type TicketGitHubRef,
  type TicketLinkTarget,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
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

const make = Effect.gen(function* () {
  const tickets = yield* TicketService.TicketService;
  const ticketId = (reference: string) =>
    tickets.resolveRef(reference).pipe(Effect.map((summary) => summary.id));

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
  });
});

export const TicketsToolkitHandlersLive = TicketsToolkit.toLayer(make);
