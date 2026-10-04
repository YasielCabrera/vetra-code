import { TicketsRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { RpcObservers } from "../ws.ts";
import * as TicketDrafting from "./TicketDrafting.ts";
import * as TicketGitHubSync from "./TicketGitHubSync.ts";
import * as TicketService from "./TicketService.ts";

const USER = { type: "user" } as const;
const TRACE_ATTRIBUTES = { "rpc.aggregate": "tickets" };

/** The ticket RPCs over the socket. Every write here is the user's. */
export const makeTicketRpcLayer = (rpc: RpcObservers) =>
  TicketsRpcGroup.toLayer(
    Effect.gen(function* () {
      const tickets = yield* TicketService.TicketService;
      const githubSync = yield* TicketGitHubSync.TicketGitHubSync;
      const drafting = yield* TicketDrafting.TicketDrafting;
      const observeEffect = <A, E, R>(method: string, effect: Effect.Effect<A, E, R>) =>
        rpc.observeRpcEffect(method, effect, TRACE_ATTRIBUTES);
      const observeStream = <A, E, R>(method: string, stream: Stream.Stream<A, E, R>) =>
        rpc.observeRpcStream(method, stream, TRACE_ATTRIBUTES);
      return TicketsRpcGroup.of({
        [WS_METHODS.ticketsSubscribe]: () =>
          observeStream(WS_METHODS.ticketsSubscribe, tickets.subscribeList()),
        [WS_METHODS.ticketsSubscribeDetail]: (input) =>
          observeStream(WS_METHODS.ticketsSubscribeDetail, tickets.subscribeDetail(input.ticketId)),
        [WS_METHODS.ticketsSearch]: (input) =>
          observeEffect(WS_METHODS.ticketsSearch, tickets.search(input)),
        [WS_METHODS.ticketsCreate]: (input) =>
          observeEffect(WS_METHODS.ticketsCreate, tickets.create(input, USER)),
        [WS_METHODS.ticketsUpdate]: (input) =>
          observeEffect(WS_METHODS.ticketsUpdate, tickets.update(input, USER)),
        [WS_METHODS.ticketsMove]: (input) =>
          observeEffect(WS_METHODS.ticketsMove, tickets.move(input, USER)),
        [WS_METHODS.ticketsDelete]: (input) =>
          observeEffect(WS_METHODS.ticketsDelete, tickets.delete(input)),
        [WS_METHODS.ticketsLink]: (input) =>
          observeEffect(
            WS_METHODS.ticketsLink,
            tickets.link(input, USER).pipe(Effect.map((linked) => linked.ticket)),
          ),
        [WS_METHODS.ticketsUnlink]: (input) =>
          observeEffect(WS_METHODS.ticketsUnlink, tickets.unlink(input, USER)),
        [WS_METHODS.ticketsComment]: (input) =>
          observeEffect(WS_METHODS.ticketsComment, tickets.postUserComment(input)),
        [WS_METHODS.ticketsStatusesSubscribe]: () =>
          observeStream(WS_METHODS.ticketsStatusesSubscribe, tickets.subscribeStatuses()),
        [WS_METHODS.ticketsStatusesUpsert]: (input) =>
          observeEffect(WS_METHODS.ticketsStatusesUpsert, tickets.upsertStatus(input)),
        [WS_METHODS.ticketsStatusesReorder]: (input) =>
          observeEffect(WS_METHODS.ticketsStatusesReorder, tickets.reorderStatuses(input)),
        [WS_METHODS.ticketsStatusesDelete]: (input) =>
          observeEffect(WS_METHODS.ticketsStatusesDelete, tickets.deleteStatus(input, USER)),
        [WS_METHODS.ticketsSetHidden]: (input) =>
          observeEffect(WS_METHODS.ticketsSetHidden, tickets.setHidden(input)),
        [WS_METHODS.ticketsGitHubSourcesSubscribe]: () =>
          observeStream(WS_METHODS.ticketsGitHubSourcesSubscribe, githubSync.subscribeSources()),
        [WS_METHODS.ticketsGitHubSourcesUpsert]: (input) =>
          observeEffect(WS_METHODS.ticketsGitHubSourcesUpsert, githubSync.upsertSource(input)),
        [WS_METHODS.ticketsGitHubSourcesRemove]: (input) =>
          observeEffect(WS_METHODS.ticketsGitHubSourcesRemove, githubSync.removeSource(input)),
        [WS_METHODS.ticketsGitHubSourcesSyncNow]: (input) =>
          observeEffect(WS_METHODS.ticketsGitHubSourcesSyncNow, githubSync.syncNow(input)),
        [WS_METHODS.ticketsGitHubIssueDetail]: (input) =>
          observeEffect(WS_METHODS.ticketsGitHubIssueDetail, tickets.githubIssueDetail(input)),
        [WS_METHODS.ticketsGitHubIssueActivity]: (input) =>
          observeEffect(WS_METHODS.ticketsGitHubIssueActivity, tickets.githubIssueActivity(input)),
        [WS_METHODS.ticketsGitHubIssueAssigneeCandidates]: (input) =>
          observeEffect(
            WS_METHODS.ticketsGitHubIssueAssigneeCandidates,
            tickets.githubIssueAssigneeCandidates(input),
          ),
        [WS_METHODS.ticketsGitHubIssueSetAssignees]: (input) =>
          observeEffect(
            WS_METHODS.ticketsGitHubIssueSetAssignees,
            tickets.githubIssueSetAssignees(input),
          ),
        [WS_METHODS.ticketsGitHubIssueRefresh]: (input) =>
          observeEffect(WS_METHODS.ticketsGitHubIssueRefresh, tickets.refreshGitHubIssue(input)),
        [WS_METHODS.ticketsLaunchDraft]: (input) =>
          observeEffect(WS_METHODS.ticketsLaunchDraft, drafting.launchDraft(input)),
        [WS_METHODS.ticketsSubscribePlan]: (input) =>
          observeStream(WS_METHODS.ticketsSubscribePlan, tickets.subscribePlan(input.planId)),
        [WS_METHODS.ticketsCreatePlan]: (input) =>
          observeEffect(WS_METHODS.ticketsCreatePlan, tickets.createPlan(input, USER)),
        [WS_METHODS.ticketsUpdatePlan]: (input) =>
          observeEffect(WS_METHODS.ticketsUpdatePlan, tickets.updatePlan(input, USER)),
        [WS_METHODS.ticketsDeletePlan]: (input) =>
          observeEffect(WS_METHODS.ticketsDeletePlan, tickets.deletePlan(input, USER)),
        [WS_METHODS.ticketsAddPlanComment]: (input) =>
          observeEffect(WS_METHODS.ticketsAddPlanComment, tickets.addPlanComment(input, USER)),
        [WS_METHODS.ticketsReopenPlanComment]: (input) =>
          observeEffect(WS_METHODS.ticketsReopenPlanComment, tickets.reopenPlanComment(input)),
        [WS_METHODS.ticketsDeletePlanComment]: (input) =>
          observeEffect(WS_METHODS.ticketsDeletePlanComment, tickets.deletePlanComment(input)),
      });
    }),
  );
