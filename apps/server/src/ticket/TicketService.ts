import * as NodeCrypto from "node:crypto";

import {
  type ChatAttachment,
  type TicketGitHubIssueRef,
  type TicketGitHubIssueDetail,
  type TicketGitHubIssueAssigneeChangeInput,
  type TicketLinkedIssueRef,
  type TicketIssueLinkCandidates,
  type TicketSubscribeDetailInput,
  type OrchestrationProjectShell,
  type IssueActivity,
  type IssueAssigneeCandidateList,
  ChatAttachmentId,
  formatTicketPlanRef,
  GitHubIssueSnapshot,
  parseTicketPlanReference,
  TICKET_DETAIL_ACTIVITY_LIMIT,
  TicketActivity,
  TicketActivityEntry,
  type TicketActor,
  type TicketAttachment,
  type TicketCommentInput,
  type TicketCreateInput,
  type TicketDeleteInput,
  type TicketDetail,
  TicketEditableField,
  TicketError,
  TicketId,
  TicketLink,
  type TicketLinkInput,
  type TicketLinkRef,
  type TicketLinkSource,
  TicketLinkTarget,
  type TicketListEvent,
  type TicketMoveInput,
  TicketNotFoundError,
  type TicketPlan,
  TicketPlanComment,
  TicketPlanCommentId,
  type TicketPlanCommentInput,
  type TicketPlanCommentRefInput,
  type TicketPlanContentCommit,
  type TicketPlanCreateInput,
  type TicketPlanDeleteInput,
  TicketPlanId,
  TicketPlanNotFoundError,
  TicketPlanRevisionConflictError,
  type TicketPlanReviewStatus,
  type TicketPlanStatus,
  TicketPlanSummary,
  type TicketPlanUpdateInput,
  type TicketPlanWriteResult,
  TicketRevisionConflictError,
  type TicketSearchInput,
  type TicketSearchResult,
  type TicketSetHiddenInput,
  type TicketStatusCategory,
  TicketStatusDefinition,
  type TicketStatusDeleteInput,
  TicketStatusId,
  type TicketStatusReorderInput,
  type TicketStatusSet,
  type TicketStatusUpsertInput,
  TicketSummary,
  type TicketUnlinkInput,
  type TicketUpdateInput,
  type TicketWriteResult,
  parseTicketReference,
  ProjectId,
  ThreadId,
  ticketLinkTargetKey,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { isFractionalIndexKey, keyBetween } from "@t3tools/shared/fractionalIndex";
import {
  normalizeThreadPullRequestKey,
  threadPullRequestKeysEqual,
} from "@t3tools/shared/threadPullRequests";
import { anchorFromSourceQuote } from "@t3tools/shared/ticketPlanAnchors";
import * as Arr from "effect/Array";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type * as Statement from "effect/unstable/sql/Statement";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import {
  type IssueStateChange,
  type ProviderIssue,
  type IssueProviderApi,
  IssueProviderError,
} from "../issue/IssueProvider.ts";
import {
  attachmentBody,
  attachmentReferenceIds,
  claimTicketAttachments,
  type WithAttachmentSources,
} from "./TicketAttachments.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import { applyPlanEdits } from "./ticketPlanEdits.ts";

type TicketWriteError = TicketNotFoundError | TicketRevisionConflictError | TicketError;
type TicketPlanWriteError = TicketPlanNotFoundError | TicketPlanRevisionConflictError | TicketError;
type GitHubIssueTarget = Parameters<TicketGitHub.TicketGitHub["Service"]["run"]>[0] &
  NonNullable<TicketGitHubIssueRef["linkedIssue"]>;
type ResolvedGitHubIssueTarget = GitHubIssueTarget & { readonly projectId: ProjectId };

/** What `list` narrows by; every field given must match. Hidden GitHub tickets never list. */
interface TicketListFilter {
  readonly status?: TicketStatusId | TicketStatusCategory | undefined;
  readonly kind?: TicketSummary["kind"] | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly threadId?: ThreadId | undefined;
  readonly label?: string | undefined;
  /** Full-text match over title, body and labels. */
  readonly query?: string | undefined;
  readonly limit: number;
}

interface TicketListResult {
  /** Most recently updated first. */
  readonly tickets: ReadonlyArray<TicketSummary>;
  readonly truncated: boolean;
  readonly statuses: TicketStatusSet["statuses"];
}

interface GitHubIssueImport {
  readonly existingTicketId?: TicketId;
  readonly readKind?: "direct";
  readonly projectId: ProjectId;
  readonly host: string;
  readonly repository: string;
  readonly issue: ProviderIssue;
}

interface GitHubRepository {
  readonly host: string;
  readonly repository: string;
}

/** `update` can also move the ticket to the end of another status column. */
type TicketEditInput = WithAttachmentSources<TicketUpdateInput> & {
  readonly statusId?: TicketStatusId | undefined;
};

export class TicketService extends Context.Service<
  TicketService,
  {
    /**
     * Every summary once, then deltas. Each subscriber keeps only the set of changed ticket ids,
     * so a slow one gets a bigger next delta instead of a growing backlog.
     */
    readonly subscribeList: () => Stream.Stream<TicketListEvent, TicketError>;
    /** The ticket's detail, then again after each change; fails once it is deleted. */
    readonly subscribeDetail: (
      ticketId: TicketId,
    ) => Stream.Stream<TicketDetail, TicketNotFoundError | TicketError>;
    /**
     * Subscribes at once, then streams the threads each later write links. Earlier links never
     * replay, so a link the user removed is not added back. Coalesces slow readers.
     */
    readonly subscribeThreadLinks: Effect.Effect<
      Stream.Stream<ReadonlyArray<ThreadId>>,
      never,
      Scope.Scope
    >;
    readonly get: (
      ticketId: TicketId,
    ) => Effect.Effect<TicketDetail, TicketNotFoundError | TicketError>;
    /** Resolves `T-42`, a ticket id, or `owner/repo#123` for a GitHub ticket. */
    readonly resolveRef: (
      reference: string,
    ) => Effect.Effect<TicketSummary, TicketNotFoundError | TicketError>;
    readonly githubIssueDetail: (
      input: TicketGitHubIssueRef,
    ) => Effect.Effect<TicketGitHubIssueDetail, TicketWriteError>;
    readonly githubIssueActivity: (
      input: TicketGitHubIssueRef,
    ) => Effect.Effect<IssueActivity, TicketWriteError>;
    readonly githubIssueAssigneeCandidates: (
      input: TicketGitHubIssueRef,
    ) => Effect.Effect<IssueAssigneeCandidateList, TicketWriteError>;
    readonly githubIssueSetAssignees: (
      input: TicketGitHubIssueAssigneeChangeInput,
    ) => Effect.Effect<void, TicketWriteError>;
    readonly refreshGitHubIssue: (
      input: TicketSubscribeDetailInput,
    ) => Effect.Effect<TicketSummary, TicketWriteError>;
    readonly invalidateGitHubIssue: (
      input: TicketLinkedIssueRef,
    ) => Effect.Effect<void, TicketWriteError>;
    readonly issueLinkCandidates: (
      input: TicketSubscribeDetailInput,
    ) => Effect.Effect<TicketIssueLinkCandidates, TicketWriteError>;
    readonly search: (input: TicketSearchInput) => Effect.Effect<TicketSearchResult, TicketError>;
    readonly list: (filter: TicketListFilter) => Effect.Effect<TicketListResult, TicketError>;
    readonly listForTarget: (
      ref: TicketLinkRef,
    ) => Effect.Effect<ReadonlyArray<TicketSummary>, TicketError>;
    readonly create: (
      input: WithAttachmentSources<TicketCreateInput>,
      actor: TicketActor,
    ) => Effect.Effect<
      TicketWriteResult & { readonly storedAttachments: ReadonlyArray<TicketAttachment> },
      TicketError
    >;
    /**
     * Never reaches GitHub: a `statusId` that would move a GitHub ticket into or out of a closed
     * status is refused, since only the user's `move` closes or reopens the issue.
     */
    readonly update: (
      input: TicketEditInput,
      actor: TicketActor,
    ) => Effect.Effect<
      TicketWriteResult & { readonly storedAttachments: ReadonlyArray<TicketAttachment> },
      TicketWriteError
    >;
    /**
     * A user moving a tracked GitHub ticket into or out of a closed status closes or reopens its
     * issue before anything is written, so a failed `gh` call leaves the ticket where it was. If
     * the ticket then changed under the move, the issue stays changed and the activity says so;
     * the next sync moves the ticket to match.
     */
    readonly move: (
      input: TicketMoveInput,
      actor: TicketActor,
    ) => Effect.Effect<TicketSummary, TicketWriteError>;
    readonly delete: (input: TicketDeleteInput) => Effect.Effect<void, TicketWriteError>;
    /**
     * Adds a link, or refreshes a pull request's or issue's snapshot. Their refs are normalized
     * and their URLs derived from the ref. An agent can add a link but never rewrite one.
     */
    readonly link: (
      input: TicketLinkInput,
      actor: TicketActor,
    ) => Effect.Effect<TicketLinkResult, TicketWriteError>;
    readonly unlink: (
      input: TicketUnlinkInput,
      actor: TicketActor,
    ) => Effect.Effect<TicketSummary, TicketWriteError>;
    /** Appends a local note to either kind. Never reaches GitHub, so agents may call it. */
    readonly addComment: (
      input: TicketCommentInput,
      actor: TicketActor,
    ) => Effect.Effect<TicketSummary, TicketWriteError>;
    /**
     * The user's comment box: a local ticket keeps the comment as a note, a GitHub ticket posts
     * it to the issue and keeps nothing (the issue's activity shows it).
     */
    readonly postUserComment: (
      input: TicketCommentInput,
    ) => Effect.Effect<TicketSummary, TicketWriteError>;
    /** The user stops tracking a GitHub ticket, or tracks it again. Sync skips hidden tickets. */
    readonly setHidden: (
      input: TicketSetHiddenInput,
    ) => Effect.Effect<TicketSummary, TicketWriteError>;
    /**
     * Sync's write: imports an open issue as a ticket linked to the project, or refreshes a
     * tracked one and moves it across the closed line to match GitHub. Hidden tickets and
     * reads older than the stored snapshot are skipped.
     */
    readonly upsertGitHubIssue: (input: GitHubIssueImport) => Effect.Effect<void, TicketError>;
    readonly openGitHubIssueNumbers: (
      repository: GitHubRepository,
    ) => Effect.Effect<ReadonlyArray<number>, TicketError>;
    readonly releaseGitHubRepository: (
      repository: GitHubRepository & { readonly deleteCache: boolean },
    ) => Effect.Effect<void, TicketError>;
    /** Shows the tickets `releaseGitHubRepository` hid, leaving ones the user hid alone. */
    readonly restoreGitHubRepository: (
      repository: GitHubRepository,
    ) => Effect.Effect<void, TicketError>;
    readonly readStatuses: Effect.Effect<TicketStatusSet, TicketError>;
    readonly subscribeStatuses: () => Stream.Stream<TicketStatusSet, TicketError>;
    readonly upsertStatus: (
      input: TicketStatusUpsertInput,
    ) => Effect.Effect<TicketStatusSet, TicketError>;
    readonly reorderStatuses: (
      input: TicketStatusReorderInput,
    ) => Effect.Effect<TicketStatusSet, TicketError>;
    /**
     * Moves the status's tickets to `reassignTo`, a status in the same category, then deletes it.
     * Never reaches GitHub.
     */
    readonly deleteStatus: (
      input: TicketStatusDeleteInput,
      actor: TicketActor,
    ) => Effect.Effect<TicketStatusSet, TicketError>;
    /** Resolves `T-42/P1`, `owner/repo#123/P1`, or a plan id. */
    readonly resolvePlanRef: (
      reference: string,
    ) => Effect.Effect<
      TicketPlanSummary,
      TicketPlanNotFoundError | TicketNotFoundError | TicketError
    >;
    readonly listPlans: (
      ticketId: TicketId,
    ) => Effect.Effect<ReadonlyArray<TicketPlanSummary>, TicketNotFoundError | TicketError>;
    readonly getPlan: (
      planId: TicketPlanId,
    ) => Effect.Effect<TicketPlan, TicketPlanNotFoundError | TicketError>;
    /** The plan, then again after each change to it; fails once it is deleted. */
    readonly subscribePlan: (
      planId: TicketPlanId,
    ) => Stream.Stream<TicketPlan, TicketPlanNotFoundError | TicketError>;
    readonly createPlan: (
      input: WithAttachmentSources<TicketPlanCreateInput>,
      actor: TicketActor,
    ) => Effect.Effect<
      TicketPlanWriteResult & { readonly storedAttachments: ReadonlyArray<TicketAttachment> },
      TicketNotFoundError | TicketError
    >;
    /**
     * Conflicts on a stale `expectedRevision` when content changes or Draft becomes Ready.
     * Edits apply to the stored body after that check.
     */
    readonly updatePlan: (
      input: WithAttachmentSources<TicketPlanUpdateInput>,
      actor: TicketActor,
    ) => Effect.Effect<
      TicketPlanWriteResult & {
        readonly contentCommit: TicketPlanContentCommit;
        readonly storedAttachments: ReadonlyArray<TicketAttachment>;
      },
      TicketPlanWriteError
    >;
    /** Deletes the plan and its comments; the ticket keeps the attachments it referenced. */
    readonly deletePlan: (
      input: TicketPlanDeleteInput,
      actor: TicketActor,
    ) => Effect.Effect<void, TicketPlanNotFoundError | TicketError>;
    /**
     * `sourceQuote` stands in for `anchor`: text copied from the plan's Markdown source, anchored
     * against the body this write sees. Fails when it is not in the body exactly once.
     */
    readonly addPlanComment: (
      input: TicketPlanCommentInput & { readonly sourceQuote?: string | undefined },
      actor: TicketActor,
    ) => Effect.Effect<TicketPlanComment, TicketPlanNotFoundError | TicketError>;
    readonly reopenPlanComment: (
      input: TicketPlanCommentRefInput,
    ) => Effect.Effect<TicketPlanSummary, TicketPlanNotFoundError | TicketError>;
    /** Deletes the comment with its replies. */
    readonly deletePlanComment: (
      input: TicketPlanCommentRefInput,
    ) => Effect.Effect<TicketPlanSummary, TicketPlanNotFoundError | TicketError>;
  }
>()("t3/ticket/TicketService") {}

interface TicketWrite {
  readonly entries: ReadonlyArray<TicketActivityEntry>;
  readonly revises: boolean;
  /** Changed something the summary does not carry, such as a link snapshot. */
  readonly touches?: boolean;
}

const UNCHANGED: TicketWrite = { entries: [], revises: false };

interface TicketLinkResult {
  readonly ticket: TicketSummary;
  /** The link as stored before this call; null when the call added it. */
  readonly previous: TicketLinkTarget | null;
}

interface ChangeSubscriber<Id> {
  readonly wants: (id: Id) => boolean;
  readonly dirty: Set<Id>;
  readonly wake: Queue.Queue<void>;
}

const DELTA_WINDOW = Duration.millis(50);
const ID_CHUNK = 500;
const EDIT_COALESCE_MS = 5 * 60 * 1000;

interface TicketRow {
  readonly ticket_id: string;
  readonly number: number;
  readonly kind: string;
  readonly title: string;
  readonly labels_json: string;
  readonly status_id: string;
  readonly sort_key: string;
  readonly revision: number;
  readonly created_by_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly github_snapshot_json: string | null;
  readonly hidden_at: string | null;
  readonly attachment_count: number;
}

interface StatusRow {
  readonly status_id: string;
  readonly name: string;
  readonly color: string;
  readonly category: string;
  readonly close_reason: string | null;
  readonly position: number;
  readonly collapsed_by_default: number;
  readonly is_default: number;
}

interface AttachmentRow {
  readonly attachment_id: string;
  readonly type: "image" | "file";
  readonly name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly created_at: string;
}

interface PlanRow {
  readonly plan_id: string;
  readonly ticket_id: string;
  readonly ticket_number: number;
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly review_status: TicketPlanReviewStatus;
  readonly revision: number;
  readonly created_by_json: string;
  readonly updated_by_json: string;
  readonly updated_at: string;
  readonly open_comment_count: number;
}

interface PlanCommentRow {
  readonly comment_id: string;
  readonly parent_comment_id: string | null;
  readonly anchor_json: string | null;
  readonly body: string;
  readonly actor_json: string;
  readonly resolved_at: string | null;
  readonly resolved_by_json: string | null;
  readonly created_at: string;
}

const decodeSummary = Schema.decodeUnknownEffect(TicketSummary);
const decodePlanSummary = Schema.decodeUnknownEffect(TicketPlanSummary);
const decodePlanComment = Schema.decodeUnknownEffect(TicketPlanComment);
const decodeStatus = Schema.decodeUnknownEffect(TicketStatusDefinition);
const decodeLink = Schema.decodeUnknownEffect(TicketLink);
const decodeLinkTarget = Schema.decodeUnknownEffect(Schema.fromJsonString(TicketLinkTarget));
const decodeActivity = Schema.decodeUnknownOption(TicketActivity);
const decodeEntryJson = Schema.decodeUnknownOption(Schema.fromJsonString(TicketActivityEntry));
const decodeSnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(GitHubIssueSnapshot));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeLabels = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeJsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const ticketError = (message: string) => (cause: unknown) => new TicketError({ message, cause });

const toAttachment = (row: AttachmentRow): TicketAttachment => ({
  id: row.attachment_id,
  type: row.type,
  name: row.name,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  createdAt: row.created_at,
});

/** The encoded summary; a ticket summary decodes its plans along with it. */
const planFields = (row: PlanRow) =>
  Effect.gen(function* () {
    return {
      planId: row.plan_id,
      ticketId: row.ticket_id,
      ref: formatTicketPlanRef(row.ticket_number, row.number),
      number: row.number,
      title: row.title,
      status: row.status,
      reviewStatus: row.review_status,
      revision: row.revision,
      openCommentCount: row.open_comment_count,
      createdBy: yield* decodeJson(row.created_by_json),
      updatedBy: yield* decodeJson(row.updated_by_json),
      updatedAt: row.updated_at,
    };
  });

const toPlanComment = (row: PlanCommentRow) =>
  Effect.gen(function* () {
    return yield* decodePlanComment({
      id: row.comment_id,
      parentId: row.parent_comment_id,
      anchor: row.anchor_json === null ? null : yield* decodeJson(row.anchor_json),
      body: row.body,
      author: yield* decodeJson(row.actor_json),
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by_json === null ? null : yield* decodeJson(row.resolved_by_json),
    });
  });

const linkSourceFor = (actor: TicketActor): TicketLinkSource => {
  switch (actor.type) {
    case "user":
      return "user";
    case "agent":
      return "agent";
    case "sync":
    case "automation":
      return "auto";
  }
};

const mayNotCrossClosedLine = (actor: TicketActor) =>
  actor.type === "agent" || actor.type === "automation";

const uniqueLabels = (labels: ReadonlyArray<string>) => [...new Set(labels)];

const agentCannotCross = (ticket: TicketSummary, to: TicketStatusDefinition) =>
  new TicketError({
    message: `Moving T-${ticket.number} ${to.category === "closed" ? "to a closed status would close" : "out of a closed status would reopen"} its GitHub issue. Agents cannot do that: ask the user to move it in Vetra Code.`,
  });

/** An FTS5 query matching every typed word as a prefix, with FTS syntax neutralized. */
const toFtsQuery = (text: string) =>
  text
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => `"${word.replaceAll('"', '""')}"*`)
    .join(" ");

/**
 * The one stored form of a link target. Pull request and issue refs are lowercased the way thread
 * pull request keys are, so the same target never links twice, and their URLs are derived from
 * the ref: a caller's pull request URL is kept only when it names that same pull request.
 */
const normalizeLinkTarget = (target: TicketLinkTarget): TicketLinkTarget => {
  switch (target.kind) {
    case "project":
    case "thread":
      return target;
    case "pull_request": {
      const ref = normalizeThreadPullRequestKey(target.ref);
      const claimed = parseChangeRequestUrl(target.snapshot.url);
      const url =
        claimed !== null &&
        claimed.host === ref.host &&
        claimed.repository === ref.repository &&
        claimed.number === ref.number
          ? target.snapshot.url
          : `https://${ref.host}/${ref.repository}/pull/${ref.number}`;
      return {
        kind: "pull_request",
        ref,
        snapshot: { title: target.snapshot.title, state: target.snapshot.state, url },
      };
    }
    case "issue": {
      const ref = normalizeThreadPullRequestKey(target.ref);
      return {
        kind: "issue",
        ref,
        snapshot: {
          title: target.snapshot.title,
          state: target.snapshot.state,
          url: `https://${ref.host}/${ref.repository}/issues/${ref.number}`,
        },
      };
    }
  }
};

const isOwnIssue = (ticket: TicketSummary, target: TicketLinkTarget) =>
  ticket.kind === "github" &&
  target.kind === "issue" &&
  target.ref.host === ticket.github.host.toLowerCase() &&
  target.ref.repository === ticket.github.repository.toLowerCase() &&
  target.ref.number === ticket.github.number;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const github = yield* TicketGitHub.TicketGitHub;

  const ticketSubscribers = new Set<ChangeSubscriber<TicketId>>();
  const planSubscribers = new Set<ChangeSubscriber<TicketPlanId>>();
  const threadLinkSubscribers = new Set<ChangeSubscriber<ThreadId>>();
  const statusChanges = yield* PubSub.sliding<void>(1);

  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const selectPlanRows = (where: Statement.Fragment) => sql<PlanRow>`
    SELECT
      p.plan_id, p.ticket_id, t.number AS ticket_number, p.number, p.title, p.status,
      p.review_status, p.revision,
      p.created_by_json, p.updated_by_json, p.updated_at,
      (
        SELECT COUNT(*) FROM ticket_plan_comments c
        WHERE c.plan_id = p.plan_id AND c.parent_comment_id IS NULL AND c.resolved_at IS NULL
      ) AS open_comment_count
    FROM ticket_plans p JOIN tickets t ON t.ticket_id = p.ticket_id
    WHERE ${where}
    ORDER BY p.number
  `;

  const toSummaries = (rows: ReadonlyArray<TicketRow>) =>
    Effect.gen(function* () {
      if (rows.length === 0) return [];
      // Chunked: the full-list snapshot would otherwise pass every ticket id as one bound
      // variable each and fail past SQLite's variable limit.
      const idChunks = Arr.chunksOf(
        rows.map((row) => row.ticket_id),
        ID_CHUNK,
      );
      const plans = yield* Effect.forEach(idChunks, (ids) =>
        selectPlanRows(sql`p.ticket_id IN ${sql.in(ids)}`),
      );
      const plansByTicket = new Map<string, Array<PlanRow>>();
      for (const plan of plans.flat()) {
        const ticketPlans = plansByTicket.get(plan.ticket_id) ?? [];
        ticketPlans.push(plan);
        plansByTicket.set(plan.ticket_id, ticketPlans);
      }
      const links = yield* Effect.forEach(
        idChunks,
        (ids) => sql<{
          readonly ticket_id: string;
          readonly kind: string;
          readonly target_key: string;
        }>`
          SELECT ticket_id, kind, target_key FROM ticket_links
          WHERE ticket_id IN ${sql.in(ids)}
          ORDER BY created_at, kind, target_key
        `,
      );
      const linkRefsByTicket = new Map<string, Array<{ kind: string; targetKey: string }>>();
      for (const link of links.flat()) {
        const refs = linkRefsByTicket.get(link.ticket_id) ?? [];
        refs.push({ kind: link.kind, targetKey: link.target_key });
        linkRefsByTicket.set(link.ticket_id, refs);
      }
      return yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const base = {
            id: row.ticket_id,
            number: row.number,
            title: row.title,
            labels: yield* decodeJson(row.labels_json),
            statusId: row.status_id,
            sortKey: row.sort_key,
            revision: row.revision,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            createdBy: yield* decodeJson(row.created_by_json),
            linkRefs: linkRefsByTicket.get(row.ticket_id) ?? [],
            attachmentCount: row.attachment_count,
            plans: yield* Effect.forEach(plansByTicket.get(row.ticket_id) ?? [], planFields),
          };
          return yield* decodeSummary(
            row.kind === "github" && row.github_snapshot_json !== null
              ? {
                  ...base,
                  kind: "github",
                  github: yield* decodeJson(row.github_snapshot_json),
                  hiddenAt: row.hidden_at,
                }
              : { ...base, kind: "local" },
          );
        }),
      );
    }).pipe(Effect.mapError(ticketError("Could not read tickets.")));

  const selectSummaries = (
    where: Statement.Fragment,
    orderAndLimit: Statement.Fragment = sql`ORDER BY t.number`,
  ) =>
    sql<TicketRow>`
      SELECT
        t.ticket_id, t.number, t.kind, t.title, t.labels_json, t.status_id, t.sort_key,
        t.revision, t.created_by_json, t.created_at, t.updated_at, t.github_snapshot_json,
        t.hidden_at,
        (SELECT COUNT(*) FROM ticket_attachments a WHERE a.ticket_id = t.ticket_id)
          AS attachment_count
      FROM tickets t
      WHERE ${where}
      ${orderAndLimit}
    `.pipe(Effect.mapError(ticketError("Could not read tickets.")), Effect.flatMap(toSummaries));

  const readSummary = (ticketId: TicketId) =>
    selectSummaries(sql`t.ticket_id = ${ticketId}`).pipe(
      Effect.map((summaries) => Option.fromNullishOr(summaries[0])),
    );

  const requireSummary = (ticketId: TicketId) =>
    readSummary(ticketId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new TicketNotFoundError({ ticketId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const get: TicketService["Service"]["get"] = (ticketId) =>
    Effect.gen(function* () {
      const summary = yield* requireSummary(ticketId);
      const [bodyRow] = yield* sql<{ readonly body: string }>`
        SELECT body FROM tickets WHERE ticket_id = ${ticketId}
      `;
      const linkRows = yield* sql<{
        readonly target_json: string;
        readonly source: string;
        readonly created_at: string;
      }>`
        SELECT target_json, source, created_at FROM ticket_links
        WHERE ticket_id = ${ticketId}
        ORDER BY created_at, kind, target_key
      `;
      const links = yield* Effect.forEach(linkRows, (row) =>
        decodeJson(row.target_json).pipe(
          Effect.flatMap((target) =>
            decodeLink({ target, source: row.source, createdAt: row.created_at }),
          ),
        ),
      );
      const attachments = yield* sql<AttachmentRow>`
        SELECT attachment_id, type, name, mime_type, size_bytes, created_at
        FROM ticket_attachments WHERE ticket_id = ${ticketId}
        ORDER BY created_at, attachment_id
      `;
      const activityRows = yield* sql<{
        readonly activity_id: number;
        readonly actor_json: string;
        readonly entry_json: string;
        readonly created_at: string;
      }>`
        SELECT activity_id, actor_json, entry_json, created_at FROM ticket_activity
        WHERE ticket_id = ${ticketId}
        ORDER BY activity_id DESC
        LIMIT ${TICKET_DETAIL_ACTIVITY_LIMIT}
      `;
      const activity = activityRows.toReversed().flatMap((row) =>
        Option.toArray(
          decodeActivity({
            id: row.activity_id,
            ticketId,
            actor: Option.getOrNull(decodeJsonOption(row.actor_json)),
            createdAt: row.created_at,
            entry: Option.getOrNull(decodeJsonOption(row.entry_json)),
          }),
        ),
      );
      return {
        summary,
        body: bodyRow?.body ?? "",
        links,
        attachments: attachments.map(toAttachment),
        activity,
      } satisfies TicketDetail;
    }).pipe(
      Effect.catchTags({
        SqlError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read the ticket.", cause })),
        SchemaError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read the ticket.", cause })),
      }),
    );

  const resolveRef: TicketService["Service"]["resolveRef"] = (reference) =>
    Effect.gen(function* () {
      const parsed = parseTicketReference(reference);
      if (parsed === null) {
        return yield* new TicketError({ message: `"${reference}" is not a ticket reference.` });
      }
      const [summary] = yield* selectSummaries(
        parsed.type === "number"
          ? sql`t.number = ${parsed.number}`
          : parsed.type === "id"
            ? sql`t.ticket_id = ${parsed.ticketId}`
            : sql`t.kind = 'github'
                AND t.github_repository = ${parsed.repository}
                AND t.github_number = ${parsed.number}`,
      );
      if (summary === undefined) {
        return yield* new TicketNotFoundError({ ticketId: reference });
      }
      return summary;
    });

  const search: TicketService["Service"]["search"] = (input) =>
    Effect.gen(function* () {
      const query = toFtsQuery(input.query);
      if (query.length === 0) return { hits: [], truncated: false };
      const rows = yield* sql<{
        readonly ticket_id: string;
        readonly number: number;
        readonly title: string;
        readonly snippet: string;
      }>`
        SELECT t.ticket_id, t.number, t.title,
          snippet(tickets_fts, -1, '[', ']', '…', 12) AS snippet
        FROM tickets_fts JOIN tickets t ON t.number = tickets_fts.rowid
        WHERE tickets_fts MATCH ${query}
        ORDER BY rank
        LIMIT ${(input.limit ?? 20) + 1}
      `;
      return {
        truncated: rows.length > (input.limit ?? 20),
        hits: rows.slice(0, input.limit ?? 20).map((row) => ({
          ticketId: TicketId.make(row.ticket_id),
          number: row.number,
          title: row.title,
          snippet: row.snippet,
        })),
      };
    }).pipe(Effect.mapError(ticketError("Could not search tickets.")));

  const linkedTo = (ref: TicketLinkRef) =>
    sql`t.ticket_id IN (
      SELECT ticket_id FROM ticket_links WHERE kind = ${ref.kind} AND target_key = ${ref.targetKey}
    )`;

  const listForTarget: TicketService["Service"]["listForTarget"] = (ref) =>
    selectSummaries(linkedTo(ref));

  const readStatuses = sql<StatusRow>`
    SELECT status_id, name, color, category, close_reason, position, collapsed_by_default, is_default
    FROM ticket_statuses ORDER BY position, status_id
  `.pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(rows, (row) =>
        decodeStatus({
          id: row.status_id,
          name: row.name,
          color: row.color,
          category: row.category,
          ...(row.close_reason === null ? {} : { closeReason: row.close_reason }),
          position: row.position,
          collapsedByDefault: row.collapsed_by_default === 1,
          isDefault: row.is_default === 1,
        }),
      ),
    ),
    Effect.map((statuses): TicketStatusSet => ({ statuses })),
    Effect.mapError(ticketError("Could not read ticket statuses.")),
  );

  const list: TicketService["Service"]["list"] = (filter) =>
    Effect.gen(function* () {
      const query = filter.query === undefined ? "" : toFtsQuery(filter.query);
      const conditions = [
        sql`t.hidden_at IS NULL`,
        ...(filter.status === undefined
          ? []
          : [
              sql`t.status_id IN (
                SELECT status_id FROM ticket_statuses
                WHERE status_id = ${filter.status} OR category = ${filter.status}
              )`,
            ]),
        ...(filter.kind === undefined ? [] : [sql`t.kind = ${filter.kind}`]),
        ...(filter.label === undefined
          ? []
          : [sql`EXISTS (SELECT 1 FROM json_each(t.labels_json) WHERE value = ${filter.label})`]),
        ...(filter.projectId === undefined
          ? []
          : [linkedTo({ kind: "project", targetKey: filter.projectId })]),
        ...(filter.threadId === undefined
          ? []
          : [linkedTo({ kind: "thread", targetKey: filter.threadId })]),
        ...(query === ""
          ? []
          : [sql`t.number IN (SELECT rowid FROM tickets_fts WHERE tickets_fts MATCH ${query})`]),
      ];
      const tickets = yield* selectSummaries(
        sql.and(conditions),
        sql`ORDER BY t.updated_at DESC, t.number DESC LIMIT ${filter.limit + 1}`,
      );
      return {
        tickets: tickets.slice(0, filter.limit),
        truncated: tickets.length > filter.limit,
        statuses: (yield* readStatuses).statuses,
      };
    });

  const readValidStatuses = Effect.gen(function* () {
    const set = yield* readStatuses;
    for (const category of ["open", "active", "closed"] as const) {
      const inCategory = set.statuses.filter((status) => status.category === category);
      if (inCategory.length === 0) {
        return yield* new TicketError({
          message: `The ${category} category needs at least one status.`,
        });
      }
      if (inCategory.filter((status) => status.isDefault).length !== 1) {
        return yield* new TicketError({
          message: `The ${category} category needs exactly one default status.`,
        });
      }
    }
    return set;
  });

  const requireStatus = (statusId: TicketStatusId) =>
    readStatuses.pipe(
      Effect.flatMap((set) => {
        const status = set.statuses.find((candidate) => candidate.id === statusId);
        return status === undefined
          ? Effect.fail(new TicketError({ message: `Status ${statusId} does not exist.` }))
          : Effect.succeed(status);
      }),
    );

  const takeNumber = sql<{ readonly number: number }>`
    UPDATE ticket_counter SET next_number = next_number + 1 WHERE id = 1
    RETURNING next_number - 1 AS number
  `.pipe(Effect.map(([counter]) => counter!.number));

  const crossesClosedLine = (current: TicketSummary, toStatusId: TicketStatusId) =>
    Effect.gen(function* () {
      const from = yield* requireStatus(current.statusId);
      const to = yield* requireStatus(toStatusId);
      return (from.category === "closed") !== (to.category === "closed") ? to : null;
    });

  /**
   * Closes or reopens the issue when a user's move crosses the closed line, then re-reads it so
   * the stored snapshot carries GitHub's own `updatedAt` for the sync's staleness check.
   */
  const pushGitHubState = (
    current: TicketSummary,
    toStatusId: TicketStatusId,
    actor: TicketActor,
    expectedRevision: number,
  ) =>
    Effect.gen(function* () {
      if (current.kind !== "github") return null;
      const to = yield* crossesClosedLine(current, toStatusId);
      if (to === null) return null;
      if (mayNotCrossClosedLine(actor)) return yield* agentCannotCross(current, to);
      if (actor.type === "sync" || current.hiddenAt !== null) return null;
      if (current.revision !== expectedRevision) {
        return yield* new TicketRevisionConflictError({
          ticketId: current.id,
          expectedRevision,
          actualRevision: current.revision,
        });
      }
      const change: IssueStateChange =
        to.category === "closed" ? { state: "closed", reason: to.closeReason } : { state: "open" };
      const target = current.github;
      const ref = { host: target.host, repository: target.repository, number: target.number };
      yield* github
        .run({ ...target, ticketId: current.id }, (api, cwd) =>
          api.setState({ cwd, ...ref, change }),
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new TicketError({
                message: `Could not ${change.state === "closed" ? "close" : "reopen"} ${target.repository}#${target.number} on GitHub. ${TicketGitHub.describeGitHubFailure(error)}`,
                cause: error,
              }),
          ),
        );
      const issue = yield* github
        .run({ ...target, ticketId: current.id }, (api, cwd) => api.getIssue({ cwd, ...ref }))
        .pipe(Effect.orElseSucceed(() => null));
      return { change, issue };
    });

  type PushedGitHubState = NonNullable<Effect.Success<ReturnType<typeof pushGitHubState>>>;

  const recordGitHubState = (ticketId: TicketId, pushed: PushedGitHubState | null, at: string) =>
    Effect.gen(function* () {
      if (pushed === null) return;
      const current = Option.getOrUndefined(yield* readSummary(ticketId));
      if (current?.kind !== "github") return;
      const { change, issue } = pushed;
      const snapshot: GitHubIssueSnapshot = {
        ...current.github,
        state: change.state,
        stateReason: issue?.stateReason ?? (change.state === "closed" ? change.reason : "reopened"),
        updatedAt: issue?.updatedAt ?? current.github.updatedAt,
        syncedAt: at,
        stateNeedsConfirmation: issue === null,
      };
      yield* sql`
        UPDATE tickets SET github_snapshot_json = ${encodeJson(snapshot)}
        WHERE ticket_id = ${ticketId}
      `;
    });

  const publishStatuses = PubSub.publish(statusChanges, undefined);
  const publish = <Id>(set: Set<ChangeSubscriber<Id>>, ids: ReadonlyArray<Id>) =>
    Effect.forEach(
      set,
      (subscriber) => {
        const wanted = ids.filter(subscriber.wants);
        if (wanted.length === 0) return Effect.void;
        for (const id of wanted) subscriber.dirty.add(id);
        return Queue.offer(subscriber.wake, undefined);
      },
      { discard: true },
    );
  const publishTickets = (ticketIds: ReadonlyArray<TicketId>) =>
    publish(ticketSubscribers, ticketIds);
  const publishPlans = (planIds: ReadonlyArray<TicketPlanId>) => publish(planSubscribers, planIds);
  const publishThreadLinks = (threadIds: ReadonlyArray<ThreadId>) =>
    publish(threadLinkSubscribers, threadIds);
  const publishPlan = (ticketId: TicketId, planId: TicketPlanId) =>
    Effect.andThen(publishTickets([ticketId]), publishPlans([planId]));

  const subscribeChanges = <Id>(set: Set<ChangeSubscriber<Id>>, wants: (id: Id) => boolean) =>
    Effect.acquireRelease(
      Queue.sliding<void>(1).pipe(
        Effect.map((wake): ChangeSubscriber<Id> => {
          const subscriber = { wants, dirty: new Set<Id>(), wake };
          set.add(subscriber);
          return subscriber;
        }),
      ),
      (subscriber) => Effect.sync(() => set.delete(subscriber)),
    );

  const drain = <Id>(subscriber: ChangeSubscriber<Id>) => {
    const ids = [...subscriber.dirty];
    subscriber.dirty.clear();
    return ids;
  };

  const appendActivity = (
    ticketId: TicketId,
    actor: TicketActor,
    entries: ReadonlyArray<TicketActivityEntry>,
    createdAt: string,
  ) =>
    Effect.forEach(
      entries,
      (entry) => sql`
        INSERT INTO ticket_activity (ticket_id, actor_json, entry_json, created_at)
        VALUES (${ticketId}, ${encodeJson(actor)}, ${encodeJson(entry)}, ${createdAt})
      `,
      { discard: true },
    );

  const refreshSearch = (ticketId: TicketId) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{
        readonly number: number;
        readonly title: string;
        readonly body: string;
        readonly labels_json: string;
      }>`SELECT number, title, body, labels_json FROM tickets WHERE ticket_id = ${ticketId}`;
      if (row === undefined) return;
      const labels = yield* decodeLabels(row.labels_json).pipe(
        Effect.mapError(ticketError("Could not read the ticket's labels.")),
      );
      yield* sql`DELETE FROM tickets_fts WHERE rowid = ${row.number}`;
      yield* sql`
        INSERT INTO tickets_fts (rowid, title, body, labels)
        VALUES (${row.number}, ${row.title}, ${row.body}, ${labels.join(" ")})
      `;
    });

  const appendKey = (statusId: TicketStatusId) =>
    sql<{ readonly sort_key: string }>`
      SELECT sort_key FROM tickets WHERE status_id = ${statusId} ORDER BY sort_key DESC LIMIT 1
    `.pipe(Effect.map(([last]) => keyBetween(last?.sort_key ?? null, null)));

  const ticketWrite = <E>(
    ticketId: TicketId,
    expectedRevision: number | undefined,
    actor: TicketActor,
    apply: (current: TicketSummary, at: string) => Effect.Effect<TicketWrite, E>,
  ) =>
    Effect.gen(function* () {
      const current = yield* requireSummary(ticketId);
      const at = yield* now;
      const write = yield* apply(current, at);
      if (write.entries.length === 0 && !write.revises) return write.touches === true;
      if (
        write.revises &&
        expectedRevision !== undefined &&
        current.revision !== expectedRevision
      ) {
        return yield* new TicketRevisionConflictError({
          ticketId,
          expectedRevision,
          actualRevision: current.revision,
        });
      }
      yield* appendActivity(ticketId, actor, write.entries, at);
      yield* sql`
          UPDATE tickets SET revision = revision + ${write.revises ? 1 : 0}, updated_at = ${at}
          WHERE ticket_id = ${ticketId}
        `;
      if (write.revises) yield* refreshSearch(ticketId);
      return true;
    });

  const writeTicket = <E>(
    ticketId: TicketId,
    expectedRevision: number | undefined,
    actor: TicketActor,
    apply: (current: TicketSummary, at: string) => Effect.Effect<TicketWrite, E>,
  ) =>
    Effect.gen(function* () {
      if (yield* sql.withTransaction(ticketWrite(ticketId, expectedRevision, actor, apply))) {
        yield* publishTickets([ticketId]);
      }
      return yield* requireSummary(ticketId);
    });

  const sqlFailure = (message: string) => (cause: SqlError) =>
    Effect.fail(new TicketError({ message, cause }));

  const claimAttachments = (
    ticketId: TicketId,
    sources: Parameters<typeof claimTicketAttachments>[1],
  ) =>
    claimTicketAttachments(ticketId, sources).pipe(
      Effect.provideService(ServerConfig.ServerConfig, config),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const commitAttachmentWrite = <A, E>({
    claim,
    body,
    complete,
  }: {
    readonly claim: Pick<Effect.Success<ReturnType<typeof claimAttachments>>, "markCommitted">;
    readonly body: Effect.Effect<A, E>;
    readonly complete: (result: A) => Effect.Effect<void>;
  }) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const result = yield* sql.withTransaction(restore(body));
        yield* claim.markCommitted;
        yield* complete(result);
        return result;
      }),
    );

  const removeAttachmentFiles = (rows: ReadonlyArray<AttachmentRow>) =>
    Effect.forEach(
      rows,
      (row) => {
        const path = resolveAttachmentPath({
          attachmentsDir: config.attachmentsDir,
          attachment: {
            type: row.type,
            id: ChatAttachmentId.make(row.attachment_id),
            name: row.name,
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes,
          },
        });
        return path === null ? Effect.void : fileSystem.remove(path).pipe(Effect.ignore);
      },
      { discard: true },
    );

  const insertAttachments = (
    ticketId: TicketId,
    attachments: ReadonlyArray<ChatAttachment>,
    at: string,
  ) =>
    Effect.forEach(attachments, (attachment) =>
      sql`
          INSERT INTO ticket_attachments (
            attachment_id, ticket_id, type, name, mime_type, size_bytes, created_at
          ) VALUES (
            ${attachment.id}, ${ticketId}, ${attachment.type}, ${attachment.name},
            ${attachment.mimeType}, ${attachment.sizeBytes}, ${at}
          )
        `.pipe(
        Effect.as<TicketActivityEntry>({
          type: "attachment_added",
          attachmentId: attachment.id,
          name: attachment.name,
        }),
      ),
    );

  const plansReferencingAttachments = (ticketId: TicketId, attachmentIds: ReadonlyArray<string>) =>
    attachmentIds.length === 0
      ? Effect.succeed<ReadonlyArray<TicketPlanId>>([])
      : sql<{ readonly plan_id: string }>`
          SELECT plan_id FROM ticket_plans WHERE ticket_id = ${ticketId}
            AND ${sql.or(attachmentIds.map((id) => sql`instr(body, ${`vetra-attachment://${id}`}) > 0`))}
        `.pipe(Effect.map((rows) => rows.map((row) => TicketPlanId.make(row.plan_id))));

  const insertLink = (
    ticketId: TicketId,
    target: TicketLinkTarget,
    source: TicketLinkSource,
    at: string,
  ) => {
    const normalized = normalizeLinkTarget(target);
    return sql`
      INSERT INTO ticket_links (ticket_id, kind, target_key, target_json, source, created_at)
      VALUES (
        ${ticketId}, ${normalized.kind}, ${ticketLinkTargetKey(normalized)},
        ${encodeJson(normalized)}, ${source}, ${at}
      )
      ON CONFLICT (ticket_id, kind, target_key) DO NOTHING
    `;
  };

  const draftLinks = (actor: TicketActor) =>
    Effect.gen(function* () {
      if (actor.type !== "agent") return null;
      const [draft] = yield* sql<{
        readonly source_thread_id: string | null;
        readonly project_id: string;
      }>`
        SELECT source_thread_id, project_id FROM ticket_drafts WHERE thread_id = ${actor.threadId}
      `;
      if (draft === undefined) return null;
      const links: Array<TicketLinkTarget> = [
        { kind: "project", projectId: ProjectId.make(draft.project_id) },
      ];
      if (draft.source_thread_id !== null) {
        links.push({ kind: "thread", threadId: ThreadId.make(draft.source_thread_id) });
      }
      return links;
    });

  const create: TicketService["Service"]["create"] = (input, actor) =>
    Effect.gen(function* () {
      const ticketId = TicketId.make(NodeCrypto.randomUUID());
      const claim = yield* claimAttachments(ticketId, input.attachments ?? []);
      const body = yield* attachmentBody(input.body ?? "", claim, false);
      const storedAttachments: TicketAttachment[] = [];
      const linkedThreads: Array<ThreadId> = [];
      yield* commitAttachmentWrite({
        claim,
        body: Effect.gen(function* () {
          const statusId =
            input.statusId ??
            (yield* readStatuses).statuses.find(
              (status) => status.category === "open" && status.isDefault,
            )?.id;
          if (statusId === undefined) {
            return yield* new TicketError({ message: "No default open status exists." });
          }
          yield* requireStatus(statusId);
          const at = yield* now;
          const number = yield* takeNumber;
          yield* sql`
              INSERT INTO tickets (
                ticket_id, number, kind, title, body, labels_json, status_id, sort_key,
                revision, created_by_json, created_at, updated_at
              ) VALUES (
                ${ticketId}, ${number}, 'local', ${input.title}, ${body ?? ""},
                ${encodeJson(uniqueLabels(input.labels ?? []))}, ${statusId},
                ${yield* appendKey(statusId)}, 1, ${encodeJson(actor)}, ${at}, ${at}
              )
            `;
          const automaticLinks = yield* draftLinks(actor);
          for (const target of input.links ?? []) {
            if (
              automaticLinks !== null &&
              actor.type === "agent" &&
              target.kind === "thread" &&
              target.threadId === actor.threadId
            ) {
              continue;
            }
            yield* insertLink(ticketId, target, linkSourceFor(actor), at);
            if (target.kind === "thread") linkedThreads.push(target.threadId);
          }
          for (const target of automaticLinks ?? []) {
            yield* insertLink(ticketId, target, "auto", at);
            if (target.kind === "thread") linkedThreads.push(target.threadId);
          }
          storedAttachments.push(
            ...claim.attachments.map((attachment) => ({ ...attachment, createdAt: at })),
          );
          const attachmentEntries = yield* insertAttachments(ticketId, claim.attachments, at);
          yield* appendActivity(ticketId, actor, [{ type: "created" }, ...attachmentEntries], at);
          yield* refreshSearch(ticketId);
        }),
        complete: () =>
          Effect.gen(function* () {
            yield* publishTickets([ticketId]);
            yield* publishThreadLinks([...new Set(linkedThreads)]);
          }),
      });
      return {
        ticket: yield* requireSummary(ticketId),
        attachments: claim.mapping,
        storedAttachments,
      };
    }).pipe(
      Effect.scoped,
      Effect.catchTags({
        SqlError: sqlFailure("Could not create the ticket."),
        TicketNotFoundError: (cause) =>
          Effect.fail(
            new TicketError({ message: "The new ticket could not be read back.", cause }),
          ),
      }),
    );

  const removeAttachmentRows = (ticketId: TicketId, attachmentIds: ReadonlyArray<string>) =>
    attachmentIds.length === 0
      ? Effect.succeed<ReadonlyArray<AttachmentRow>>([])
      : sql<AttachmentRow>`
          DELETE FROM ticket_attachments
          WHERE ticket_id = ${ticketId} AND attachment_id IN ${sql.in(attachmentIds)}
          RETURNING attachment_id, type, name, mime_type, size_bytes, created_at
        `;

  const changeStatus = (current: TicketSummary, statusId: TicketStatusId | undefined) =>
    Effect.gen(function* () {
      if (statusId === undefined || statusId === current.statusId) return [];
      const from = yield* requireStatus(current.statusId);
      const to = yield* requireStatus(statusId);
      if (
        current.kind === "github" &&
        (from.category === "closed") !== (to.category === "closed")
      ) {
        return yield* agentCannotCross(current, to);
      }
      yield* sql`
        UPDATE tickets SET status_id = ${statusId}, sort_key = ${yield* appendKey(statusId)}
        WHERE ticket_id = ${current.id}
      `;
      return [{ type: "status_changed" as const, from: current.statusId, to: statusId }];
    });

  /**
   * Appends `entry`, or folds it into the ticket's latest entry when that is the same actor's from
   * the last few minutes and `merge` returns the folded entry, so autosaving leaves one entry per
   * sitting.
   */
  const recordEdit = (
    ticketId: TicketId,
    actor: TicketActor,
    entry: TicketActivityEntry,
    at: string,
    merge: (previous: TicketActivityEntry) => TicketActivityEntry | undefined,
  ) =>
    Effect.gen(function* () {
      const [latest] = yield* sql<{
        readonly activity_id: number;
        readonly actor_json: string;
        readonly entry_json: string;
        readonly created_at: string;
      }>`
        SELECT activity_id, actor_json, entry_json, created_at FROM ticket_activity
        WHERE ticket_id = ${ticketId} ORDER BY activity_id DESC LIMIT 1
      `;
      const previous =
        latest !== undefined &&
        latest.actor_json === encodeJson(actor) &&
        Date.parse(at) - Date.parse(latest.created_at) <= EDIT_COALESCE_MS
          ? Option.getOrUndefined(decodeEntryJson(latest.entry_json))
          : undefined;
      const merged = previous === undefined ? undefined : merge(previous);
      if (latest === undefined || merged === undefined) {
        yield* appendActivity(ticketId, actor, [entry], at);
        return;
      }
      yield* sql`
        UPDATE ticket_activity SET entry_json = ${encodeJson(merged)}, created_at = ${at}
        WHERE activity_id = ${latest.activity_id}
      `;
    });

  const update: TicketService["Service"]["update"] = (input, actor) =>
    Effect.gen(function* () {
      const claim = yield* claimAttachments(input.ticketId, input.attachments ?? []);
      const body =
        input.body === undefined ? undefined : yield* attachmentBody(input.body, claim, false);
      const storedAttachments: TicketAttachment[] = [];
      const removedFiles: Array<AttachmentRow> = [];
      const changedPlans: Array<TicketPlanId> = [];
      yield* commitAttachmentWrite({
        claim,
        body: ticketWrite(input.ticketId, input.expectedRevision, actor, (current, at) =>
          Effect.gen(function* () {
            const [row] = yield* sql<{ readonly body: string }>`
              SELECT body FROM tickets WHERE ticket_id = ${input.ticketId}
            `;
            const labels = input.labels === undefined ? undefined : uniqueLabels(input.labels);
            const fields = [
              ...(input.title !== undefined && input.title !== current.title
                ? (["title"] as const)
                : []),
              ...(body !== undefined && body !== row?.body ? (["body"] as const) : []),
              ...(labels !== undefined && labels.join("\n") !== current.labels.join("\n")
                ? (["labels"] as const)
                : []),
            ];
            if (fields.length > 0 && current.kind === "github") {
              return yield* new TicketError({
                message: "GitHub tickets are read only here: edit the issue on GitHub.",
              });
            }
            if (fields.length > 0) {
              yield* sql`
                UPDATE tickets SET
                  title = ${input.title ?? current.title},
                  body = ${body ?? row?.body ?? ""},
                  labels_json = ${encodeJson(labels ?? current.labels)}
                WHERE ticket_id = ${input.ticketId}
              `;
              yield* recordEdit(
                input.ticketId,
                actor,
                { type: "edited", fields },
                at,
                (previous) =>
                  previous.type === "edited"
                    ? {
                        type: "edited",
                        fields: TicketEditableField.literals.filter(
                          (field) => previous.fields.includes(field) || fields.includes(field),
                        ),
                      }
                    : undefined,
              );
            }
            const statusChanged = yield* changeStatus(current, input.statusId);
            storedAttachments.push(
              ...claim.attachments.map((attachment) => ({ ...attachment, createdAt: at })),
            );
            const added = yield* insertAttachments(input.ticketId, claim.attachments, at);
            const removed = yield* removeAttachmentRows(
              input.ticketId,
              input.removeAttachmentIds ?? [],
            );
            removedFiles.push(...removed);
            changedPlans.push(
              ...(yield* plansReferencingAttachments(
                input.ticketId,
                removed.map((attachment) => attachment.attachment_id),
              )),
            );
            return {
              entries: [
                ...statusChanged,
                ...added,
                ...removed.map((attachment) => ({
                  type: "attachment_removed" as const,
                  attachmentId: attachment.attachment_id,
                  name: attachment.name,
                })),
              ],
              revises: fields.length > 0 || statusChanged.length > 0,
            };
          }),
        ),
        complete: (changed) =>
          Effect.gen(function* () {
            if (changed) yield* publishTickets([input.ticketId]);
            yield* publishPlans(changedPlans);
            yield* removeAttachmentFiles(removedFiles);
          }),
      });
      return {
        ticket: yield* requireSummary(input.ticketId),
        attachments: claim.mapping,
        storedAttachments,
      };
    }).pipe(Effect.scoped, Effect.catchTag("SqlError", sqlFailure("Could not update the ticket.")));

  /** The issue was closed or reopened but the move was not saved; the next sync catches up. */
  const notePushedState = (ticketId: TicketId) =>
    Effect.gen(function* () {
      yield* appendActivity(
        ticketId,
        { type: "sync" },
        [{ type: "synced", changes: ["state"] }],
        yield* now,
      );
      yield* publishTickets([ticketId]);
    });

  const move: TicketService["Service"]["move"] = (input, actor) =>
    Effect.gen(function* () {
      if (!isFractionalIndexKey(input.sortKey)) {
        return yield* new TicketError({ message: `Invalid sort key "${input.sortKey}".` });
      }
      const pushed = yield* pushGitHubState(
        yield* requireSummary(input.ticketId),
        input.statusId,
        actor,
        input.expectedRevision,
      );
      return yield* writeTicket(input.ticketId, input.expectedRevision, actor, (current, at) =>
        Effect.gen(function* () {
          if (current.statusId === input.statusId && current.sortKey === input.sortKey) {
            return UNCHANGED;
          }
          yield* requireStatus(input.statusId);
          yield* sql`
            UPDATE tickets SET status_id = ${input.statusId}, sort_key = ${input.sortKey}
            WHERE ticket_id = ${input.ticketId}
          `;
          if (current.statusId !== input.statusId) {
            yield* recordGitHubState(input.ticketId, pushed, at);
          }
          return {
            entries:
              current.statusId === input.statusId
                ? []
                : [{ type: "status_changed" as const, from: current.statusId, to: input.statusId }],
            revises: true,
          };
        }),
      ).pipe(
        Effect.tapError(() =>
          pushed === null ? Effect.void : notePushedState(input.ticketId).pipe(Effect.ignore),
        ),
      );
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not move the ticket.")));

  const deleteTicket: TicketService["Service"]["delete"] = (input) =>
    Effect.gen(function* () {
      const { attachments, planIds } = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* requireSummary(input.ticketId);
          if (current.kind === "github") {
            return yield* new TicketError({
              message: "GitHub tickets cannot be deleted; stop tracking the issue instead.",
            });
          }
          const rows = yield* sql<AttachmentRow>`
            SELECT attachment_id, type, name, mime_type, size_bytes, created_at
            FROM ticket_attachments WHERE ticket_id = ${input.ticketId}
          `;
          const plans = yield* sql<{ readonly plan_id: string }>`
            SELECT plan_id FROM ticket_plans WHERE ticket_id = ${input.ticketId}
          `;
          yield* sql`DELETE FROM tickets_fts WHERE rowid = ${current.number}`;
          yield* sql`DELETE FROM tickets WHERE ticket_id = ${input.ticketId}`;
          return { attachments: rows, planIds: plans.map((row) => TicketPlanId.make(row.plan_id)) };
        }),
      );
      yield* publishTickets([input.ticketId]);
      yield* publishPlans(planIds);
      yield* removeAttachmentFiles(attachments);
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not delete the ticket.")));

  const link: TicketService["Service"]["link"] = (input, actor) =>
    Effect.gen(function* () {
      const target = normalizeLinkTarget(input.target);
      const targetKey = ticketLinkTargetKey(target);
      let previous: TicketLinkTarget | null = null;
      const ticket = yield* writeTicket(input.ticketId, undefined, actor, (current, at) =>
        Effect.gen(function* () {
          if (isOwnIssue(current, target)) {
            return yield* new TicketError({ message: "A GitHub ticket is already its own issue." });
          }
          const [stored] = yield* sql<{ readonly target_json: string }>`
            SELECT target_json FROM ticket_links
            WHERE ticket_id = ${input.ticketId} AND kind = ${target.kind}
              AND target_key = ${targetKey}
          `;
          if (stored === undefined) {
            yield* insertLink(input.ticketId, target, linkSourceFor(actor), at);
            return { entries: [{ type: "linked" as const, target }], revises: false };
          }
          previous = yield* decodeLinkTarget(stored.target_json);
          const json = encodeJson(target);
          if (
            actor.type === "agent" ||
            stored.target_json === json ||
            (actor.type === "automation" &&
              target.kind === "pull_request" &&
              previous.kind === "pull_request" &&
              previous.snapshot.state === "merged" &&
              target.snapshot.state !== "merged")
          )
            return UNCHANGED;
          yield* sql`
            UPDATE ticket_links SET target_json = ${json}
            WHERE ticket_id = ${input.ticketId} AND kind = ${target.kind}
              AND target_key = ${targetKey}
          `;
          return { ...UNCHANGED, touches: true };
        }),
      );
      if (previous === null && target.kind === "thread") {
        yield* publishThreadLinks([target.threadId]);
      }
      return { ticket, previous };
    }).pipe(
      Effect.catchTags({
        SqlError: sqlFailure("Could not link the ticket."),
        SchemaError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read the ticket's link.", cause })),
      }),
    );

  const unlink: TicketService["Service"]["unlink"] = (input, actor) =>
    writeTicket(input.ticketId, undefined, actor, (current) =>
      Effect.gen(function* () {
        if (
          input.kind === "project" &&
          current.kind === "github" &&
          current.linkRefs.some(
            (ref) => ref.kind === "project" && ref.targetKey === input.targetKey,
          ) &&
          (yield* github.projectFor(
            { ...current.github, ticketId: current.id },
            input.targetKey,
          )) === null
        ) {
          return yield* new TicketError({
            message:
              "Keep a project that can read this GitHub repository, or add an enabled GitHub source first.",
          });
        }
        const deleted = yield* sql<{ readonly kind: string }>`
          DELETE FROM ticket_links
          WHERE ticket_id = ${input.ticketId} AND kind = ${input.kind} AND target_key = ${input.targetKey}
          RETURNING kind
        `;
        return deleted.length === 0
          ? UNCHANGED
          : {
              entries: [
                { type: "unlinked" as const, kind: input.kind, targetKey: input.targetKey },
              ],
              revises: false,
            };
      }),
    ).pipe(Effect.catchTag("SqlError", sqlFailure("Could not unlink the ticket.")));

  const addComment: TicketService["Service"]["addComment"] = (input, actor) =>
    writeTicket(input.ticketId, undefined, actor, () =>
      Effect.succeed({ entries: [{ type: "comment" as const, body: input.body }], revises: false }),
    ).pipe(Effect.catchTag("SqlError", sqlFailure("Could not add the comment.")));

  const postUserComment: TicketService["Service"]["postUserComment"] = (input) =>
    Effect.gen(function* () {
      const current = yield* requireSummary(input.ticketId);
      if (current.kind === "local") return yield* addComment(input, { type: "user" });
      const issue = current.github;
      yield* github
        .run({ ...issue, ticketId: current.id }, (api, cwd) =>
          api.addComment({
            cwd,
            host: issue.host,
            repository: issue.repository,
            number: issue.number,
            body: input.body,
          }),
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new TicketError({
                message: `Could not comment on ${issue.repository}#${issue.number}. ${TicketGitHub.describeGitHubFailure(error)}`,
                cause: error,
              }),
          ),
        );
      return current;
    });

  const setHidden: TicketService["Service"]["setHidden"] = (input) =>
    Effect.gen(function* () {
      const current = yield* requireSummary(input.ticketId);
      if (current.kind !== "github") {
        return yield* new TicketError({ message: "Only GitHub tickets can stop being tracked." });
      }
      if ((current.hiddenAt !== null) === input.hidden) {
        if (input.hidden) {
          yield* sql`UPDATE tickets SET hidden_reason = 'user' WHERE ticket_id = ${input.ticketId}`;
        }
        return current;
      }
      const at = yield* now;
      yield* sql`
        UPDATE tickets SET
          hidden_at = ${input.hidden ? at : null},
          hidden_reason = ${input.hidden ? "user" : null},
          updated_at = ${at}
        WHERE ticket_id = ${input.ticketId}
      `;
      yield* publishTickets([input.ticketId]);
      return yield* requireSummary(input.ticketId);
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not update the ticket.")));

  const reconciledStatus = (
    statuses: TicketStatusSet["statuses"],
    statusId: TicketStatusId | null,
    issue: ProviderIssue,
  ) => {
    const current = statuses.find((status) => status.id === statusId);
    const isClosed = current?.category === "closed";
    if (issue.state === "open") {
      return isClosed || current === undefined
        ? statuses.find((status) => status.category === "open" && status.isDefault)
        : undefined;
    }
    if (isClosed) return undefined;
    const reason =
      issue.stateReason === "not_planned" || issue.stateReason === "duplicate"
        ? "not_planned"
        : "completed";
    const closed = statuses.filter((status) => status.category === "closed");
    return closed.find((status) => status.closeReason === reason) ?? closed[0];
  };

  const issueChanges = (
    stored: {
      readonly title: string;
      readonly body: string;
      readonly labels: ReadonlyArray<string>;
    },
    storedSnapshot: GitHubIssueSnapshot,
    next: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
    nextSnapshot: GitHubIssueSnapshot,
  ) => [
    ...(stored.title === next.title ? [] : ["title"]),
    ...(stored.body === next.body ? [] : ["body"]),
    ...(stored.labels.join("\n") === next.labels.join("\n") ? [] : ["labels"]),
    ...(storedSnapshot.state === nextSnapshot.state ? [] : ["state"]),
    ...(storedSnapshot.assignees.join("\n") === nextSnapshot.assignees.join("\n")
      ? []
      : ["assignees"]),
  ];

  const upsertGitHubIssue: TicketService["Service"]["upsertGitHubIssue"] = (input) =>
    Effect.gen(function* () {
      let issue = input.issue;
      let confirmedState: ProviderIssue["state"] | null =
        input.readKind === "direct" ? issue.state : null;
      const [needsConfirmation] =
        input.readKind === "direct"
          ? []
          : yield* sql<{ readonly found: number }>`
        SELECT 1 AS found FROM tickets
        WHERE kind = 'github' AND github_host = ${input.host}
          AND github_repository = ${input.repository} AND github_number = ${issue.number}
          AND hidden_at IS NULL
          AND json_extract(github_snapshot_json, '$.stateNeedsConfirmation') = 1
          AND json_extract(github_snapshot_json, '$.state') <> ${issue.state}
      `;
      if (needsConfirmation !== undefined) {
        issue = yield* github
          .run(input, (api, cwd) =>
            api.getIssue({
              cwd,
              host: input.host,
              repository: input.repository,
              number: issue.number,
            }),
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new TicketError({
                  message: TicketGitHub.describeGitHubFailure(error),
                  cause: error,
                }),
            ),
          );
        confirmedState = issue.state;
      }
      const at = yield* now;
      const actor: TicketActor = { type: "sync" };
      const snapshot: GitHubIssueSnapshot = {
        host: input.host,
        repository: input.repository,
        number: issue.number,
        state: issue.state,
        stateReason: issue.stateReason ?? null,
        author: issue.author?.login ?? null,
        assignees: issue.assignees.map((assignee) => assignee.login),
        updatedAt: issue.updatedAt,
        syncedAt: at,
        url: issue.url,
      };
      const labels = uniqueLabels(issue.labels.map((label) => label.name));
      const projectLink: TicketLinkTarget = { kind: "project", projectId: input.projectId };
      const written = yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<{
            readonly ticket_id: string;
            readonly title: string;
            readonly body: string;
            readonly labels_json: string;
            readonly status_id: string;
            readonly github_snapshot_json: string;
            readonly hidden_at: string | null;
          }>`
            SELECT ticket_id, title, body, labels_json, status_id, github_snapshot_json, hidden_at
            FROM tickets
            WHERE kind = 'github' AND github_host = ${input.host}
              AND github_repository = ${input.repository}
              AND github_number = ${issue.number}
          `;
          const statuses = (yield* readStatuses).statuses;
          if (input.existingTicketId !== undefined && row?.ticket_id !== input.existingTicketId)
            return null;
          if (row === undefined) {
            const statusId = reconciledStatus(statuses, null, issue)?.id;
            if (issue.state !== "open" || statusId === undefined) return null;
            const ticketId = TicketId.make(NodeCrypto.randomUUID());
            yield* sql`
              INSERT INTO tickets (
                ticket_id, number, kind, title, body, labels_json, status_id, sort_key,
                revision, created_by_json, created_at, updated_at,
                github_host, github_repository, github_number, github_snapshot_json
              ) VALUES (
                ${ticketId}, ${yield* takeNumber}, 'github', ${issue.title}, ${issue.body ?? ""},
                ${encodeJson(labels)}, ${statusId}, ${yield* appendKey(statusId)}, 1,
                ${encodeJson(actor)}, ${at}, ${at},
                ${input.host}, ${input.repository}, ${issue.number}, ${encodeJson(snapshot)}
              )
            `;
            yield* insertLink(ticketId, projectLink, linkSourceFor(actor), at);
            yield* appendActivity(ticketId, actor, [{ type: "created" }], at);
            yield* refreshSearch(ticketId);
            return ticketId;
          }
          if (row.hidden_at !== null) return null;
          const ticketId = TicketId.make(row.ticket_id);
          const storedSnapshot = yield* decodeSnapshot(row.github_snapshot_json);
          if (
            storedSnapshot.stateNeedsConfirmation &&
            storedSnapshot.state !== issue.state &&
            confirmedState !== issue.state
          )
            return null;
          if (Date.parse(issue.updatedAt) < Date.parse(storedSnapshot.updatedAt)) return null;
          const stored = {
            title: row.title,
            body: row.body,
            labels: yield* decodeLabels(row.labels_json),
          };
          const next = { title: issue.title, body: issue.body ?? row.body, labels };
          const changes = issueChanges(stored, storedSnapshot, next, snapshot);
          const target = reconciledStatus(statuses, TicketStatusId.make(row.status_id), issue);
          const [linked] = yield* sql<{ readonly found: number }>`
            SELECT 1 AS found FROM ticket_links
            WHERE ticket_id = ${ticketId} AND kind = 'project' AND target_key = ${input.projectId}
          `;
          const changed =
            changes.length > 0 ||
            storedSnapshot.stateReason !== snapshot.stateReason ||
            storedSnapshot.author !== snapshot.author ||
            storedSnapshot.updatedAt !== snapshot.updatedAt ||
            storedSnapshot.stateNeedsConfirmation === true ||
            storedSnapshot.url !== snapshot.url;
          if (target === undefined && linked !== undefined && !changed) return null;
          const revises =
            target !== undefined ||
            changes.some((change) => change !== "state" && change !== "assignees");
          yield* sql`
            UPDATE tickets SET
              title = ${next.title},
              body = ${next.body},
              labels_json = ${encodeJson(next.labels)},
              github_snapshot_json = ${encodeJson(snapshot)},
              status_id = ${target?.id ?? row.status_id},
              sort_key = ${target === undefined ? sql`sort_key` : yield* appendKey(target.id)},
              revision = revision + ${revises ? 1 : 0},
              updated_at = ${at}
            WHERE ticket_id = ${ticketId}
          `;
          if (linked === undefined) yield* insertLink(ticketId, projectLink, "auto", at);
          yield* appendActivity(
            ticketId,
            actor,
            [
              ...(changes.length > 0 ? [{ type: "synced" as const, changes }] : []),
              ...(target === undefined
                ? []
                : [
                    {
                      type: "status_changed" as const,
                      from: TicketStatusId.make(row.status_id),
                      to: target.id,
                    },
                  ]),
              ...(linked === undefined ? [{ type: "linked" as const, target: projectLink }] : []),
            ],
            at,
          );
          if (revises) yield* refreshSearch(ticketId);
          return ticketId;
        }),
      );
      if (written !== null) yield* publishTickets([written]);
    }).pipe(
      Effect.catchTags({
        SqlError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not save a synced issue.", cause })),
        SchemaError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read a synced ticket.", cause })),
      }),
    );

  const githubTarget = (input: TicketGitHubIssueRef) =>
    Effect.gen(function* () {
      if (input.linkedIssue !== undefined) {
        const owner = yield* get(input.ticketId);
        const target = normalizeThreadPullRequestKey(input.linkedIssue);
        const linked = owner.links.find(
          (link) =>
            link.target.kind === "issue" && threadPullRequestKeysEqual(link.target.ref, target),
        );
        if (linked === undefined)
          return yield* new TicketError({ message: "This issue is not linked to the ticket." });
        return { ...target, ticketId: owner.summary.id };
      }
      const current = yield* requireSummary(input.ticketId);
      if (current.kind !== "github")
        return yield* new TicketError({ message: "This ticket has no GitHub issue." });
      return { ...current.github, ticketId: current.id };
    });
  const runResolvedIssue = <A>(
    target: GitHubIssueTarget,
    call: (
      api: IssueProviderApi,
      input: { cwd: string; host: string; repository: string; number: number },
      project: OrchestrationProjectShell,
    ) => Effect.Effect<A, IssueProviderError>,
  ) =>
    github
      .run(target, (api, cwd, project) =>
        call(
          api,
          {
            cwd,
            host: target.host,
            repository: target.repository,
            number: target.number,
          },
          project,
        ),
      )
      .pipe(
        Effect.mapError(
          (error) =>
            new TicketError({ message: TicketGitHub.describeGitHubFailure(error), cause: error }),
        ),
      );
  const runTicketIssue = <A>(
    input: TicketGitHubIssueRef,
    call: Parameters<typeof runResolvedIssue<A>>[1],
  ) => githubTarget(input).pipe(Effect.flatMap((target) => runResolvedIssue(target, call)));
  const readLinkedIssueDetail = (target: LinkedRead) =>
    runResolvedIssue(target, (api, ref, project) =>
      Effect.gen(function* (): Effect.fn.Return<TicketGitHubIssueDetail, IssueProviderError> {
        const links = api.repositoryLinks(ref);
        if (links === null)
          return yield* new IssueProviderError({
            provider: api.kind,
            operation: "detail",
            reason: "failed",
            detail: "The linked issue's repository identity is not valid for this host.",
          });
        const issue = yield* api.getIssue(ref);
        const { title, body, assignees, comments, stateReason: _stateReason, ...metadata } = issue;
        return {
          title,
          body,
          assignees,
          comments,
          preview: {
            ...metadata,
            ...links,
            provider: api.kind,
            host: ref.host,
            repository: ref.repository,
            projectId: project.id,
            projectTitle: project.title,
          },
        };
      }),
    );
  class LinkedRead extends Data.Class<{
    readonly projectId: ProjectId;
    readonly host: string;
    readonly repository: string;
    readonly number: number;
  }> {}
  const resolveIssueTarget = (input: TicketGitHubIssueRef) =>
    Effect.gen(function* () {
      const target = yield* githubTarget(input);
      const projectId = yield* github.projectFor(target);
      if (projectId === null)
        return yield* new TicketError({
          message: `No project here can read ${target.host}/${target.repository}. Add an enabled GitHub source or link a project with this repository.`,
        });
      return { ...target, projectId };
    });
  const linkedReadKey = (target: ResolvedGitHubIssueTarget) =>
    new LinkedRead({ projectId: target.projectId, ...normalizeThreadPullRequestKey(target) });
  const linkedDetailCache = yield* Cache.makeWith(readLinkedIssueDetail, {
    capacity: 512,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.seconds(15) : Duration.zero),
  });
  const linkedActivityCache = yield* Cache.makeWith(
    (target: LinkedRead) => runResolvedIssue(target, (api, ref) => api.getIssueActivity(ref)),
    {
      capacity: 512,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.seconds(15) : Duration.zero),
    },
  );
  const githubIssueDetail: TicketService["Service"]["githubIssueDetail"] = (input) =>
    input.linkedIssue === undefined
      ? runTicketIssue(input, (api, ref) => api.getIssue(ref)).pipe(
          Effect.map(({ title, body, assignees, comments }) => ({
            title,
            body,
            assignees,
            comments,
          })),
        )
      : resolveIssueTarget(input).pipe(
          Effect.flatMap((target) => Cache.get(linkedDetailCache, linkedReadKey(target))),
        );
  const githubIssueActivity: TicketService["Service"]["githubIssueActivity"] = (input) =>
    input.linkedIssue === undefined
      ? runTicketIssue(input, (api, ref) => api.getIssueActivity(ref))
      : resolveIssueTarget(input).pipe(
          Effect.flatMap((target) => Cache.get(linkedActivityCache, linkedReadKey(target))),
        );
  const invalidateLinkedReads = (target: ResolvedGitHubIssueTarget) =>
    Effect.all(
      [
        Cache.invalidate(linkedDetailCache, linkedReadKey(target)),
        Cache.invalidate(linkedActivityCache, linkedReadKey(target)),
      ],
      { discard: true },
    );
  const invalidateGitHubIssue: TicketService["Service"]["invalidateGitHubIssue"] = (input) =>
    resolveIssueTarget(input).pipe(Effect.flatMap(invalidateLinkedReads));
  const issueLinkCandidates: TicketService["Service"]["issueLinkCandidates"] = (input) =>
    get(input.ticketId).pipe(
      Effect.flatMap((owner) =>
        github.issueLinkCandidates(
          owner.links.flatMap((link) =>
            link.target.kind === "project" ? [link.target.projectId] : [],
          ),
        ),
      ),
    );
  const githubIssueAssigneeCandidates: TicketService["Service"]["githubIssueAssigneeCandidates"] = (
    input,
  ) => runTicketIssue(input, (api, ref) => api.listAssigneeCandidates(ref));
  const githubIssueSetAssignees: TicketService["Service"]["githubIssueSetAssignees"] = (input) =>
    Effect.gen(function* () {
      const target = yield* resolveIssueTarget(input);
      yield* runResolvedIssue(target, (api, ref) =>
        api.setAssignees({ ...ref, assignees: input.assignees, assigned: input.assigned }),
      );
      yield* invalidateLinkedReads(target);
    });
  const refreshGitHubIssue: TicketService["Service"]["refreshGitHubIssue"] = (input) =>
    Effect.gen(function* () {
      const target = yield* resolveIssueTarget(input);
      const issue = yield* runResolvedIssue(target, (api, ref) => api.getIssue(ref));
      yield* upsertGitHubIssue({
        existingTicketId: input.ticketId,
        readKind: "direct",
        projectId: target.projectId,
        host: target.host,
        repository: target.repository,
        issue,
      });
      yield* invalidateLinkedReads(target);
      return yield* requireSummary(input.ticketId);
    });

  const inRepository = (repository: GitHubRepository) =>
    sql`t.kind = 'github' AND t.github_host = ${repository.host}
      AND t.github_repository = ${repository.repository}`;

  const openGitHubIssueNumbers: TicketService["Service"]["openGitHubIssueNumbers"] = (repository) =>
    sql<{ readonly github_number: number }>`
      SELECT t.github_number FROM tickets t
      WHERE ${inRepository(repository)} AND t.hidden_at IS NULL
        AND json_extract(t.github_snapshot_json, '$.state') = 'open'
      ORDER BY t.github_number
    `.pipe(
      Effect.map((rows) => rows.map((row) => row.github_number)),
      Effect.mapError(ticketError("Could not read the tracked issues.")),
    );

  const releaseGitHubRepository: TicketService["Service"]["releaseGitHubRepository"] = (input) =>
    Effect.gen(function* () {
      if (!input.deleteCache) {
        const at = yield* now;
        const hidden = yield* sql<{ readonly ticket_id: string }>`
          UPDATE tickets AS t SET hidden_at = ${at}, hidden_reason = 'source', updated_at = ${at}
          WHERE ${inRepository(input)} AND t.hidden_at IS NULL
          RETURNING ticket_id
        `;
        yield* publishTickets(hidden.map((row) => TicketId.make(row.ticket_id)));
        return;
      }
      const { tickets, attachments, plans } = yield* sql.withTransaction(
        Effect.gen(function* () {
          const attachments = yield* sql<AttachmentRow>`
            SELECT a.attachment_id, a.type, a.name, a.mime_type, a.size_bytes, a.created_at
            FROM ticket_attachments a JOIN tickets t ON t.ticket_id = a.ticket_id
            WHERE ${inRepository(input)}
          `;
          const plans = yield* sql<{ readonly plan_id: string }>`
            SELECT p.plan_id FROM ticket_plans p JOIN tickets t ON t.ticket_id = p.ticket_id
            WHERE ${inRepository(input)}
          `;
          yield* sql`
            DELETE FROM tickets_fts
            WHERE rowid IN (SELECT t.number FROM tickets t WHERE ${inRepository(input)})
          `;
          const tickets = yield* sql<{ readonly ticket_id: string }>`
            DELETE FROM tickets AS t WHERE ${inRepository(input)}
            RETURNING ticket_id
          `;
          return { tickets, attachments, plans };
        }),
      );
      yield* publishTickets(tickets.map((row) => TicketId.make(row.ticket_id)));
      yield* publishPlans(plans.map((row) => TicketPlanId.make(row.plan_id)));
      yield* removeAttachmentFiles(attachments);
    }).pipe(Effect.mapError(ticketError("Could not release the repository's tickets.")));

  const restoreGitHubRepository: TicketService["Service"]["restoreGitHubRepository"] = (
    repository,
  ) =>
    Effect.gen(function* () {
      const at = yield* now;
      const shown = yield* sql<{ readonly ticket_id: string }>`
        UPDATE tickets AS t SET hidden_at = NULL, hidden_reason = NULL, updated_at = ${at}
        WHERE ${inRepository(repository)} AND t.hidden_reason = 'source'
        RETURNING ticket_id
      `;
      yield* publishTickets(shown.map((row) => TicketId.make(row.ticket_id)));
    }).pipe(Effect.mapError(ticketError("Could not track the repository's tickets again.")));

  /**
   * Moving a status across the closed line would leave its GitHub tickets disagreeing with their
   * issues, and sync would then close or reopen them in bulk, so it waits until they are moved.
   * Hidden tickets count: they come back when tracked again.
   */
  const refuseClosedLineChange = (statusId: TicketStatusId, category: TicketStatusCategory) =>
    Effect.gen(function* () {
      const current = (yield* readStatuses).statuses.find((status) => status.id === statusId);
      if (current === undefined || (current.category === "closed") === (category === "closed")) {
        return;
      }
      const [row] = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM tickets WHERE status_id = ${statusId} AND kind = 'github'
      `;
      const count = row?.count ?? 0;
      if (count === 0) return;
      return yield* new TicketError({
        message: `${current.name} holds ${count} GitHub ${count === 1 ? "ticket" : "tickets"}. Move ${count === 1 ? "it" : "them"} to another status first: making ${current.name} ${category === "closed" ? "closed" : "not closed"} would ${category === "closed" ? "close" : "reopen"} ${count === 1 ? "its issue" : "their issues"}.`,
      });
    });

  const upsertStatus: TicketService["Service"]["upsertStatus"] = (input) =>
    Effect.gen(function* () {
      const set = yield* sql.withTransaction(
        Effect.gen(function* () {
          const closeReason = input.category === "closed" ? input.closeReason : null;
          let statusId = input.statusId;
          if (statusId === undefined) {
            statusId = TicketStatusId.make(NodeCrypto.randomUUID());
            yield* sql`
              INSERT INTO ticket_statuses (
                status_id, name, color, category, close_reason, position, collapsed_by_default,
                is_default
              ) VALUES (
                ${statusId}, ${input.name}, ${input.color}, ${input.category}, ${closeReason},
                (SELECT COALESCE(MAX(position) + 1, 0) FROM ticket_statuses),
                ${input.collapsedByDefault === true ? 1 : 0}, 0
              )
            `;
          } else {
            yield* refuseClosedLineChange(statusId, input.category);
            const updated = yield* sql<{ readonly status_id: string }>`
              UPDATE ticket_statuses SET
                name = ${input.name},
                color = ${input.color},
                category = ${input.category},
                close_reason = ${closeReason},
                is_default = CASE WHEN category = ${input.category} THEN is_default ELSE 0 END,
                collapsed_by_default = COALESCE(
                  ${input.collapsedByDefault === undefined ? null : input.collapsedByDefault ? 1 : 0},
                  collapsed_by_default
                )
              WHERE status_id = ${statusId}
              RETURNING status_id
            `;
            if (updated.length === 0) {
              return yield* new TicketError({ message: `Status ${statusId} does not exist.` });
            }
          }
          if (input.isDefault === true) {
            yield* sql`
              UPDATE ticket_statuses SET is_default = 0
              WHERE category = ${input.category} AND status_id != ${statusId}
            `;
            yield* sql`UPDATE ticket_statuses SET is_default = 1 WHERE status_id = ${statusId}`;
          } else if (input.isDefault === false) {
            yield* sql`UPDATE ticket_statuses SET is_default = 0 WHERE status_id = ${statusId}`;
          }
          return yield* readValidStatuses;
        }),
      );
      yield* publishStatuses;
      return set;
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not save the status.")));

  const reorderStatuses: TicketService["Service"]["reorderStatuses"] = (input) =>
    Effect.gen(function* () {
      const set = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* readStatuses;
          const known = new Set(current.statuses.map((status) => status.id));
          const requested = new Set(input.statusIds);
          if (
            requested.size !== input.statusIds.length ||
            requested.size !== known.size ||
            !input.statusIds.every((statusId) => known.has(statusId))
          ) {
            return yield* new TicketError({ message: "A reorder must list every status once." });
          }
          yield* Effect.forEach(
            input.statusIds,
            (statusId, position) =>
              sql`UPDATE ticket_statuses SET position = ${position} WHERE status_id = ${statusId}`,
            { discard: true },
          );
          return yield* readStatuses;
        }),
      );
      yield* publishStatuses;
      return set;
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not reorder the statuses.")));

  const deleteStatus: TicketService["Service"]["deleteStatus"] = (input, actor) =>
    Effect.gen(function* () {
      const { set, moved } = yield* sql.withTransaction(
        Effect.gen(function* () {
          const deleted = yield* requireStatus(input.statusId);
          const target = yield* requireStatus(input.reassignTo);
          if (target.id === deleted.id || target.category !== deleted.category) {
            return yield* new TicketError({
              message: `Move ${deleted.name}'s tickets to another ${deleted.category} status.`,
            });
          }
          const tickets = yield* sql<{ readonly ticket_id: string }>`
            SELECT ticket_id FROM tickets WHERE status_id = ${input.statusId} ORDER BY sort_key
          `;
          const at = yield* now;
          let sortKey = yield* appendKey(input.reassignTo);
          for (const ticket of tickets) {
            const ticketId = TicketId.make(ticket.ticket_id);
            yield* sql`
              UPDATE tickets SET
                status_id = ${input.reassignTo}, sort_key = ${sortKey},
                revision = revision + 1, updated_at = ${at}
              WHERE ticket_id = ${ticketId}
            `;
            yield* appendActivity(
              ticketId,
              actor,
              [{ type: "status_changed", from: input.statusId, to: input.reassignTo }],
              at,
            );
            sortKey = keyBetween(sortKey, null);
          }
          yield* sql`DELETE FROM ticket_statuses WHERE status_id = ${input.statusId}`;
          if (deleted.isDefault) {
            yield* sql`
              UPDATE ticket_statuses SET is_default = 1
              WHERE status_id = (
                SELECT status_id FROM ticket_statuses WHERE category = ${deleted.category}
                ORDER BY position LIMIT 1
              )
            `;
          }
          return {
            set: yield* readValidStatuses,
            moved: tickets.map((ticket) => TicketId.make(ticket.ticket_id)),
          };
        }),
      );
      yield* publishStatuses;
      yield* publishTickets(moved);
      return set;
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not delete the status.")));

  const readDelta = (ticketIds: ReadonlyArray<TicketId>) =>
    Effect.gen(function* () {
      const chunks = yield* Effect.forEach(Arr.chunksOf(ticketIds, ID_CHUNK), (chunk) =>
        selectSummaries(sql`t.ticket_id IN ${sql.in(chunk)}`),
      );
      const upserted = chunks.flat();
      const found = new Set<string>(upserted.map((ticket) => ticket.id));
      return {
        type: "delta",
        upserted,
        removed: ticketIds.filter((ticketId) => !found.has(ticketId)),
      } satisfies TicketListEvent;
    });

  const subscribeList: TicketService["Service"]["subscribeList"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscriber = yield* subscribeChanges(ticketSubscribers, () => true);
        const nextDelta = Queue.take(subscriber.wake).pipe(
          Effect.andThen(Effect.sleep(DELTA_WINDOW)),
          Effect.andThen(Effect.sync(() => drain(subscriber))),
          Effect.flatMap(readDelta),
        );
        return Stream.concat(
          Stream.fromEffect(
            selectSummaries(sql`1 = 1`).pipe(
              Effect.map((tickets): TicketListEvent => ({ type: "snapshot", tickets })),
            ),
          ),
          Stream.fromEffectRepeat(nextDelta).pipe(
            Stream.filter((delta) => delta.upserted.length > 0 || delta.removed.length > 0),
          ),
        );
      }),
    );

  const subscribeDetail: TicketService["Service"]["subscribeDetail"] = (ticketId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscriber = yield* subscribeChanges(
          ticketSubscribers,
          (changed) => changed === ticketId,
        );
        const nextDetail = Queue.take(subscriber.wake).pipe(
          Effect.andThen(Effect.sync(() => drain(subscriber))),
          Effect.andThen(get(ticketId)),
        );
        return Stream.concat(Stream.fromEffect(get(ticketId)), Stream.fromEffectRepeat(nextDetail));
      }),
    );

  const subscribeThreadLinks: TicketService["Service"]["subscribeThreadLinks"] = subscribeChanges(
    threadLinkSubscribers,
    () => true,
  ).pipe(
    Effect.map((subscriber) =>
      Stream.fromEffectRepeat(
        Queue.take(subscriber.wake).pipe(Effect.andThen(Effect.sync(() => drain(subscriber)))),
      ),
    ),
  );

  const subscribeStatuses: TicketService["Service"]["subscribeStatuses"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(statusChanges);
        return Stream.concat(
          Stream.fromEffect(readStatuses),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => readStatuses)),
        );
      }),
    );

  const selectPlanSummaries = (where: Statement.Fragment) =>
    selectPlanRows(where).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) => planFields(row).pipe(Effect.flatMap(decodePlanSummary))),
      ),
      Effect.mapError(ticketError("Could not read the plan.")),
    );

  const requirePlanSummary = (planId: TicketPlanId) =>
    selectPlanSummaries(sql`p.plan_id = ${planId}`).pipe(
      Effect.flatMap(([summary]) =>
        summary === undefined
          ? Effect.fail(new TicketPlanNotFoundError({ planId }))
          : Effect.succeed(summary),
      ),
    );

  const requirePlan = (planId: TicketPlanId) =>
    sql<{
      readonly ticket_id: string;
      readonly number: number;
      readonly title: string;
      readonly body: string;
      readonly status: string;
      readonly review_status: TicketPlanReviewStatus;
      readonly revision: number;
    }>`
      SELECT ticket_id, number, title, body, status, review_status, revision FROM ticket_plans
      WHERE plan_id = ${planId}
    `.pipe(
      Effect.flatMap(([row]) =>
        row === undefined
          ? Effect.fail(new TicketPlanNotFoundError({ planId }))
          : Effect.succeed({ ...row, ticketId: TicketId.make(row.ticket_id) }),
      ),
    );

  const requireComment = (planId: TicketPlanId, commentId: TicketPlanCommentId) =>
    sql<{ readonly comment_id: string; readonly parent_comment_id: string | null }>`
      SELECT comment_id, parent_comment_id FROM ticket_plan_comments
      WHERE plan_id = ${planId} AND comment_id = ${commentId}
    `.pipe(
      Effect.flatMap(([row]) =>
        row === undefined
          ? Effect.fail(new TicketError({ message: `Comment ${commentId} is not on this plan.` }))
          : Effect.succeed(row),
      ),
    );

  // Never the ticket's revision: bumping it would make the user's in-progress description autosave
  // fail with a conflict whenever an agent saves a plan.
  const touchTicket = (ticketId: TicketId, at: string) =>
    sql`UPDATE tickets SET updated_at = ${at} WHERE ticket_id = ${ticketId}`;

  const changePlanStatus = (
    current: Effect.Success<ReturnType<typeof requirePlan>>,
    planId: TicketPlanId,
    status: TicketPlanStatus,
    actor: TicketActor,
    at: string,
  ) =>
    Effect.gen(function* () {
      if (current.status === status) return false;
      yield* sql`
        UPDATE ticket_plans
        SET status = ${status}, updated_at = ${at}, updated_by_json = ${encodeJson(actor)}
        WHERE plan_id = ${planId}
      `;
      yield* appendActivity(
        current.ticketId,
        actor,
        [
          {
            type: status === "archived" ? "plan_archived" : "plan_restored",
            planId,
            number: current.number,
          },
        ],
        at,
      );
      yield* touchTicket(current.ticketId, at);
      return true;
    });

  /** Ones already resolved keep who resolved them. True when any comment changed. */
  const resolveComments = (
    planId: TicketPlanId,
    commentIds: ReadonlyArray<TicketPlanCommentId>,
    actor: TicketActor,
    at: string,
  ) =>
    Effect.gen(function* () {
      if (commentIds.length === 0) return false;
      const rows = yield* sql<{
        readonly comment_id: string;
        readonly parent_comment_id: string | null;
      }>`
        SELECT comment_id, parent_comment_id FROM ticket_plan_comments
        WHERE plan_id = ${planId} AND comment_id IN ${sql.in(commentIds)}
      `;
      const parents = new Map(rows.map((row) => [row.comment_id, row.parent_comment_id]));
      for (const commentId of commentIds) {
        const parent = parents.get(commentId);
        if (parent === undefined) {
          return yield* new TicketError({ message: `Comment ${commentId} is not on this plan.` });
        }
        if (parent !== null) {
          return yield* new TicketError({
            message: `Comment ${commentId} is a reply; resolve the comment it replies to.`,
          });
        }
      }
      const resolved = yield* sql<{ readonly comment_id: string }>`
        UPDATE ticket_plan_comments
        SET resolved_at = ${at}, resolved_by_json = ${encodeJson(actor)}
        WHERE plan_id = ${planId} AND comment_id IN ${sql.in(commentIds)} AND resolved_at IS NULL
        RETURNING comment_id
      `;
      return resolved.length > 0;
    });

  const resolvePlanRef: TicketService["Service"]["resolvePlanRef"] = (reference) =>
    Effect.gen(function* () {
      const parsed = parseTicketPlanReference(reference);
      if (parsed === null) {
        return yield* new TicketError({ message: `"${reference}" is not a plan reference.` });
      }
      if (parsed.type === "id") return yield* requirePlanSummary(parsed.planId);
      const ticket = yield* resolveRef(parsed.ticket);
      const plan = ticket.plans.find((candidate) => candidate.number === parsed.number);
      if (plan === undefined) {
        return yield* new TicketPlanNotFoundError({ planId: reference.trim() });
      }
      return plan;
    });

  const listPlans: TicketService["Service"]["listPlans"] = (ticketId) =>
    requireSummary(ticketId).pipe(Effect.map((summary) => summary.plans));

  const getPlan: TicketService["Service"]["getPlan"] = (planId) =>
    Effect.gen(function* () {
      // The summary first: a body newer than its revision makes a stale save conflict, while the
      // reverse would let it overwrite.
      const summary = yield* requirePlanSummary(planId);
      const plan = yield* requirePlan(planId);
      const comments = yield* sql<PlanCommentRow>`
        SELECT
          comment_id, parent_comment_id, anchor_json, body, actor_json, resolved_at,
          resolved_by_json, created_at
        FROM ticket_plan_comments WHERE plan_id = ${planId}
        ORDER BY created_at, rowid
      `.pipe(Effect.flatMap((rows) => Effect.forEach(rows, toPlanComment)));
      const referencedIds = attachmentReferenceIds(plan.body);
      const attachments = yield* sql<AttachmentRow>`
        SELECT attachment_id, type, name, mime_type, size_bytes, created_at
        FROM ticket_attachments WHERE ticket_id = ${plan.ticketId}
        ORDER BY created_at, attachment_id
      `;
      return {
        summary,
        body: plan.body,
        comments,
        attachments: attachments
          .filter((row) => referencedIds.has(row.attachment_id))
          .map(toAttachment),
      } satisfies TicketPlan;
    }).pipe(
      Effect.catchTags({
        SqlError: sqlFailure("Could not read the plan."),
        SchemaError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read the plan.", cause })),
      }),
    );

  const subscribePlan: TicketService["Service"]["subscribePlan"] = (planId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscriber = yield* subscribeChanges(
          planSubscribers,
          (changed) => changed === planId,
        );
        const nextPlan = Queue.take(subscriber.wake).pipe(
          Effect.andThen(Effect.sync(() => drain(subscriber))),
          Effect.andThen(getPlan(planId)),
        );
        return Stream.concat(Stream.fromEffect(getPlan(planId)), Stream.fromEffectRepeat(nextPlan));
      }),
    );

  const createPlan: TicketService["Service"]["createPlan"] = (input, actor) =>
    Effect.gen(function* () {
      const planId = TicketPlanId.make(NodeCrypto.randomUUID());
      const claim = yield* claimAttachments(input.ticketId, input.attachments ?? []);
      const body = yield* attachmentBody(input.body ?? "", claim, true);
      const storedAttachments: TicketAttachment[] = [];
      yield* commitAttachmentWrite({
        claim,
        body: Effect.gen(function* () {
          const at = yield* now;
          const [counter] = yield* sql<{ readonly number: number }>`
              UPDATE tickets SET next_plan_number = next_plan_number + 1, updated_at = ${at}
              WHERE ticket_id = ${input.ticketId}
              RETURNING next_plan_number - 1 AS number
            `;
          if (counter === undefined) {
            return yield* new TicketNotFoundError({ ticketId: input.ticketId });
          }
          yield* sql`
              INSERT INTO ticket_plans (
                plan_id, ticket_id, number, title, body, status, review_status, revision, created_by_json,
                updated_by_json, created_at, updated_at
              ) VALUES (
                ${planId}, ${input.ticketId}, ${counter.number}, ${input.title}, ${body ?? ""},
                'active', 'draft', 1, ${encodeJson(actor)}, ${encodeJson(actor)}, ${at}, ${at}
              )
            `;
          storedAttachments.push(
            ...claim.attachments.map((attachment) => ({ ...attachment, createdAt: at })),
          );
          const attachmentEntries = yield* insertAttachments(input.ticketId, claim.attachments, at);
          yield* appendActivity(
            input.ticketId,
            actor,
            [{ type: "plan_created", planId, number: counter.number }, ...attachmentEntries],
            at,
          );
        }),
        complete: () => publishTickets([input.ticketId]),
      });
      return {
        plan: yield* requirePlanSummary(planId),
        attachments: claim.mapping,
        storedAttachments,
      };
    }).pipe(
      Effect.scoped,
      Effect.catchTags({
        SqlError: sqlFailure("Could not create the plan."),
        TicketPlanNotFoundError: (cause) =>
          Effect.fail(new TicketError({ message: "The new plan could not be read back.", cause })),
      }),
    );

  const updatePlan: TicketService["Service"]["updatePlan"] = (input, actor) =>
    Effect.gen(function* () {
      if (input.body !== undefined && input.edits !== undefined) {
        return yield* new TicketError({ message: "Send a new body or edits, not both." });
      }
      const { ticketId } = yield* requirePlan(input.planId);
      const claim = yield* claimAttachments(ticketId, input.attachments ?? []);
      const storedAttachments: TicketAttachment[] = [];
      const result = yield* commitAttachmentWrite({
        claim,
        body: Effect.gen(function* () {
          const current = yield* requirePlan(input.planId);
          const writesContent =
            input.title !== undefined ||
            input.body !== undefined ||
            (input.edits?.length ?? 0) > 0 ||
            (input.attachments?.length ?? 0) > 0;
          if (current.status === "archived" && input.status !== "active" && writesContent) {
            const { ref } = yield* requirePlanSummary(input.planId);
            return yield* new TicketError({
              message: `${ref} is archived. Restore it before editing it.`,
            });
          }
          const conflict = new TicketPlanRevisionConflictError({
            planId: input.planId,
            expectedRevision: input.expectedRevision,
            actualRevision: current.revision,
          });
          const stale = current.revision !== input.expectedRevision;
          const reviewStatus = input.reviewStatus ?? current.review_status;
          const reviewChanged = reviewStatus !== current.review_status;
          if (stale && reviewChanged && reviewStatus === "ready") {
            return yield* conflict;
          }
          if (stale && input.edits !== undefined && input.edits.length > 0) {
            return yield* conflict;
          }
          const nextBody =
            input.edits === undefined
              ? input.body
              : yield* applyPlanEdits(current.body, input.edits);
          const body = yield* attachmentBody(nextBody ?? current.body, claim, true);
          const title = input.title ?? current.title;
          const edited = title !== current.title || body !== current.body;
          if (edited && stale) return yield* conflict;
          const at = yield* now;
          if (edited) {
            yield* sql`
                UPDATE ticket_plans SET
                  title = ${title}, body = ${body}, revision = revision + 1,
                  updated_at = ${at}, updated_by_json = ${encodeJson(actor)}
                WHERE plan_id = ${input.planId}
              `;
            const entry = {
              type: "plan_edited",
              planId: input.planId,
              number: current.number,
            } as const;
            yield* recordEdit(ticketId, actor, entry, at, (previous) =>
              previous.type === "plan_edited" && previous.planId === input.planId
                ? entry
                : undefined,
            );
          }
          storedAttachments.push(
            ...claim.attachments.map((attachment) => ({ ...attachment, createdAt: at })),
          );
          const added = yield* insertAttachments(ticketId, claim.attachments, at);
          yield* appendActivity(ticketId, actor, added, at);
          if (edited || added.length > 0) yield* touchTicket(ticketId, at);
          const resolved = yield* resolveComments(
            input.planId,
            input.resolveCommentIds ?? [],
            actor,
            at,
          );
          const statusChanged =
            input.status === undefined
              ? false
              : yield* changePlanStatus(current, input.planId, input.status, actor, at);
          if (reviewChanged) {
            yield* sql`
                UPDATE ticket_plans
                SET review_status = ${reviewStatus}, updated_at = ${at},
                  updated_by_json = ${encodeJson(actor)}
                WHERE plan_id = ${input.planId}
              `;
            yield* appendActivity(
              ticketId,
              actor,
              [
                {
                  type: "plan_review_status_changed",
                  planId: input.planId,
                  number: current.number,
                  from: current.review_status,
                  to: reviewStatus,
                },
              ],
              at,
            );
            yield* touchTicket(ticketId, at);
          }
          return {
            changed: edited || added.length > 0 || resolved || statusChanged || reviewChanged,
            contentCommit: {
              observedRevision: current.revision,
              revision: current.revision + (edited ? 1 : 0),
            },
          };
        }),
        complete: (result) => (result.changed ? publishPlan(ticketId, input.planId) : Effect.void),
      });
      return {
        plan: yield* requirePlanSummary(input.planId),
        attachments: claim.mapping,
        storedAttachments,
        contentCommit: result.contentCommit,
      };
    }).pipe(Effect.scoped, Effect.catchTag("SqlError", sqlFailure("Could not update the plan.")));

  const deletePlan: TicketService["Service"]["deletePlan"] = (input, actor) =>
    Effect.gen(function* () {
      const ticketId = yield* sql.withTransaction(
        Effect.gen(function* () {
          const [deleted] = yield* sql<{ readonly ticket_id: string; readonly number: number }>`
            DELETE FROM ticket_plans WHERE plan_id = ${input.planId} RETURNING ticket_id, number
          `;
          if (deleted === undefined) {
            return yield* new TicketPlanNotFoundError({ planId: input.planId });
          }
          const ticketId = TicketId.make(deleted.ticket_id);
          const at = yield* now;
          yield* appendActivity(
            ticketId,
            actor,
            [{ type: "plan_deleted", planId: input.planId, number: deleted.number }],
            at,
          );
          yield* touchTicket(ticketId, at);
          return ticketId;
        }),
      );
      yield* publishPlan(ticketId, input.planId);
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not delete the plan.")));

  const addPlanComment: TicketService["Service"]["addPlanComment"] = (input, actor) =>
    Effect.gen(function* () {
      if (
        input.parentCommentId !== undefined &&
        (input.anchor !== undefined || input.sourceQuote !== undefined)
      ) {
        return yield* new TicketError({
          message: "A reply cannot carry an anchor: it belongs to the comment it replies to.",
        });
      }
      const { ticketId, comment } = yield* sql.withTransaction(
        Effect.gen(function* () {
          const { ticketId, body, revision } = yield* requirePlan(input.planId);
          const anchor =
            input.sourceQuote === undefined
              ? input.anchor
              : anchorFromSourceQuote(body, input.sourceQuote, revision);
          if (anchor !== undefined && "matches" in anchor) {
            const { ref } = yield* requirePlanSummary(input.planId);
            return yield* new TicketError({
              message:
                anchor.matches === 0
                  ? `The quote is not in ${ref}. Quote its Markdown source exactly, as t3_ticket_plan_get returns it.`
                  : `The quote matches ${anchor.matches} places in ${ref}. Quote more of the passage so it matches once.`,
            });
          }
          const parent =
            input.parentCommentId === undefined
              ? null
              : yield* requireComment(input.planId, input.parentCommentId);
          const comment: TicketPlanComment = {
            id: TicketPlanCommentId.make(NodeCrypto.randomUUID()),
            parentId:
              parent === null
                ? null
                : TicketPlanCommentId.make(parent.parent_comment_id ?? parent.comment_id),
            anchor: anchor ?? null,
            body: input.body,
            author: actor,
            createdAt: yield* now,
            resolvedAt: null,
            resolvedBy: null,
          };
          yield* sql`
            INSERT INTO ticket_plan_comments (
              comment_id, plan_id, parent_comment_id, anchor_json, body, actor_json, created_at
            ) VALUES (
              ${comment.id}, ${input.planId}, ${comment.parentId},
              ${comment.anchor === null ? null : encodeJson(comment.anchor)}, ${comment.body},
              ${encodeJson(actor)}, ${comment.createdAt}
            )
          `;
          return { ticketId, comment };
        }),
      );
      yield* comment.parentId === null
        ? publishPlan(ticketId, input.planId)
        : publishPlans([input.planId]);
      return comment;
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not add the comment.")));

  const reopenPlanComment: TicketService["Service"]["reopenPlanComment"] = (input) =>
    Effect.gen(function* () {
      const { ticketId, reopened } = yield* sql.withTransaction(
        Effect.gen(function* () {
          const { ticketId } = yield* requirePlan(input.planId);
          yield* requireComment(input.planId, input.commentId);
          const reopened = yield* sql<{ readonly comment_id: string }>`
            UPDATE ticket_plan_comments SET resolved_at = NULL, resolved_by_json = NULL
            WHERE comment_id = ${input.commentId} AND resolved_at IS NOT NULL
            RETURNING comment_id
          `;
          return { ticketId, reopened: reopened.length > 0 };
        }),
      );
      if (reopened) yield* publishPlan(ticketId, input.planId);
      return yield* requirePlanSummary(input.planId);
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not reopen the comment.")));

  const deletePlanComment: TicketService["Service"]["deletePlanComment"] = (input) =>
    Effect.gen(function* () {
      const { ticketId, reply } = yield* sql.withTransaction(
        Effect.gen(function* () {
          const { ticketId } = yield* requirePlan(input.planId);
          const [deleted] = yield* sql<{ readonly parent_comment_id: string | null }>`
            DELETE FROM ticket_plan_comments
            WHERE plan_id = ${input.planId} AND comment_id = ${input.commentId}
            RETURNING parent_comment_id
          `;
          if (deleted === undefined) {
            return yield* new TicketError({
              message: `Comment ${input.commentId} is not on this plan.`,
            });
          }
          return { ticketId, reply: deleted.parent_comment_id !== null };
        }),
      );
      yield* reply ? publishPlans([input.planId]) : publishPlan(ticketId, input.planId);
      return yield* requirePlanSummary(input.planId);
    }).pipe(Effect.catchTag("SqlError", sqlFailure("Could not delete the comment.")));

  return TicketService.of({
    subscribeList,
    subscribeDetail,
    subscribeThreadLinks,
    get,
    resolveRef,
    search,
    list,
    listForTarget,
    create,
    update,
    move,
    delete: deleteTicket,
    link,
    unlink,
    addComment,
    postUserComment,
    setHidden,
    upsertGitHubIssue,
    openGitHubIssueNumbers,
    githubIssueDetail,
    githubIssueActivity,
    githubIssueAssigneeCandidates,
    githubIssueSetAssignees,
    invalidateGitHubIssue,
    issueLinkCandidates,
    refreshGitHubIssue,
    releaseGitHubRepository,
    restoreGitHubRepository,
    readStatuses,
    subscribeStatuses,
    upsertStatus,
    reorderStatuses,
    deleteStatus,
    resolvePlanRef,
    listPlans,
    getPlan,
    subscribePlan,
    createPlan,
    updatePlan,
    deletePlan,
    addPlanComment,
    reopenPlanComment,
    deletePlanComment,
  });
});

export const layer = Layer.effect(TicketService, make);
