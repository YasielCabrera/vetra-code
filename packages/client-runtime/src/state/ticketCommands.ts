import { WS_METHODS, type TicketListEvent, type TicketSummary } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Applies one list event without mutating `tickets`. A delta copies the map once and keeps every
 * untouched entry's reference, so consumers can compare entries by identity.
 */
export function applyTicketListEvent(
  tickets: ReadonlyMap<string, TicketSummary>,
  event: TicketListEvent,
): ReadonlyMap<string, TicketSummary> {
  if (event.type === "snapshot") return new Map(event.tickets.map((ticket) => [ticket.id, ticket]));
  const next = new Map(tickets);
  for (const ticket of event.upserted) next.set(ticket.id, ticket);
  for (const ticketId of event.removed) next.delete(ticketId);
  return next;
}

export function createTicketEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    listLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tickets:list",
      tag: WS_METHODS.ticketsSubscribe,
      transform: (stream) =>
        stream.pipe(
          Stream.mapAccum(
            (): ReadonlyMap<string, TicketSummary> => new Map(),
            (tickets, event: TicketListEvent) => {
              const next = applyTicketListEvent(tickets, event);
              return [next, [next]] as const;
            },
          ),
        ),
    }),
    detailLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tickets:detail",
      tag: WS_METHODS.ticketsSubscribeDetail,
      idleTtlMs: 5_000,
    }),
    planLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tickets:plan",
      tag: WS_METHODS.ticketsSubscribePlan,
      idleTtlMs: 5_000,
    }),
    statusesLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tickets:statuses",
      tag: WS_METHODS.ticketsStatusesSubscribe,
    }),
    search: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:search",
      tag: WS_METHODS.ticketsSearch,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:create",
      tag: WS_METHODS.ticketsCreate,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:update",
      tag: WS_METHODS.ticketsUpdate,
    }),
    move: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:move",
      tag: WS_METHODS.ticketsMove,
    }),
    delete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:delete",
      tag: WS_METHODS.ticketsDelete,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:link",
      tag: WS_METHODS.ticketsLink,
    }),
    unlink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:unlink",
      tag: WS_METHODS.ticketsUnlink,
    }),
    comment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:comment",
      tag: WS_METHODS.ticketsComment,
    }),
    upsertStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:statuses:upsert",
      tag: WS_METHODS.ticketsStatusesUpsert,
    }),
    reorderStatuses: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:statuses:reorder",
      tag: WS_METHODS.ticketsStatusesReorder,
    }),
    deleteStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:statuses:delete",
      tag: WS_METHODS.ticketsStatusesDelete,
    }),
    setHidden: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:set-hidden",
      tag: WS_METHODS.ticketsSetHidden,
    }),
    githubSourcesLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:tickets:github-sources",
      tag: WS_METHODS.ticketsGitHubSourcesSubscribe,
    }),
    upsertGitHubSource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:github-sources:upsert",
      tag: WS_METHODS.ticketsGitHubSourcesUpsert,
    }),
    removeGitHubSource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:github-sources:remove",
      tag: WS_METHODS.ticketsGitHubSourcesRemove,
    }),
    syncGitHubSource: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:github-sources:sync-now",
      tag: WS_METHODS.ticketsGitHubSourcesSyncNow,
    }),
    githubIssueDetail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:tickets:github-detail",
      tag: WS_METHODS.ticketsGitHubIssueDetail,
      staleTimeMs: 15_000,
    }),
    issueLinkCandidates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:tickets:issue-link-candidates",
      tag: WS_METHODS.ticketsIssueLinkCandidates,
      staleTimeMs: 30_000,
    }),
    invalidateGitHubIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tickets:invalidate-github-issue",
      tag: WS_METHODS.ticketsGitHubIssueInvalidate,
    }),
    githubIssueActivity: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:tickets:github-activity",
      tag: WS_METHODS.ticketsGitHubIssueActivity,
      staleTimeMs: 15_000,
    }),
    githubIssueAssigneeCandidates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:tickets:github-assignee-candidates",
      tag: WS_METHODS.ticketsGitHubIssueAssigneeCandidates,
      staleTimeMs: 60_000,
    }),
    githubIssueSetAssignees: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tickets:github-set-assignees",
      tag: WS_METHODS.ticketsGitHubIssueSetAssignees,
    }),
    refreshGitHubIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:tickets:github-refresh",
      tag: WS_METHODS.ticketsGitHubIssueRefresh,
    }),
    launchDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:launch-draft",
      tag: WS_METHODS.ticketsLaunchDraft,
    }),
    createPlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:plans:create",
      tag: WS_METHODS.ticketsCreatePlan,
    }),
    updatePlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:plans:update",
      tag: WS_METHODS.ticketsUpdatePlan,
    }),
    deletePlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:plans:delete",
      tag: WS_METHODS.ticketsDeletePlan,
    }),
    addPlanComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:plans:comment",
      tag: WS_METHODS.ticketsAddPlanComment,
    }),
    reopenPlanComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:plans:reopen-comment",
      tag: WS_METHODS.ticketsReopenPlanComment,
    }),
    deletePlanComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:tickets:plans:delete-comment",
      tag: WS_METHODS.ticketsDeletePlanComment,
    }),
  };
}
