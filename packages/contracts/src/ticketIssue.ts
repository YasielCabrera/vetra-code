// The ticket workspace's own view of a linked GitHub issue, kept apart from the
// tracker-agnostic `issue.ts` that T3 Code's Issues feature owns. Both ship: tickets
// mirror one GitHub issue each, while Issues browses any connected tracker. The
// shapes differ (a ticket issue's state is `open`/`closed`; a tracker issue carries
// the tracker's own workflow state), so the names are distinct rather than merged.
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";

export const TicketIssueState = Schema.Literals(["open", "closed"]);
export type TicketIssueState = typeof TicketIssueState.Type;

export const TicketIssueListState = Schema.Literals(["all", "open", "closed"]);
export type TicketIssueListState = typeof TicketIssueListState.Type;

export const TICKET_ISSUE_ASSIGNEE_VIEWER = "@me";
export const TICKET_ISSUE_ASSIGNEE_NOBODY = "@none";

export const TicketIssueActor = Schema.Struct({
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});
export type TicketIssueActor = typeof TicketIssueActor.Type;

/** Somebody the host says may be assigned to an issue. */
export const TicketIssueAssigneeCandidate = Schema.Struct({
  ...TicketIssueActor.fields,
  /** The provider-native identity sent back unchanged when the assignment is updated. */
  id: TrimmedNonEmptyString,
  isAssigned: Schema.Boolean,
  /** The account authenticated on the environment, used for the assign-yourself shortcut. */
  isViewer: Schema.Boolean,
});
export type TicketIssueAssigneeCandidate = typeof TicketIssueAssigneeCandidate.Type;

export const TicketIssueAssigneeCandidateList = Schema.Struct({
  candidates: Schema.Array(TicketIssueAssigneeCandidate),
  /** The host has more assignable people than the bounded picker response carries. */
  truncated: Schema.Boolean,
});
export type TicketIssueAssigneeCandidateList = typeof TicketIssueAssigneeCandidateList.Type;

export const TicketIssueLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** Six hexadecimal digits without a leading hash, or null when the host supplied no color. */
  color: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
});
export type TicketIssueLabel = typeof TicketIssueLabel.Type;

export const TicketIssueMilestone = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "closed"]),
  dueOn: Schema.NullOr(IsoDateTime),
});
export type TicketIssueMilestone = typeof TicketIssueMilestone.Type;

export const TicketIssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(TicketIssueActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.NullOr(IsoDateTime),
  url: Schema.NullOr(TrimmedNonEmptyString),
});
export type TicketIssueComment = typeof TicketIssueComment.Type;

/** Another issue or pull request that caused an entry in this issue's history. */
export const TicketIssueTimelineSource = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  isPullRequest: Schema.Boolean,
});
export type TicketIssueTimelineSource = typeof TicketIssueTimelineSource.Type;

export const TicketIssueTimelineRename = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
});
export type TicketIssueTimelineRename = typeof TicketIssueTimelineRename.Type;

/** A comment as it appears in the host's chronological issue history. */
export const TicketIssueTimelineComment = Schema.Struct({
  type: Schema.Literal("comment"),
  id: TrimmedNonEmptyString,
  actor: Schema.NullOr(TicketIssueActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.NullOr(IsoDateTime),
  url: Schema.NullOr(TrimmedNonEmptyString),
});
export type TicketIssueTimelineComment = typeof TicketIssueTimelineComment.Type;

/**
 * One host-reported change to an issue. `kind` stays host-shaped so a newer GitHub event can
 * still reach an older client; the nullable context fields enrich the event kinds that carry it.
 */
export const TicketIssueTimelineEvent = Schema.Struct({
  type: Schema.Literal("event"),
  id: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  actor: Schema.NullOr(TicketIssueActor),
  createdAt: IsoDateTime,
  label: Schema.NullOr(TicketIssueLabel),
  assignee: Schema.NullOr(TicketIssueActor),
  milestoneTitle: Schema.NullOr(Schema.String),
  rename: Schema.NullOr(TicketIssueTimelineRename),
  source: Schema.NullOr(TicketIssueTimelineSource),
  commitId: Schema.NullOr(Schema.String),
  lockReason: Schema.NullOr(Schema.String),
  projectColumnName: Schema.NullOr(Schema.String),
  previousProjectColumnName: Schema.NullOr(Schema.String),
});
export type TicketIssueTimelineEvent = typeof TicketIssueTimelineEvent.Type;

export const TicketIssueTimelineItem = Schema.Union([TicketIssueTimelineComment, TicketIssueTimelineEvent]);
export type TicketIssueTimelineItem = typeof TicketIssueTimelineItem.Type;

/**
 * The history is read independently so a long GitHub timeline never holds the issue's title and
 * description off screen. `truncated` is true only when the safety bound stopped the page walk.
 */
export const TicketIssueActivity = Schema.Struct({
  items: Schema.Array(TicketIssueTimelineItem),
  truncated: Schema.Boolean,
});
export type TicketIssueActivity = typeof TicketIssueActivity.Type;

export const TicketIssueDetail = Schema.Struct({
  provider: SourceControlProviderKind,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(TicketIssueActor),
  state: TicketIssueState,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
  labels: Schema.Array(TicketIssueLabel),
  assignees: Schema.Array(TicketIssueActor),
  milestone: Schema.NullOr(TicketIssueMilestone),
  body: Schema.String,
  comments: Schema.Array(TicketIssueComment),
  commentCount: NonNegativeInt,
  /** True when the host reported more comments than the bounded detail carries. */
  commentsTruncated: Schema.Boolean,
  repositoryUrl: TrimmedNonEmptyString,
  newIssueUrl: TrimmedNonEmptyString,
});
export type TicketIssueDetail = typeof TicketIssueDetail.Type;
