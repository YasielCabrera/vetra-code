import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { IssueActivity, IssueActor, IssueAssigneeCandidateList, IssueDetail } from "./issue.ts";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  TicketCommentInput,
  TicketCreateInput,
  TicketDeleteInput,
  TicketDetail,
  TicketError,
  TicketGitHubSource,
  TicketGitHubRef,
  TicketGitHubSourceRef,
  TicketGitHubSourceRemoveInput,
  TicketGitHubSourceSet,
  TicketGitHubSourceUpsertInput,
  TicketLinkInput,
  TicketListEvent,
  TicketMoveInput,
  TicketNotFoundError,
  TicketPlanSummary,
  TicketRevisionConflictError,
  TicketSearchInput,
  TicketSearchResult,
  TicketSetHiddenInput,
  TicketStatusDeleteInput,
  TicketStatusReorderInput,
  TicketStatusSet,
  TicketStatusUpsertInput,
  TicketSubscribeDetailInput,
  TicketSummary,
  TicketUnlinkInput,
  TicketUpdateInput,
  TicketWriteResult,
} from "./ticket.ts";
import { TicketLaunchDraftInput, TicketLaunchDraftResult } from "./ticketDraft.ts";
import {
  TicketPlan,
  TicketPlanComment,
  TicketPlanCommentInput,
  TicketPlanCommentRefInput,
  TicketPlanCreateInput,
  TicketPlanDeleteInput,
  TicketPlanNotFoundError,
  TicketPlanRevisionConflictError,
  TicketPlanSubscribeInput,
  TicketPlanUpdateInput,
  TicketPlanWriteResult,
} from "./ticketPlan.ts";

export const TicketGitHubIssueRef = Schema.Struct({
  ...TicketSubscribeDetailInput.fields,
  linkedIssue: Schema.optional(TicketGitHubRef),
});
export type TicketGitHubIssueRef = typeof TicketGitHubIssueRef.Type;
export const TicketLinkedIssueRef = Schema.Struct({
  ...TicketSubscribeDetailInput.fields,
  linkedIssue: TicketGitHubRef,
});
export type TicketLinkedIssueRef = typeof TicketLinkedIssueRef.Type;
export const TicketGitHubIssueAssigneeChangeInput = Schema.Struct({
  ...TicketGitHubIssueRef.fields,
  assignees: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  assigned: Schema.Boolean,
});
export type TicketGitHubIssueAssigneeChangeInput = typeof TicketGitHubIssueAssigneeChangeInput.Type;
export const TicketGitHubIssueDetail = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  assignees: Schema.Array(IssueActor),
  comments: IssueDetail.fields.comments,
  preview: Schema.optional(
    IssueDetail.mapFields(Struct.omit(["title", "body", "assignees", "comments"])),
  ),
});
export type TicketGitHubIssueDetail = typeof TicketGitHubIssueDetail.Type;
export const TicketIssueLinkCandidates = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      ...TicketGitHubRef.fields,
      title: IssueDetail.fields.title,
      state: IssueDetail.fields.state,
      url: IssueDetail.fields.url,
    }),
  ),
  errors: Schema.Array(
    Schema.Struct({
      projectId: ProjectId,
      projectTitle: TrimmedNonEmptyString,
      message: TrimmedNonEmptyString,
    }),
  ),
});
export type TicketIssueLinkCandidates = typeof TicketIssueLinkCandidates.Type;

export const TICKET_WS_METHODS = {
  ticketsSubscribe: "tickets.subscribe",
  ticketsSubscribeDetail: "tickets.subscribeDetail",
  ticketsSearch: "tickets.search",
  ticketsCreate: "tickets.create",
  ticketsUpdate: "tickets.update",
  ticketsMove: "tickets.move",
  ticketsDelete: "tickets.delete",
  ticketsLink: "tickets.link",
  ticketsUnlink: "tickets.unlink",
  ticketsComment: "tickets.comment",
  ticketsStatusesSubscribe: "tickets.statuses.subscribe",
  ticketsStatusesUpsert: "tickets.statuses.upsert",
  ticketsStatusesReorder: "tickets.statuses.reorder",
  ticketsStatusesDelete: "tickets.statuses.delete",
  ticketsSetHidden: "tickets.setHidden",
  ticketsGitHubSourcesSubscribe: "tickets.githubSources.subscribe",
  ticketsGitHubSourcesUpsert: "tickets.githubSources.upsert",
  ticketsGitHubSourcesRemove: "tickets.githubSources.remove",
  ticketsGitHubSourcesSyncNow: "tickets.githubSources.syncNow",
  ticketsGitHubIssueDetail: "tickets.githubIssue.detail",
  ticketsGitHubIssueActivity: "tickets.githubIssue.activity",
  ticketsGitHubIssueAssigneeCandidates: "tickets.githubIssue.assigneeCandidates",
  ticketsGitHubIssueSetAssignees: "tickets.githubIssue.setAssignees",
  ticketsGitHubIssueRefresh: "tickets.githubIssue.refresh",
  ticketsGitHubIssueInvalidate: "tickets.githubIssue.invalidate",
  ticketsIssueLinkCandidates: "tickets.issueLinkCandidates",
  ticketsLaunchDraft: "tickets.launchDraft",
  ticketsSubscribePlan: "tickets.subscribePlan",
  ticketsCreatePlan: "tickets.createPlan",
  ticketsUpdatePlan: "tickets.updatePlan",
  ticketsDeletePlan: "tickets.deletePlan",
  ticketsAddPlanComment: "tickets.addPlanComment",
  ticketsReopenPlanComment: "tickets.reopenPlanComment",
  ticketsDeletePlanComment: "tickets.deletePlanComment",
} as const;

const TicketRpcError = Schema.Union([
  TicketNotFoundError,
  TicketRevisionConflictError,
  TicketPlanNotFoundError,
  TicketPlanRevisionConflictError,
  TicketError,
  EnvironmentAuthorizationError,
]);

const WsTicketsSubscribeRpc = Rpc.make(TICKET_WS_METHODS.ticketsSubscribe, {
  payload: Schema.Struct({}),
  success: TicketListEvent,
  error: TicketRpcError,
  stream: true,
});

const WsTicketsSubscribeDetailRpc = Rpc.make(TICKET_WS_METHODS.ticketsSubscribeDetail, {
  payload: TicketSubscribeDetailInput,
  success: TicketDetail,
  error: TicketRpcError,
  stream: true,
});

const WsTicketsSearchRpc = Rpc.make(TICKET_WS_METHODS.ticketsSearch, {
  payload: TicketSearchInput,
  success: TicketSearchResult,
  error: TicketRpcError,
});

const WsTicketsCreateRpc = Rpc.make(TICKET_WS_METHODS.ticketsCreate, {
  payload: TicketCreateInput,
  success: TicketWriteResult,
  error: TicketRpcError,
});

const WsTicketsUpdateRpc = Rpc.make(TICKET_WS_METHODS.ticketsUpdate, {
  payload: TicketUpdateInput,
  success: TicketWriteResult,
  error: TicketRpcError,
});

const WsTicketsMoveRpc = Rpc.make(TICKET_WS_METHODS.ticketsMove, {
  payload: TicketMoveInput,
  success: TicketSummary,
  error: TicketRpcError,
});

const WsTicketsDeleteRpc = Rpc.make(TICKET_WS_METHODS.ticketsDelete, {
  payload: TicketDeleteInput,
  error: TicketRpcError,
});

const WsTicketsLinkRpc = Rpc.make(TICKET_WS_METHODS.ticketsLink, {
  payload: TicketLinkInput,
  success: TicketSummary,
  error: TicketRpcError,
});

const WsTicketsUnlinkRpc = Rpc.make(TICKET_WS_METHODS.ticketsUnlink, {
  payload: TicketUnlinkInput,
  success: TicketSummary,
  error: TicketRpcError,
});

const WsTicketsCommentRpc = Rpc.make(TICKET_WS_METHODS.ticketsComment, {
  payload: TicketCommentInput,
  success: TicketSummary,
  error: TicketRpcError,
});

const WsTicketsStatusesSubscribeRpc = Rpc.make(TICKET_WS_METHODS.ticketsStatusesSubscribe, {
  payload: Schema.Struct({}),
  success: TicketStatusSet,
  error: TicketRpcError,
  stream: true,
});

const WsTicketsStatusesUpsertRpc = Rpc.make(TICKET_WS_METHODS.ticketsStatusesUpsert, {
  payload: TicketStatusUpsertInput,
  success: TicketStatusSet,
  error: TicketRpcError,
});

const WsTicketsStatusesReorderRpc = Rpc.make(TICKET_WS_METHODS.ticketsStatusesReorder, {
  payload: TicketStatusReorderInput,
  success: TicketStatusSet,
  error: TicketRpcError,
});

const WsTicketsStatusesDeleteRpc = Rpc.make(TICKET_WS_METHODS.ticketsStatusesDelete, {
  payload: TicketStatusDeleteInput,
  success: TicketStatusSet,
  error: TicketRpcError,
});

const WsTicketsSetHiddenRpc = Rpc.make(TICKET_WS_METHODS.ticketsSetHidden, {
  payload: TicketSetHiddenInput,
  success: TicketSummary,
  error: TicketRpcError,
});

const WsTicketsGitHubSourcesSubscribeRpc = Rpc.make(
  TICKET_WS_METHODS.ticketsGitHubSourcesSubscribe,
  {
    payload: Schema.Struct({}),
    success: TicketGitHubSourceSet,
    error: TicketRpcError,
    stream: true,
  },
);

/** Adds a source or turns its background sync on or off. Call syncNow to import right away. */
const WsTicketsGitHubSourcesUpsertRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubSourcesUpsert, {
  payload: TicketGitHubSourceUpsertInput,
  success: TicketGitHubSourceSet,
  error: TicketRpcError,
});

const WsTicketsGitHubSourcesRemoveRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubSourcesRemove, {
  payload: TicketGitHubSourceRemoveInput,
  success: TicketGitHubSourceSet,
  error: TicketRpcError,
});

const WsTicketsGitHubSourcesSyncNowRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubSourcesSyncNow, {
  payload: TicketGitHubSourceRef,
  success: TicketGitHubSource,
  error: TicketRpcError,
});

const WsTicketGitHubIssueDetailRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubIssueDetail, {
  payload: TicketGitHubIssueRef,
  success: TicketGitHubIssueDetail,
  error: TicketRpcError,
});
const WsTicketGitHubIssueActivityRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubIssueActivity, {
  payload: TicketGitHubIssueRef,
  success: IssueActivity,
  error: TicketRpcError,
});
const WsTicketGitHubIssueAssigneeCandidatesRpc = Rpc.make(
  TICKET_WS_METHODS.ticketsGitHubIssueAssigneeCandidates,
  { payload: TicketGitHubIssueRef, success: IssueAssigneeCandidateList, error: TicketRpcError },
);
const WsTicketGitHubIssueSetAssigneesRpc = Rpc.make(
  TICKET_WS_METHODS.ticketsGitHubIssueSetAssignees,
  { payload: TicketGitHubIssueAssigneeChangeInput, error: TicketRpcError },
);
const WsTicketGitHubIssueRefreshRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubIssueRefresh, {
  payload: TicketSubscribeDetailInput,
  success: TicketSummary,
  error: TicketRpcError,
});
const WsTicketGitHubIssueInvalidateRpc = Rpc.make(TICKET_WS_METHODS.ticketsGitHubIssueInvalidate, {
  payload: TicketLinkedIssueRef,
  error: TicketRpcError,
});
const WsTicketsIssueLinkCandidatesRpc = Rpc.make(TICKET_WS_METHODS.ticketsIssueLinkCandidates, {
  payload: TicketSubscribeDetailInput,
  success: TicketIssueLinkCandidates,
  error: TicketRpcError,
});

const WsTicketsLaunchDraftRpc = Rpc.make(TICKET_WS_METHODS.ticketsLaunchDraft, {
  payload: TicketLaunchDraftInput,
  success: TicketLaunchDraftResult,
  error: TicketRpcError,
});

const WsTicketsSubscribePlanRpc = Rpc.make(TICKET_WS_METHODS.ticketsSubscribePlan, {
  payload: TicketPlanSubscribeInput,
  success: TicketPlan,
  error: TicketRpcError,
  stream: true,
});

const WsTicketsCreatePlanRpc = Rpc.make(TICKET_WS_METHODS.ticketsCreatePlan, {
  payload: TicketPlanCreateInput,
  success: TicketPlanWriteResult,
  error: TicketRpcError,
});

const WsTicketsUpdatePlanRpc = Rpc.make(TICKET_WS_METHODS.ticketsUpdatePlan, {
  payload: TicketPlanUpdateInput,
  success: TicketPlanWriteResult,
  error: TicketRpcError,
});

const WsTicketsDeletePlanRpc = Rpc.make(TICKET_WS_METHODS.ticketsDeletePlan, {
  payload: TicketPlanDeleteInput,
  error: TicketRpcError,
});

const WsTicketsAddPlanCommentRpc = Rpc.make(TICKET_WS_METHODS.ticketsAddPlanComment, {
  payload: TicketPlanCommentInput,
  success: TicketPlanComment,
  error: TicketRpcError,
});

const WsTicketsReopenPlanCommentRpc = Rpc.make(TICKET_WS_METHODS.ticketsReopenPlanComment, {
  payload: TicketPlanCommentRefInput,
  success: TicketPlanSummary,
  error: TicketRpcError,
});

const WsTicketsDeletePlanCommentRpc = Rpc.make(TICKET_WS_METHODS.ticketsDeletePlanComment, {
  payload: TicketPlanCommentRefInput,
  success: TicketPlanSummary,
  error: TicketRpcError,
});

export const TicketsRpcGroup = RpcGroup.make(
  WsTicketsSubscribeRpc,
  WsTicketsSubscribeDetailRpc,
  WsTicketsSearchRpc,
  WsTicketsCreateRpc,
  WsTicketsUpdateRpc,
  WsTicketsMoveRpc,
  WsTicketsDeleteRpc,
  WsTicketsLinkRpc,
  WsTicketsUnlinkRpc,
  WsTicketsCommentRpc,
  WsTicketsStatusesSubscribeRpc,
  WsTicketsStatusesUpsertRpc,
  WsTicketsStatusesReorderRpc,
  WsTicketsStatusesDeleteRpc,
  WsTicketsSetHiddenRpc,
  WsTicketsGitHubSourcesSubscribeRpc,
  WsTicketsGitHubSourcesUpsertRpc,
  WsTicketsGitHubSourcesRemoveRpc,
  WsTicketsGitHubSourcesSyncNowRpc,
  WsTicketsLaunchDraftRpc,
  WsTicketGitHubIssueDetailRpc,
  WsTicketGitHubIssueActivityRpc,
  WsTicketGitHubIssueAssigneeCandidatesRpc,
  WsTicketGitHubIssueSetAssigneesRpc,
  WsTicketGitHubIssueRefreshRpc,
  WsTicketGitHubIssueInvalidateRpc,
  WsTicketsIssueLinkCandidatesRpc,
  WsTicketsSubscribePlanRpc,
  WsTicketsCreatePlanRpc,
  WsTicketsUpdatePlanRpc,
  WsTicketsDeletePlanRpc,
  WsTicketsAddPlanCommentRpc,
  WsTicketsReopenPlanCommentRpc,
  WsTicketsDeletePlanCommentRpc,
);
