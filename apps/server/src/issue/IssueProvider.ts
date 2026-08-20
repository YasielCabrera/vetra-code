import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";
import {
  type IssueActor,
  type IssueActivity,
  type IssueAssigneeCandidateList,
  type IssueComment,
  type IssueLabel,
  type IssueListState,
  type IssueMilestone,
  type IssueState,
  SourceControlProviderKind as SourceControlProviderKindSchema,
  type SourceControlProviderKind,
} from "@vetra-code/contracts";

export const IssueProviderFailureReason = Schema.Literals([
  "missing-tool",
  "unauthenticated",
  "rate-limited",
  "failed",
]);
export type IssueProviderFailureReason = typeof IssueProviderFailureReason.Type;

export class IssueProviderError extends Schema.TaggedErrorClass<IssueProviderError>()(
  "IssueProviderError",
  {
    provider: SourceControlProviderKindSchema,
    operation: Schema.String,
    reason: IssueProviderFailureReason,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ProviderIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: IssueActor | null;
  readonly state: IssueState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly labels: ReadonlyArray<IssueLabel>;
  readonly assignees: ReadonlyArray<IssueActor>;
  readonly milestone: IssueMilestone | null;
  readonly commentCount?: number;
}

export interface ProviderIssueDetail extends ProviderIssue {
  readonly body: string;
  readonly comments: ReadonlyArray<IssueComment>;
  readonly commentCount: number;
  readonly commentsTruncated: boolean;
}

export interface ProviderIssueBatch {
  readonly issues: ReadonlyArray<ProviderIssue>;
  readonly truncated: boolean;
}

/** The inclusive update boundary and issue numbers already delivered at that exact instant. */
export interface ProviderIssueListCursor {
  readonly updatedBefore: string;
  readonly seenAt: ReadonlyArray<number>;
}

export interface IssueProviderApi {
  readonly kind: SourceControlProviderKind;
  readonly repositoryLinks: (input: {
    readonly host: string;
    readonly repository: string;
  }) => { readonly repositoryUrl: string; readonly newIssueUrl: string } | null;
  readonly listIssues: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly state: IssueListState;
    readonly limit: number;
    readonly query?: string;
    readonly cursor?: ProviderIssueListCursor;
  }) => Effect.Effect<ProviderIssueBatch, IssueProviderError>;
  readonly getIssue: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<ProviderIssueDetail, IssueProviderError>;
  readonly getIssueActivity: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<IssueActivity, IssueProviderError>;
  /** People the host permits this issue to be assigned to. Read only when the picker opens. */
  readonly listAssigneeCandidates: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
  }) => Effect.Effect<IssueAssigneeCandidateList, IssueProviderError>;
  readonly setAssignees: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
    readonly assignees: ReadonlyArray<string>;
    readonly assigned: boolean;
  }) => Effect.Effect<void, IssueProviderError>;
}
