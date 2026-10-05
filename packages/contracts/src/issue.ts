import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

export const IssueListState = Schema.Literals(["all", "open", "closed"]);
export type IssueListState = typeof IssueListState.Type;

export const ISSUE_ASSIGNEE_VIEWER = "@me";
export const ISSUE_ASSIGNEE_NOBODY = "@none";

export const IssueActor = Schema.Struct({
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
});
export type IssueActor = typeof IssueActor.Type;

/** Somebody the host says may be assigned to an issue. */
export const IssueAssigneeCandidate = Schema.Struct({
  ...IssueActor.fields,
  /** The provider-native identity sent back unchanged when the assignment is updated. */
  id: TrimmedNonEmptyString,
  isAssigned: Schema.Boolean,
  /** The account authenticated on the environment, used for the assign-yourself shortcut. */
  isViewer: Schema.Boolean,
});
export type IssueAssigneeCandidate = typeof IssueAssigneeCandidate.Type;

export const IssueAssigneeCandidateList = Schema.Struct({
  candidates: Schema.Array(IssueAssigneeCandidate),
  /** The host has more assignable people than the bounded picker response carries. */
  truncated: Schema.Boolean,
});
export type IssueAssigneeCandidateList = typeof IssueAssigneeCandidateList.Type;

export const IssueLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** Six hexadecimal digits without a leading hash, or null when the host supplied no color. */
  color: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
});
export type IssueLabel = typeof IssueLabel.Type;

export const IssueMilestone = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "closed"]),
  dueOn: Schema.NullOr(IsoDateTime),
});
export type IssueMilestone = typeof IssueMilestone.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(IssueActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.NullOr(IsoDateTime),
  url: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueComment = typeof IssueComment.Type;

/** Another issue or pull request that caused an entry in this issue's history. */
export const IssueTimelineSource = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  isPullRequest: Schema.Boolean,
});
export type IssueTimelineSource = typeof IssueTimelineSource.Type;

export const IssueTimelineRename = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
});
export type IssueTimelineRename = typeof IssueTimelineRename.Type;

/** A comment as it appears in the host's chronological issue history. */
export const IssueTimelineComment = Schema.Struct({
  type: Schema.Literal("comment"),
  id: TrimmedNonEmptyString,
  actor: Schema.NullOr(IssueActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: Schema.NullOr(IsoDateTime),
  url: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueTimelineComment = typeof IssueTimelineComment.Type;

/**
 * One host-reported change to an issue. `kind` stays host-shaped so a newer GitHub event can
 * still reach an older client; the nullable context fields enrich the event kinds that carry it.
 */
export const IssueTimelineEvent = Schema.Struct({
  type: Schema.Literal("event"),
  id: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  actor: Schema.NullOr(IssueActor),
  createdAt: IsoDateTime,
  label: Schema.NullOr(IssueLabel),
  assignee: Schema.NullOr(IssueActor),
  milestoneTitle: Schema.NullOr(Schema.String),
  rename: Schema.NullOr(IssueTimelineRename),
  source: Schema.NullOr(IssueTimelineSource),
  commitId: Schema.NullOr(Schema.String),
  lockReason: Schema.NullOr(Schema.String),
  projectColumnName: Schema.NullOr(Schema.String),
  previousProjectColumnName: Schema.NullOr(Schema.String),
});
export type IssueTimelineEvent = typeof IssueTimelineEvent.Type;

export const IssueTimelineItem = Schema.Union([IssueTimelineComment, IssueTimelineEvent]);
export type IssueTimelineItem = typeof IssueTimelineItem.Type;

/**
 * The history is read independently so a long GitHub timeline never holds the issue's title and
 * description off screen. `truncated` is true only when the safety bound stopped the page walk.
 */
export const IssueActivity = Schema.Struct({
  items: Schema.Array(IssueTimelineItem),
  truncated: Schema.Boolean,
});
export type IssueActivity = typeof IssueActivity.Type;

export const IssueDetail = Schema.Struct({
  provider: SourceControlProviderKind,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(IssueActor),
  state: IssueState,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  closedAt: Schema.NullOr(IsoDateTime),
  labels: Schema.Array(IssueLabel),
  assignees: Schema.Array(IssueActor),
  milestone: Schema.NullOr(IssueMilestone),
  body: Schema.String,
  comments: Schema.Array(IssueComment),
  commentCount: NonNegativeInt,
  /** True when the host reported more comments than the bounded detail carries. */
  commentsTruncated: Schema.Boolean,
  repositoryUrl: TrimmedNonEmptyString,
  newIssueUrl: TrimmedNonEmptyString,
});
export type IssueDetail = typeof IssueDetail.Type;
