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

export class IssueUnavailableError extends Schema.TaggedErrorClass<IssueUnavailableError>()(
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

export class IssueOperationError extends Schema.TaggedErrorClass<IssueOperationError>()(
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
