import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  IssueActor,
  IssueAssigneeCandidate,
  IssueAssigneeCandidateList,
  IssueComment,
  IssueLabel,
  IssueMilestone,
  IssueState,
  IssueTimelineEvent,
  IssueTimelineItem,
  IssueTimelineSource,
} from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

const RawActor = Schema.Struct({
  login: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawPageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
});

const RawAssigneeCandidates = Schema.Struct({
  data: Schema.Struct({
    viewer: Schema.optional(Schema.NullOr(RawActor)),
    repository: Schema.NullOr(
      Schema.Struct({
        assignableUsers: Schema.Struct({
          pageInfo: Schema.optional(RawPageInfo),
          nodes: Schema.Array(Schema.NullOr(RawActor)),
        }),
        issue: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              assignees: Schema.optional(
                Schema.Struct({
                  nodes: Schema.Array(Schema.NullOr(RawActor)),
                }),
              ),
            }),
          ),
        ),
      }),
    ),
  }),
});

export const ISSUE_ASSIGNEE_CANDIDATES_GRAPHQL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100) {
      pageInfo { hasNextPage }
      nodes { login name avatarUrl }
    }
    issue(number: $number) {
      assignees(first: 100) { nodes { login name avatarUrl } }
    }
  }
}`;

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
  body: Schema.optional(Schema.NullOr(Schema.String)),
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

const RawTimelineSourceIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.optional(Schema.String),
  html_url: Schema.optional(Schema.String),
  pull_request: Schema.optional(Schema.Unknown),
});

const RawTimelineItem = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  node_id: Schema.optional(Schema.String),
  event: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.NullOr(RawActor)),
  user: Schema.optional(Schema.NullOr(RawActor)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  label: Schema.optional(Schema.NullOr(RawLabel)),
  assignee: Schema.optional(Schema.NullOr(RawActor)),
  milestone: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        title: Schema.optional(Schema.String),
      }),
    ),
  ),
  rename: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        from: Schema.optional(Schema.String),
        to: Schema.optional(Schema.String),
      }),
    ),
  ),
  source: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        issue: Schema.optional(Schema.NullOr(RawTimelineSourceIssue)),
      }),
    ),
  ),
  commit_id: Schema.optional(Schema.NullOr(Schema.String)),
  lock_reason: Schema.optional(Schema.NullOr(Schema.String)),
  project_card: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        column_name: Schema.optional(Schema.String),
        previous_column_name: Schema.optional(Schema.String),
      }),
    ),
  ),
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

export interface GitHubIssueTimelinePage {
  readonly items: ReadonlyArray<IssueTimelineItem>;
  /** Counted before malformed rows are skipped so pagination follows the host, not the decoder. */
  readonly rawCount: number;
}

const COMMENT_LIMIT = 100;
const decodeUnknownList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeListItem = Schema.decodeUnknownExit(RawIssue);
const decodeTimelineItem = Schema.decodeUnknownExit(RawTimelineItem);
const decodeDetail = decodeJsonResult(RawIssue);
const decodeAssigneeCandidates = decodeJsonResult(RawAssigneeCandidates);
type DecodeFailure = Cause.Cause<Schema.SchemaError>;

function actorOf(raw: typeof RawActor.Type | null | undefined): IssueActor | null {
  const login = raw?.login?.trim();
  if (!login) return null;
  return {
    login,
    name: raw?.name ?? null,
    avatarUrl: raw?.avatarUrl ?? raw?.avatar_url ?? null,
  };
}

function timelineLabelOf(raw: typeof RawLabel.Type | null | undefined): IssueLabel | null {
  if (raw === null || raw === undefined) return null;
  const [label] = labelsOf([raw]);
  return label ?? null;
}

function timelineSourceOf(
  raw: typeof RawTimelineSourceIssue.Type | null | undefined,
  host: string,
): IssueTimelineSource | null {
  const urlText = raw?.html_url?.trim();
  if (!raw || raw.number < 1 || !urlText) return null;
  try {
    const url = new URL(urlText);
    if (url.protocol !== "https:" || url.username || url.password || url.host !== host) return null;
    const match = /^\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)\/?$/u.exec(
      decodeURIComponent(url.pathname),
    );
    if (match === null || Number(match[3]) !== raw.number) return null;
    const title = raw.title?.trim();
    return {
      number: raw.number,
      title: title || `#${raw.number}`,
      url: url.toString(),
      repository: match[1]!,
      isPullRequest: match[2] === "pull" || raw.pull_request !== undefined,
    };
  } catch {
    return null;
  }
}

function timelineItemOf(
  raw: typeof RawTimelineItem.Type,
  host: string,
  index: number,
): IssueTimelineItem | null {
  const event = raw.event?.trim();
  if (!event || event.length > 100) return null;
  const id = String(raw.id ?? raw.node_id ?? `${event}:${raw.created_at}:${index}`).trim();
  if (!id) return null;
  if (event === "commented") {
    const url = raw.html_url?.trim();
    return {
      type: "comment",
      id,
      actor: actorOf(raw.actor ?? raw.user),
      body: raw.body ?? "",
      createdAt: raw.created_at,
      updatedAt: raw.updated_at ?? null,
      url: url ? url : null,
    };
  }
  const milestoneTitle = raw.milestone?.title?.trim();
  const rename = raw.rename;
  return {
    type: "event",
    id,
    kind: event,
    actor: actorOf(raw.actor),
    createdAt: raw.created_at,
    label: timelineLabelOf(raw.label),
    assignee: actorOf(raw.assignee),
    milestoneTitle: milestoneTitle || null,
    rename:
      rename === null || rename === undefined
        ? null
        : { from: rename.from ?? "", to: rename.to ?? "" },
    source: timelineSourceOf(raw.source?.issue, host),
    commitId: raw.commit_id?.trim() || null,
    lockReason: raw.lock_reason?.trim() || null,
    projectColumnName: raw.project_card?.column_name?.trim() || null,
    previousProjectColumnName: raw.project_card?.previous_column_name?.trim() || null,
  } satisfies IssueTimelineEvent;
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

export function decodeIssueTimelineJson(
  raw: string,
  host: string,
): Result.Result<GitHubIssueTimelinePage, DecodeFailure> {
  const decoded = decodeUnknownList(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);
  const items: IssueTimelineItem[] = [];
  for (const [index, value] of decoded.success.entries()) {
    const row = decodeTimelineItem(value);
    if (!Exit.isSuccess(row)) continue;
    const item = timelineItemOf(row.value, host, index);
    if (item !== null) items.push(item);
  }
  return Result.succeed({ items, rawCount: decoded.success.length });
}

/** Assigned people lead the picker so an assignment can always be removed again. */
export function decodeIssueAssigneeCandidatesJson(
  raw: string,
): Result.Result<IssueAssigneeCandidateList, DecodeFailure> {
  const decoded = decodeAssigneeCandidates(raw);
  if (!Result.isSuccess(decoded)) return Result.fail(decoded.failure);
  const repository = decoded.success.data.repository;
  if (repository === null) return Result.succeed({ candidates: [], truncated: false });

  const viewerLogin = actorOf(decoded.success.data.viewer)?.login.toLowerCase() ?? null;
  const candidates = new Map<string, IssueAssigneeCandidate>();
  for (const node of repository.issue?.assignees?.nodes ?? []) {
    const actor = actorOf(node);
    if (actor === null) continue;
    const key = actor.login.toLowerCase();
    candidates.set(key, {
      ...actor,
      id: actor.login,
      isAssigned: true,
      isViewer: key === viewerLogin,
    });
  }
  for (const node of repository.assignableUsers.nodes) {
    const actor = actorOf(node);
    if (actor === null) continue;
    const key = actor.login.toLowerCase();
    const assigned = candidates.get(key)?.isAssigned === true;
    candidates.set(key, {
      ...actor,
      id: actor.login,
      isAssigned: assigned,
      isViewer: key === viewerLogin,
    });
  }
  return Result.succeed({
    candidates: [...candidates.values()],
    truncated: repository.assignableUsers.pageInfo?.hasNextPage === true,
  });
}
