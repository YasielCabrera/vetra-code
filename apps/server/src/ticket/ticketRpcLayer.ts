import {
  type AuthEnvironmentScope,
  AuthSourceControlWriteScope,
  TicketsRpcGroup,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TicketDrafting from "./TicketDrafting.ts";
import * as TicketGitHubSync from "./TicketGitHubSync.ts";
import * as TicketService from "./TicketService.ts";

const USER = { type: "user" } as const;

/**
 * The ticket RPCs over one socket session. Every write here is the user's, and reaches GitHub only
 * when the session holds `source-control:write`.
 */
export const ticketRpcLayer = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  TicketsRpcGroup.toLayer(
    Effect.gen(function* () {
      const tickets = yield* TicketService.TicketService;
      const githubSync = yield* TicketGitHubSync.TicketGitHubSync;
      const drafting = yield* TicketDrafting.TicketDrafting;
      const githubWrite = Effect.provideService(
        TicketService.GitHubWriteAccess,
        scopes.includes(AuthSourceControlWriteScope),
      );
      return TicketsRpcGroup.of({
        [WS_METHODS.ticketsSubscribe]: () => tickets.subscribeList(),
        [WS_METHODS.ticketsSubscribeDetail]: (input) => tickets.subscribeDetail(input.ticketId),
        [WS_METHODS.ticketsSearch]: (input) => tickets.search(input),
        [WS_METHODS.ticketsCreate]: (input) => tickets.create(input, USER),
        [WS_METHODS.ticketsUpdate]: (input) => tickets.update(input, USER),
        [WS_METHODS.ticketsMove]: (input) => githubWrite(tickets.move(input, USER)),
        [WS_METHODS.ticketsDelete]: (input) => tickets.delete(input),
        [WS_METHODS.ticketsLink]: (input) =>
          tickets.link(input, USER).pipe(Effect.map((linked) => linked.ticket)),
        [WS_METHODS.ticketsUnlink]: (input) => tickets.unlink(input, USER),
        [WS_METHODS.ticketsComment]: (input) => githubWrite(tickets.postUserComment(input)),
        [WS_METHODS.ticketsStatusesSubscribe]: () => tickets.subscribeStatuses(),
        [WS_METHODS.ticketsStatusesUpsert]: (input) => tickets.upsertStatus(input),
        [WS_METHODS.ticketsStatusesReorder]: (input) => tickets.reorderStatuses(input),
        [WS_METHODS.ticketsStatusesDelete]: (input) => tickets.deleteStatus(input, USER),
        [WS_METHODS.ticketsSetHidden]: (input) => tickets.setHidden(input),
        [WS_METHODS.ticketsGitHubSourcesSubscribe]: () => githubSync.subscribeSources(),
        [WS_METHODS.ticketsGitHubSourcesUpsert]: (input) => githubSync.upsertSource(input),
        [WS_METHODS.ticketsGitHubSourcesRemove]: (input) => githubSync.removeSource(input),
        [WS_METHODS.ticketsGitHubSourcesSyncNow]: (input) => githubSync.syncNow(input),
        [WS_METHODS.ticketsGitHubIssueDetail]: (input) => tickets.githubIssueDetail(input),
        [WS_METHODS.ticketsGitHubIssueActivity]: (input) => tickets.githubIssueActivity(input),
        [WS_METHODS.ticketsGitHubIssueAssigneeCandidates]: (input) =>
          tickets.githubIssueAssigneeCandidates(input),
        [WS_METHODS.ticketsGitHubIssueSetAssignees]: (input) =>
          githubWrite(tickets.githubIssueSetAssignees(input)),
        [WS_METHODS.ticketsGitHubIssueRefresh]: (input) => tickets.refreshGitHubIssue(input),
        [WS_METHODS.ticketsGitHubIssueInvalidate]: (input) => tickets.invalidateGitHubIssue(input),
        [WS_METHODS.ticketsIssueLinkCandidates]: (input) => tickets.issueLinkCandidates(input),
        [WS_METHODS.ticketsLaunchDraft]: (input) => drafting.launchDraft(input),
        [WS_METHODS.ticketsSubscribePlan]: (input) => tickets.subscribePlan(input.planId),
        [WS_METHODS.ticketsCreatePlan]: (input) => tickets.createPlan(input, USER),
        [WS_METHODS.ticketsUpdatePlan]: (input) => tickets.updatePlan(input, USER),
        [WS_METHODS.ticketsDeletePlan]: (input) => tickets.deletePlan(input, USER),
        [WS_METHODS.ticketsAddPlanComment]: (input) => tickets.addPlanComment(input, USER),
        [WS_METHODS.ticketsReopenPlanComment]: (input) => tickets.reopenPlanComment(input),
        [WS_METHODS.ticketsDeletePlanComment]: (input) => tickets.deletePlanComment(input),
      });
    }),
  );
