import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  IssueActor,
  IssueComment,
  IssueLabel,
  IssueMilestone,
  IssueState,
} from "@vetra-code/contracts";
import { decodeJsonResult } from "@vetra-code/shared/schemaJson";

const RawActor = Schema.Struct({
  login: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawLabel = Schema.Struct({
  name: Schema.String,
  color: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawMilestone = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  dueOn: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawComment = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  author: Schema.optional(Schema.NullOr(RawActor)),
  body: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  author: Schema.optional(Schema.NullOr(RawActor)),
  state: Schema.String,
  body: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
  labels: Schema.optional(Schema.Array(RawLabel)),
  assignees: Schema.optional(Schema.Array(RawActor)),
  milestone: Schema.optional(Schema.NullOr(RawMilestone)),
  comments: Schema.optional(Schema.Array(RawComment)),
});

type RawIssue = typeof RawIssue.Type;

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: IssueActor | null;
  readonly state: IssueState;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly labels: ReadonlyArray<IssueLabel>;
  readonly assignees: ReadonlyArray<IssueActor>;
  readonly milestone: IssueMilestone | null;
  readonly comments: ReadonlyArray<IssueComment>;
  readonly commentCount: number;
  readonly commentsTruncated: boolean;
}

export interface GitHubIssueListBatch {
  readonly items: ReadonlyArray<GitHubIssue>;
  /** Counted before malformed rows are skipped so one bad row cannot hide truncation. */
  readonly rawCount: number;
}

const COMMENT_LIMIT = 100;
const decodeUnknownList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeListItem = Schema.decodeUnknownExit(RawIssue);
const decodeDetail = decodeJsonResult(RawIssue);
type DecodeFailure = Cause.Cause<Schema.SchemaError>;

function actorOf(raw: typeof RawActor.Type | null | undefined): IssueActor | null {
  const login = raw?.login?.trim();
  if (!login) return null;
  return {
    login,
    name: raw?.name ?? null,
    avatarUrl: raw?.avatarUrl ?? null,
  };
}

function stateOf(raw: string): IssueState | null {
  switch (raw.trim().toLowerCase()) {
    case "open":
      return "open";
    case "closed":
      return "closed";
    default:
      return null;
  }
}

function labelsOf(raw: RawIssue["labels"]): ReadonlyArray<IssueLabel> {
  return (raw ?? []).flatMap((label) => {
    const name = label.name.trim();
    if (!name) return [];
    const color = label.color?.trim();
    return [
      {
        name,
        color: color !== undefined && /^[0-9a-f]{6}$/iu.test(color) ? color.toLowerCase() : null,
        description: label.description ?? null,
      },
    ];
  });
}

function milestoneOf(raw: RawIssue["milestone"]): IssueMilestone | null {
  if (!raw || raw.number < 1 || !raw.title.trim()) return null;
  const state = stateOf(raw.state ?? "open");
  if (state === null) return null;
  return {
    number: raw.number,
    title: raw.title.trim(),
    state,
    dueOn: raw.dueOn ?? null,
  };
}

function commentOf(raw: typeof RawComment.Type): IssueComment | null {
  const id = String(raw.id).trim();
  if (!id) return null;
  const url = raw.url?.trim();
  return {
    id,
    author: actorOf(raw.author),
    body: raw.body ?? "",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? null,
    url: url ? url : null,
  };
}

function issueOf(raw: RawIssue): GitHubIssue | null {
  const title = raw.title.trim();
  const url = raw.url.trim();
  const state = stateOf(raw.state);
  if (raw.number < 1 || !title || !url || state === null) return null;
  const comments = (raw.comments ?? []).flatMap((comment) => {
    const normalized = commentOf(comment);
    return normalized === null ? [] : [normalized];
  });
  const commentCount = raw.comments?.length ?? 0;
  return {
    number: raw.number,
    title,
    url,
    author: actorOf(raw.author),
    state,
    body: raw.body ?? "",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    closedAt: raw.closedAt ?? null,
    labels: labelsOf(raw.labels),
    assignees: (raw.assignees ?? []).flatMap((actor) => {
      const normalized = actorOf(actor);
      return normalized === null ? [] : [normalized];
    }),
    milestone: milestoneOf(raw.milestone),
    comments: comments.slice(0, COMMENT_LIMIT),
    commentCount,
    commentsTruncated: commentCount > COMMENT_LIMIT,
  };
}

export function decodeIssueListJson(
  raw: string,
): Result.Result<GitHubIssueListBatch, DecodeFailure> {
  const decoded = decodeUnknownList(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);
  const items: GitHubIssue[] = [];
  for (const value of decoded.success) {
    const row = decodeListItem(value);
    if (!Exit.isSuccess(row)) continue;
    const issue = issueOf(row.value);
    if (issue !== null) items.push(issue);
  }
  return Result.succeed({ items, rawCount: decoded.success.length });
}

export function decodeIssueDetailJson(
  raw: string,
): Result.Result<GitHubIssue, DecodeFailure | Error> {
  const decoded = decodeDetail(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);
  const issue = issueOf(decoded.success);
  return issue === null ? Result.fail(new Error("Invalid issue response")) : Result.succeed(issue);
}
