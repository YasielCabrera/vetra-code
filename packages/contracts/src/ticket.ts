import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TicketId,
  TicketPlanId,
  TicketStatusId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ChatFileAttachment,
  ChatImageAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "./chatAttachment.ts";
import { IssueState } from "./issue.ts";
import { PullRequestState } from "./pullRequest.ts";

/**
 * Tickets are an environment's board of pending work. A `local` ticket is owned
 * by Vetra; a `github` ticket mirrors one GitHub issue, which owns its title,
 * body and labels, while Vetra owns its status, links, attachments and notes.
 */

export const TicketStatusCategory = Schema.Literals(["open", "active", "closed"]);
export type TicketStatusCategory = typeof TicketStatusCategory.Type;

/** The GitHub close reason a closed status maps onto. */
export const TicketCloseReason = Schema.Literals(["completed", "not_planned"]);
export type TicketCloseReason = typeof TicketCloseReason.Type;

export const TicketStatusColor = Schema.Literals([
  "gray",
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "amber",
  "green",
]);
export type TicketStatusColor = typeof TicketStatusColor.Type;

const TicketStatusBase = {
  id: TicketStatusId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  color: TicketStatusColor,
  position: NonNegativeInt,
  collapsedByDefault: Schema.Boolean,
  /** Each category has exactly one default: where new and reopened tickets land. */
  isDefault: Schema.Boolean,
};

export const TicketStatusDefinition = Schema.Union([
  Schema.Struct({ ...TicketStatusBase, category: Schema.Literals(["open", "active"]) }),
  Schema.Struct({
    ...TicketStatusBase,
    category: Schema.Literal("closed"),
    closeReason: TicketCloseReason,
  }),
]);
export type TicketStatusDefinition = typeof TicketStatusDefinition.Type;

/** Every category keeps at least one status and exactly one default. Ordered by position. */
export const TicketStatusSet = Schema.Struct({
  statuses: Schema.Array(TicketStatusDefinition),
});
export type TicketStatusSet = typeof TicketStatusSet.Type;

export const TicketActor = Schema.Union([
  Schema.Struct({ type: Schema.Literal("user") }),
  Schema.Struct({ type: Schema.Literal("agent"), threadId: ThreadId }),
  Schema.Struct({ type: Schema.Literal("sync") }),
  Schema.Struct({ type: Schema.Literal("automation") }),
]);
export type TicketActor = typeof TicketActor.Type;

/** A pull request or issue on a code host. Same identity as `ThreadPullRequestKey`. */
export const TicketGitHubRef = Schema.Struct({
  host: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type TicketGitHubRef = typeof TicketGitHubRef.Type;

export const TicketLinkTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({
    kind: Schema.Literal("pull_request"),
    ref: TicketGitHubRef,
    /** Captured at link time, so the link renders without a host round trip. */
    snapshot: Schema.Struct({
      title: Schema.String,
      state: PullRequestState,
      url: TrimmedNonEmptyString,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("issue"),
    ref: TicketGitHubRef,
    snapshot: Schema.Struct({
      title: Schema.String,
      state: IssueState,
      url: TrimmedNonEmptyString,
    }),
  }),
]);
export type TicketLinkTarget = typeof TicketLinkTarget.Type;

export const TicketLinkKind = Schema.Literals(["project", "thread", "pull_request", "issue"]);
export type TicketLinkKind = typeof TicketLinkKind.Type;

export const TicketLinkSource = Schema.Literals(["user", "agent", "auto"]);
export type TicketLinkSource = typeof TicketLinkSource.Type;

export const TicketLink = Schema.Struct({
  target: TicketLinkTarget,
  source: TicketLinkSource,
  createdAt: IsoDateTime,
});
export type TicketLink = typeof TicketLink.Type;

export function ticketLinkTargetKey(target: TicketLinkTarget): string {
  switch (target.kind) {
    case "project":
      return target.projectId;
    case "thread":
      return target.threadId;
    case "pull_request":
    case "issue":
      return `${target.ref.host}/${target.ref.repository}#${target.ref.number}`;
  }
}

export const TicketLinkRef = Schema.Struct({
  kind: TicketLinkKind,
  targetKey: TrimmedNonEmptyString,
});
export type TicketLinkRef = typeof TicketLinkRef.Type;

export const GitHubIssueSnapshot = Schema.Struct({
  /** A failed post-write read leaves updatedAt stale; sync must confirm contradictory state. */
  stateNeedsConfirmation: Schema.optional(Schema.Boolean),
  ...TicketGitHubRef.fields,
  state: IssueState,
  stateReason: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  assignees: Schema.Array(Schema.String),
  updatedAt: IsoDateTime,
  syncedAt: IsoDateTime,
  url: TrimmedNonEmptyString,
});
export type GitHubIssueSnapshot = typeof GitHubIssueSnapshot.Type;

export const TicketPlanStatus = Schema.Literals(["active", "archived"]);
export type TicketPlanStatus = typeof TicketPlanStatus.Type;

export const TicketPlanReviewStatus = Schema.Literals(["draft", "ready"]);
export type TicketPlanReviewStatus = typeof TicketPlanReviewStatus.Type;

/**
 * A plan without its body, as every ticket summary lists it. Lives here rather than in
 * `ticketPlan.ts` because `TicketSummary` embeds it and `ticketPlan.ts` imports this module.
 */
export const TicketPlanSummary = Schema.Struct({
  planId: TicketPlanId,
  ticketId: TicketId,
  /** `T-42/P1`: the ticket's number and the plan's per-ticket number. */
  ref: TrimmedNonEmptyString,
  /** Never reused within its ticket, like ticket numbers. */
  number: PositiveInt,
  title: Schema.String,
  status: TicketPlanStatus,
  reviewStatus: TicketPlanReviewStatus.pipe(Schema.withDecodingDefault(Effect.succeed("draft"))),
  /** Bumps only when the title or body changes; review, archiving and comments leave it alone. */
  revision: PositiveInt,
  /** Unresolved top-level comments; replies never count. */
  openCommentCount: NonNegativeInt,
  createdBy: TicketActor,
  updatedBy: TicketActor,
  updatedAt: IsoDateTime,
});
export type TicketPlanSummary = typeof TicketPlanSummary.Type;

const TicketSummaryBase = {
  id: TicketId,
  /** The environment-wide sequence number behind the `T-42` reference. */
  number: PositiveInt,
  title: Schema.String,
  labels: Schema.Array(Schema.String),
  statusId: TicketStatusId,
  /** Fractional index within the status column; compare as plain strings. */
  sortKey: TrimmedNonEmptyString,
  /**
   * Bumps when the title, body, labels, status or sort key change, the fields two editors can
   * overwrite each other on. `update` and `move` name the revision they edited and conflict if
   * such a change landed since. Links, comments and attachments leave it alone.
   */
  revision: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdBy: TicketActor,
  linkRefs: Schema.Array(TicketLinkRef),
  attachmentCount: NonNegativeInt,
  /** Ordered by number, archived ones included. Servers older than plans omit it. */
  plans: Schema.Array(TicketPlanSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
};

export const TicketSummary = Schema.Union([
  Schema.Struct({ ...TicketSummaryBase, kind: Schema.Literal("local") }),
  Schema.Struct({
    ...TicketSummaryBase,
    kind: Schema.Literal("github"),
    github: GitHubIssueSnapshot,
    /** Set when the user stops tracking the issue or its repository stops syncing; sync skips it. */
    hiddenAt: Schema.NullOr(IsoDateTime),
  }),
]);
export type TicketSummary = typeof TicketSummary.Type;

export const TicketAttachment = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: Schema.Literals(["image", "file"]),
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type TicketAttachment = typeof TicketAttachment.Type;

export const TicketEditableField = Schema.Literals(["title", "body", "labels"]);
export type TicketEditableField = typeof TicketEditableField.Type;

export const TicketActivityEntry = Schema.Union([
  Schema.Struct({ type: Schema.Literal("created") }),
  Schema.Struct({ type: Schema.Literal("edited"), fields: Schema.Array(TicketEditableField) }),
  Schema.Struct({
    type: Schema.Literal("status_changed"),
    from: TicketStatusId,
    to: TicketStatusId,
  }),
  Schema.Struct({ type: Schema.Literal("linked"), target: TicketLinkTarget }),
  Schema.Struct({
    type: Schema.Literal("unlinked"),
    kind: TicketLinkKind,
    targetKey: TrimmedNonEmptyString,
  }),
  Schema.Struct({ type: Schema.Literal("comment"), body: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("attachment_added"),
    attachmentId: TrimmedNonEmptyString,
    name: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("attachment_removed"),
    attachmentId: TrimmedNonEmptyString,
    name: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("synced"), changes: Schema.Array(TrimmedNonEmptyString) }),
  Schema.Struct({
    type: Schema.Literal("plan_review_status_changed"),
    planId: TicketPlanId,
    number: PositiveInt,
    from: TicketPlanReviewStatus,
    to: TicketPlanReviewStatus,
  }),
  Schema.Struct({
    type: Schema.Literals([
      "plan_created",
      "plan_edited",
      "plan_archived",
      "plan_restored",
      "plan_deleted",
    ]),
    planId: TicketPlanId,
    number: PositiveInt,
  }),
]);
export type TicketActivityEntry = typeof TicketActivityEntry.Type;

export const TicketActivity = Schema.Struct({
  id: PositiveInt,
  ticketId: TicketId,
  actor: TicketActor,
  createdAt: IsoDateTime,
  entry: TicketActivityEntry,
});
export type TicketActivity = typeof TicketActivity.Type;

/** How much history a detail read carries, newest last. */
export const TICKET_DETAIL_ACTIVITY_LIMIT = 200;

export const TicketDetail = Schema.Struct({
  summary: TicketSummary,
  body: Schema.String,
  links: Schema.Array(TicketLink),
  attachments: Schema.Array(TicketAttachment),
  activity: Schema.Array(TicketActivity),
});
export type TicketDetail = typeof TicketDetail.Type;

/**
 * `tickets.subscribe`: one snapshot of every summary, then deltas. A delta carries the current
 * summary of every ticket that changed since the last one, and the ids of those deleted.
 */
export const TicketListEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), tickets: Schema.Array(TicketSummary) }),
  Schema.Struct({
    type: Schema.Literal("delta"),
    upserted: Schema.Array(TicketSummary),
    removed: Schema.Array(TicketId),
  }),
]);
export type TicketListEvent = typeof TicketListEvent.Type;

/** An upload a write claimed: the pending id the client sent and the id the ticket keeps. */
export const TicketClaimedAttachment = Schema.Struct({
  pendingId: TrimmedNonEmptyString,
  attachmentId: TrimmedNonEmptyString,
});
export type TicketClaimedAttachment = typeof TicketClaimedAttachment.Type;

/** What `create` and `update` return: the summary and the uploads they claimed, in input order. */
export const TicketWriteResult = Schema.Struct({
  ticket: TicketSummary,
  attachments: Schema.Array(TicketClaimedAttachment),
});
export type TicketWriteResult = typeof TicketWriteResult.Type;

export const TicketTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(500));
export const TICKET_BODY_MAX_CHARS = 100_000;
export const TICKET_LABELS_MAX_COUNT = 50;
export const TICKET_LINKS_MAX_COUNT = 100;
export const TICKET_REMOVE_ATTACHMENT_IDS_MAX_COUNT = 100;

const TicketBody = Schema.String.check(
  Schema.isMaxLength(TICKET_BODY_MAX_CHARS, {
    message: "Ticket descriptions can contain up to 100,000 characters.",
  }),
);
const TicketLabels = Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(100))).check(
  Schema.isMaxLength(TICKET_LABELS_MAX_COUNT, { message: "Tickets can have up to 50 labels." }),
);
export const TicketAttachmentUploads = Schema.Array(
  Schema.Union([ChatImageAttachment, ChatFileAttachment]),
).check(
  Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS, {
    message: "You can attach up to 100 files per ticket write.",
  }),
);

export const AgentTicketLocalAttachment = Schema.Struct({
  path: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096)).annotate({
    description: "Absolute file path on this server environment. The source remains untouched.",
  }),
  ref: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)).annotate({
      description: "Optional unique alias for vetra-attachment://<ref> in the supplied body.",
    }),
  ),
});
export type AgentTicketLocalAttachment = typeof AgentTicketLocalAttachment.Type;

export const TicketCreateInput = Schema.Struct({
  title: TicketTitle,
  body: Schema.optional(TicketBody),
  labels: Schema.optional(TicketLabels),
  /** Defaults to the open category's default status. */
  statusId: Schema.optional(TicketStatusId),
  links: Schema.optional(
    Schema.Array(TicketLinkTarget).check(Schema.isMaxLength(TICKET_LINKS_MAX_COUNT)),
  ),
  /**
   * The body may reference these as `vetra-attachment://<pending id>`; the server rewrites them
   * and returns each pending id's new id.
   */
  attachments: Schema.optional(TicketAttachmentUploads),
});
export type TicketCreateInput = typeof TicketCreateInput.Type;

export const TicketUpdateInput = Schema.Struct({
  ticketId: TicketId,
  expectedRevision: PositiveInt,
  title: Schema.optional(TicketTitle),
  body: Schema.optional(TicketBody),
  labels: Schema.optional(TicketLabels),
  attachments: Schema.optional(TicketAttachmentUploads),
  removeAttachmentIds: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).check(
      Schema.isMaxLength(TICKET_REMOVE_ATTACHMENT_IDS_MAX_COUNT),
    ),
  ),
});
export type TicketUpdateInput = typeof TicketUpdateInput.Type;

export const TicketMoveInput = Schema.Struct({
  ticketId: TicketId,
  expectedRevision: PositiveInt,
  statusId: TicketStatusId,
  sortKey: TrimmedNonEmptyString,
});
export type TicketMoveInput = typeof TicketMoveInput.Type;

export const TicketDeleteInput = Schema.Struct({ ticketId: TicketId });
export type TicketDeleteInput = typeof TicketDeleteInput.Type;

export const TicketLinkInput = Schema.Struct({ ticketId: TicketId, target: TicketLinkTarget });
export type TicketLinkInput = typeof TicketLinkInput.Type;

export const TicketUnlinkInput = Schema.Struct({
  ticketId: TicketId,
  kind: TicketLinkKind,
  targetKey: TrimmedNonEmptyString,
});
export type TicketUnlinkInput = typeof TicketUnlinkInput.Type;

export const TicketCommentInput = Schema.Struct({
  ticketId: TicketId,
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
});
export type TicketCommentInput = typeof TicketCommentInput.Type;

export const TicketSubscribeDetailInput = Schema.Struct({ ticketId: TicketId });
export type TicketSubscribeDetailInput = typeof TicketSubscribeDetailInput.Type;

export const TicketSearchInput = Schema.Struct({
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
});
export type TicketSearchInput = typeof TicketSearchInput.Type;

export const TicketSearchResult = Schema.Struct({
  truncated: Schema.Boolean,
  hits: Schema.Array(
    Schema.Struct({
      ticketId: TicketId,
      number: PositiveInt,
      title: Schema.String,
      /** Matched text with the hit wrapped in `[` and `]`. */
      snippet: Schema.String,
    }),
  ),
});
export type TicketSearchResult = typeof TicketSearchResult.Type;

const TicketStatusUpsertBase = {
  /** Omit to add a status. */
  statusId: Schema.optional(TicketStatusId),
  name: TicketStatusBase.name,
  color: TicketStatusColor,
  collapsedByDefault: Schema.optional(Schema.Boolean),
  /** Setting a default moves the category's default here; it cannot be unset directly. */
  isDefault: Schema.optional(Schema.Boolean),
};

export const TicketStatusUpsertInput = Schema.Union([
  Schema.Struct({ ...TicketStatusUpsertBase, category: Schema.Literals(["open", "active"]) }),
  Schema.Struct({
    ...TicketStatusUpsertBase,
    category: Schema.Literal("closed"),
    closeReason: TicketCloseReason,
  }),
]);
export type TicketStatusUpsertInput = typeof TicketStatusUpsertInput.Type;

/** Every status id, in the new board order. */
export const TicketStatusReorderInput = Schema.Struct({
  statusIds: Schema.Array(TicketStatusId),
});
export type TicketStatusReorderInput = typeof TicketStatusReorderInput.Type;

export const TicketStatusDeleteInput = Schema.Struct({
  statusId: TicketStatusId,
  /** The status that inherits the deleted status's tickets. */
  reassignTo: TicketStatusId,
});
export type TicketStatusDeleteInput = typeof TicketStatusDeleteInput.Type;

export const TicketSetHiddenInput = Schema.Struct({ ticketId: TicketId, hidden: Schema.Boolean });
export type TicketSetHiddenInput = typeof TicketSetHiddenInput.Type;

/**
 * A GitHub repository whose open issues sync in as tickets. The project supplies the working
 * directory `gh` runs in, and every imported ticket links to it.
 */
export const TicketGitHubSourceRef = Schema.Struct({
  projectId: ProjectId,
  host: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
});
export type TicketGitHubSourceRef = typeof TicketGitHubSourceRef.Type;

export const TICKET_GITHUB_SOURCE_ISSUE_WARNING = 1_000;

export const TicketGitHubSource = Schema.Struct({
  ...TicketGitHubSourceRef.fields,
  enabled: Schema.Boolean,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  /** Why the last sync failed, such as `gh` missing or signed out; cleared by the next success. */
  lastError: Schema.NullOr(Schema.String),
  /** Open issues the last successful sync saw. */
  issueCount: NonNegativeInt,
});
export type TicketGitHubSource = typeof TicketGitHubSource.Type;

export const TicketGitHubSourceSet = Schema.Struct({ sources: Schema.Array(TicketGitHubSource) });
export type TicketGitHubSourceSet = typeof TicketGitHubSourceSet.Type;

export const TicketGitHubSourceUpsertInput = Schema.Struct({
  ...TicketGitHubSourceRef.fields,
  enabled: Schema.Boolean,
});
export type TicketGitHubSourceUpsertInput = typeof TicketGitHubSourceUpsertInput.Type;

export const TicketGitHubSourceRemoveInput = Schema.Struct({
  ...TicketGitHubSourceRef.fields,
  /** Delete the repository's tickets instead of hiding them. */
  deleteCache: Schema.Boolean,
});
export type TicketGitHubSourceRemoveInput = typeof TicketGitHubSourceRemoveInput.Type;

/**
 * How linked threads and pull requests move tickets forward. Targets are status ids; one that no
 * longer exists falls back to its event's category default (active, active, closed).
 */
export const TicketAutoAdvanceSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Where an open ticket goes when a message mentioning it is sent. */
  threadStartedStatusId: TicketStatusId.pipe(
    Schema.withDecodingDefault(Effect.succeed(TicketStatusId.make("in_progress"))),
  ),
  /** Where a ticket goes when a linked thread links a pull request. */
  pullRequestLinkedStatusId: TicketStatusId.pipe(
    Schema.withDecodingDefault(Effect.succeed(TicketStatusId.make("in_review"))),
  ),
  /** Where a local ticket goes when that pull request merges. */
  pullRequestMergedStatusId: TicketStatusId.pipe(
    Schema.withDecodingDefault(Effect.succeed(TicketStatusId.make("done"))),
  ),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type TicketAutoAdvanceSettings = typeof TicketAutoAdvanceSettings.Type;

export const TicketAutoAdvanceSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  threadStartedStatusId: Schema.optionalKey(TicketStatusId),
  pullRequestLinkedStatusId: Schema.optionalKey(TicketStatusId),
  pullRequestMergedStatusId: Schema.optionalKey(TicketStatusId),
});

/**
 * What a user or agent typed to name a ticket: `T-42`, a ticket id, or a GitHub
 * issue as `owner/repo#123`. A ticket id is anything else that is not blank.
 */
export type TicketReference =
  | { readonly type: "number"; readonly number: number }
  | { readonly type: "issue"; readonly repository: string; readonly number: number }
  | { readonly type: "id"; readonly ticketId: TicketId };

export function parseTicketReference(input: string): TicketReference | null {
  const text = input.trim();
  const numbered = /^T-(\d+)$/i.exec(text);
  if (numbered) {
    const number = Number(numbered[1]);
    return number >= 1 && Number.isSafeInteger(number) ? { type: "number", number } : null;
  }
  const issue = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text);
  if (issue) {
    const number = Number(issue[2]);
    return number >= 1 && Number.isSafeInteger(number)
      ? { type: "issue", repository: issue[1]!, number }
      : null;
  }
  if (text.length === 0 || /[\s#/]/.test(text)) return null;
  return { type: "id", ticketId: TicketId.make(text) };
}

export class TicketNotFoundError extends Schema.TaggedError<TicketNotFoundError>()(
  "TicketNotFoundError",
  { ticketId: Schema.String },
) {
  override get message(): string {
    return `Ticket ${this.ticketId} was not found.`;
  }
}

export class TicketRevisionConflictError extends Schema.TaggedError<TicketRevisionConflictError>()(
  "TicketRevisionConflictError",
  {
    ticketId: TicketId,
    expectedRevision: PositiveInt,
    actualRevision: PositiveInt,
  },
) {
  override get message(): string {
    return "The ticket changed since it was loaded. Reload it and try again.";
  }
}

export class TicketError extends Schema.TaggedError<TicketError>()("TicketError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
