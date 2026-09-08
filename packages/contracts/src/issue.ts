import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/unstable/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

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

export const IssueListEntry = Schema.Struct({
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
  /** The host's count, absent when its listing does not report one. */
  commentCount: Schema.optional(NonNegativeInt),
});
export type IssueListEntry = typeof IssueListEntry.Type;

/**
 * Where each repository carries on, keyed `"<host> <repository>"`. Values are opaque to clients:
 * only the issue service parses a cursor it previously issued.
 */
export const IssueListCursors = Schema.Record(
  TrimmedNonEmptyString,
  TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
);
export type IssueListCursors = typeof IssueListCursors.Type;

/**
 * Who an issue is assigned to, as the host's own `assignee:` qualifier reads it.
 *
 * `@me` is whoever the environment is signed in as, left for the host to resolve rather than
 * looked up here — GitHub answers it against the same credentials that read the list, which is
 * the only account that could be meant. `@none` asks for the rows nobody is assigned to.
 * Neither sentinel can collide with an account name, since no host lets one start with `@`.
 *
 * Anything else is one account name, bounded to characters a host can call an account by: no
 * colon, quote, space or leading dash, so a value cannot carry a second qualifier — or a
 * negation of the one it is in — into the search expression it is written to.
 */
const ISSUE_ASSIGNEE_FILTER_PATTERN = /^(?:@me|@none|[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;
export const IssueAssigneeFilter = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(ISSUE_ASSIGNEE_FILTER_PATTERN),
);
export type IssueAssigneeFilter = typeof IssueAssigneeFilter.Type;

/** The signed-in account, whoever the host says that is. */
export const ISSUE_ASSIGNEE_VIEWER = "@me";
/** The rows nobody is assigned to. */
export const ISSUE_ASSIGNEE_NOBODY = "@none";

/**
 * Whether a value is one the listing would accept, for callers that must drop a bad one rather
 * than fail on it — a link carrying a hand-edited query string reaches the page before it
 * reaches the schema.
 */
export function isIssueAssigneeFilter(value: string): boolean {
  return ISSUE_ASSIGNEE_FILTER_PATTERN.test(value.trim());
}

export const IssueListInput = Schema.Struct({
  state: IssueListState,
  projectId: Schema.optional(ProjectId),
  projectIds: Schema.optional(Schema.Array(ProjectId).check(Schema.isMaxLength(100))),
  host: Schema.optional(TrimmedNonEmptyString),
  /** Rows per repository in this slice. One extra row detects whether another slice exists. */
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 }))),
  /**
   * Carry on only the repositories named here. Absent starts every selected repository from its
   * newest issue; clients return `nextCursors` unchanged to request the next slice.
   */
  cursors: Schema.optional(IssueListCursors),
  /** Bounded before it is escaped into the host's own search expression. */
  query: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  /**
   * Narrows to the issues one person is assigned to. Narrowed by the host rather than over the
   * rows it returns: a page holds one slice of each repository, and judging the slice would
   * answer "nobody" for somebody whose issues are two pages down.
   */
  assignee: Schema.optional(IssueAssigneeFilter),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueProviderSummary = Schema.Struct({
  host: TrimmedNonEmptyString,
  kind: SourceControlProviderKind,
  projectCount: PositiveInt,
  configured: Schema.Boolean,
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type IssueProviderSummary = typeof IssueProviderSummary.Type;

export const IssueRepositorySummary = Schema.Struct({
  provider: SourceControlProviderKind,
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  repositoryUrl: TrimmedNonEmptyString,
  newIssueUrl: TrimmedNonEmptyString,
});
export type IssueRepositorySummary = typeof IssueRepositorySummary.Type;

export const IssueListProjectError = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  /** True when retrying the same page can recover this repository and must precede pagination. */
  retryable: Schema.optional(Schema.Boolean),
});
export type IssueListProjectError = typeof IssueListProjectError.Type;

export const IssueListResult = Schema.Struct({
  providers: Schema.Array(IssueProviderSummary),
  repositories: Schema.Array(IssueRepositorySummary),
  entries: Schema.Array(IssueListEntry),
  errors: Schema.Array(IssueListProjectError),
  /** At least one repository has another page available. */
  truncated: Schema.Boolean,
  /** Repositories with another page, to be sent back as the next input's `cursors`. */
  nextCursors: IssueListCursors,
});
export type IssueListResult = typeof IssueListResult.Type;

export const IssueRef = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type IssueRef = typeof IssueRef.Type;

/** Adds or removes one or more candidates exactly as the host identified them. */
export const IssueAssigneeChangeInput = Schema.Struct({
  ...IssueRef.fields,
  assignees: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10),
  ),
  assigned: Schema.Boolean,
});
export type IssueAssigneeChangeInput = typeof IssueAssigneeChangeInput.Type;

export const IssueInvalidateInput = Schema.Struct({
  reference: Schema.optional(IssueRef),
});
export type IssueInvalidateInput = typeof IssueInvalidateInput.Type;

export const IssueDetail = Schema.Struct({
  ...IssueListEntry.fields,
  body: Schema.String,
  comments: Schema.Array(IssueComment),
  commentCount: NonNegativeInt,
  /** True when the host reported more comments than the bounded detail carries. */
  commentsTruncated: Schema.Boolean,
  repositoryUrl: TrimmedNonEmptyString,
  newIssueUrl: TrimmedNonEmptyString,
});
export type IssueDetail = typeof IssueDetail.Type;

export const IssueUnavailableReason = Schema.Literals([
  "cli-missing",
  "cli-unauthenticated",
  "provider-unsupported",
]);
export type IssueUnavailableReason = typeof IssueUnavailableReason.Type;

const GITHUB_REQUIREMENTS = {
  missing:
    "GitHub CLI (`gh`) is required to browse issues on this host. Install it from https://cli.github.com/ and reload.",
  unauthenticated: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
} as const;

export class IssueUnavailableError extends Schema.TaggedError<IssueUnavailableError>()(
  "IssueUnavailableError",
  {
    reason: IssueUnavailableReason,
    provider: Schema.optional(SourceControlProviderKind),
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(IssueUnavailableError)(this, { status: 503 });
  }

  override get message(): string {
    switch (this.reason) {
      case "cli-missing":
        return this.provider === "github"
          ? GITHUB_REQUIREMENTS.missing
          : "The tool this host is read through is not installed or set up.";
      case "cli-unauthenticated":
        return this.provider === "github"
          ? GITHUB_REQUIREMENTS.unauthenticated
          : "This host has no working credentials.";
      case "provider-unsupported":
        return "Issues cannot be browsed for this project's host yet.";
    }
  }
}

export class IssueOperationError extends Schema.TaggedError<IssueOperationError>()(
  "IssueOperationError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(IssueOperationError)(this, { status: 502 });
  }

  override get message(): string {
    return `Issue operation ${this.operation} failed: ${this.detail}`;
  }
}
