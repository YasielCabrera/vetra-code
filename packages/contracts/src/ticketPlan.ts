import * as Schema from "effect/Schema";

import {
  ASSISTANT_CITATION_CONTEXT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
} from "./assistantCitations.ts";
import {
  IsoDateTime,
  PositiveInt,
  TicketId,
  TicketPlanCommentId,
  TicketPlanId,
} from "./baseSchemas.ts";
import {
  parseTicketReference,
  TICKET_BODY_MAX_CHARS,
  TicketActor,
  TicketAttachment,
  TicketAttachmentUploads,
  TicketClaimedAttachment,
  TicketCommentInput,
  TicketPlanReviewStatus,
  TicketPlanStatus,
  TicketPlanSummary,
  TicketTitle,
} from "./ticket.ts";

/**
 * A ticket plan is a Markdown document attached to a ticket: how to implement it, without code
 * changes. A ticket has many, each numbered within it, so `T-42/P1` names one. `TicketPlanStatus`
 * and `TicketPlanSummary` live in `ticket.ts`, since every ticket summary lists its plans.
 */

export const TICKET_PLAN_ANCHOR_SOURCE_MAX_CHARS = 4_000;
export const TICKET_PLAN_ANCHOR_SOURCE_CONTEXT_MAX_CHARS = 32;

/** Quoted plan text: rendered in an anchor, Markdown source when an agent comments. */
export const TicketPlanQuoteText = Schema.String.check(
  Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  Schema.isPattern(/\S/),
);

/**
 * Two views of the passage a comment points at. `quote` selects rendered text the way an
 * `AssistantCitation` does, so the client can find and highlight it again; it is absent when the
 * comment anchors a whole diagram, image or code block. `source` is the Markdown of the enclosing
 * block or blocks, which is what agents read. `revision` is the plan revision the comment was
 * written against.
 */
export const TicketPlanAnchor = Schema.Struct({
  quote: Schema.optional(
    Schema.Struct({
      text: TicketPlanQuoteText,
      prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
      suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
    }),
  ),
  source: Schema.String.check(Schema.isMaxLength(TICKET_PLAN_ANCHOR_SOURCE_MAX_CHARS)),
  /** Disambiguates repeated source blocks; an empty side leaves that side unconstrained. */
  sourceContext: Schema.optional(
    Schema.Struct({
      prefix: Schema.String.check(Schema.isMaxLength(TICKET_PLAN_ANCHOR_SOURCE_CONTEXT_MAX_CHARS)),
      suffix: Schema.String.check(Schema.isMaxLength(TICKET_PLAN_ANCHOR_SOURCE_CONTEXT_MAX_CHARS)),
    }),
  ),
  revision: PositiveInt,
});
export type TicketPlanAnchor = typeof TicketPlanAnchor.Type;

export const TicketPlanComment = Schema.Struct({
  id: TicketPlanCommentId,
  /** Set on a reply, which always points at a top-level comment and carries no anchor. */
  parentId: Schema.NullOr(TicketPlanCommentId),
  /** Null on replies and on comments about the whole plan. */
  anchor: Schema.NullOr(TicketPlanAnchor),
  body: Schema.String,
  author: TicketActor,
  createdAt: IsoDateTime,
  /** Only top-level comments resolve. */
  resolvedAt: Schema.NullOr(IsoDateTime),
  resolvedBy: Schema.NullOr(TicketActor),
});
export type TicketPlanComment = typeof TicketPlanComment.Type;

export const TicketPlan = Schema.Struct({
  summary: TicketPlanSummary,
  body: Schema.String,
  /** Replies and top-level comments in one list, oldest first. */
  comments: Schema.Array(TicketPlanComment),
  /** The ticket's attachments the body references as `vetra-attachment://<id>`. */
  attachments: Schema.Array(TicketAttachment),
});
export type TicketPlan = typeof TicketPlan.Type;

const TicketPlanBody = Schema.String.check(
  Schema.isMaxLength(TICKET_BODY_MAX_CHARS, {
    message: "Plans can contain up to 100,000 characters.",
  }),
);

export const TicketPlanCreateInput = Schema.Struct({
  ticketId: TicketId,
  title: TicketTitle,
  body: Schema.optional(TicketPlanBody),
  /** Claimed onto the ticket; the body may reference them as `vetra-attachment://<pending id>`. */
  attachments: Schema.optional(TicketAttachmentUploads),
});
export type TicketPlanCreateInput = typeof TicketPlanCreateInput.Type;

const TicketPlanEdit = Schema.Struct({
  /** Must occur exactly once in the body as the earlier edits left it. */
  find: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(TICKET_BODY_MAX_CHARS)),
  replace: Schema.String.check(Schema.isMaxLength(TICKET_BODY_MAX_CHARS)),
});
export type TicketPlanEdit = typeof TicketPlanEdit.Type;

export const TicketPlanUpdateInput = Schema.Struct({
  planId: TicketPlanId,
  /** Checked when title or body changes, and when a Draft plan becomes Ready. */
  expectedRevision: PositiveInt,
  /** Restores or archives the plan in the same transaction as its content and comments. */
  status: Schema.optional(TicketPlanStatus),
  reviewStatus: Schema.optional(TicketPlanReviewStatus),
  title: Schema.optional(TicketTitle),
  /** Replaces the whole body; refused together with `edits`. */
  body: Schema.optional(TicketPlanBody),
  /** Find-and-replace edits applied in order to the stored body. */
  edits: Schema.optional(Schema.Array(TicketPlanEdit).check(Schema.isMaxLength(50))),
  attachments: Schema.optional(TicketAttachmentUploads),
  /** Top-level comments this write addresses, resolved in the same transaction. */
  resolveCommentIds: Schema.optional(
    Schema.Array(TicketPlanCommentId).check(Schema.isMaxLength(100)),
  ),
});
export type TicketPlanUpdateInput = typeof TicketPlanUpdateInput.Type;

export const TicketPlanDeleteInput = Schema.Struct({ planId: TicketPlanId });
export type TicketPlanDeleteInput = typeof TicketPlanDeleteInput.Type;

export const TicketPlanCommentInput = Schema.Struct({
  planId: TicketPlanId,
  body: TicketCommentInput.fields.body,
  /** Makes this a reply, which carries no anchor. A reply to a reply joins its thread. */
  parentCommentId: Schema.optional(TicketPlanCommentId),
  /** Omit to comment on the whole plan. */
  anchor: Schema.optional(TicketPlanAnchor),
});
export type TicketPlanCommentInput = typeof TicketPlanCommentInput.Type;

/** Names one comment, for reopening or deleting it. */
export const TicketPlanCommentRefInput = Schema.Struct({
  planId: TicketPlanId,
  commentId: TicketPlanCommentId,
});
export type TicketPlanCommentRefInput = typeof TicketPlanCommentRefInput.Type;

export const TicketPlanSubscribeInput = Schema.Struct({ planId: TicketPlanId });
export type TicketPlanSubscribeInput = typeof TicketPlanSubscribeInput.Type;

export const TicketPlanContentCommit = Schema.Struct({
  observedRevision: PositiveInt,
  revision: PositiveInt,
}).check(
  Schema.makeFilter(
    ({ observedRevision, revision }) =>
      revision === observedRevision || revision === observedRevision + 1,
  ),
);
export type TicketPlanContentCommit = typeof TicketPlanContentCommit.Type;

/** What `createPlan` and `updatePlan` return: the summary and the uploads they claimed. */
export const TicketPlanWriteResult = Schema.Struct({
  plan: TicketPlanSummary,
  attachments: Schema.Array(TicketClaimedAttachment),
  contentCommit: Schema.optional(TicketPlanContentCommit),
});
export type TicketPlanWriteResult = typeof TicketPlanWriteResult.Type;

export function formatTicketPlanRef(ticketNumber: number, planNumber: number): string {
  return `T-${ticketNumber}/P${planNumber}`;
}

/**
 * What a user or agent typed to name a plan: `T-42/P1`, `owner/repo#123/P1`, or a plan id. The
 * part before `/P` is any ticket reference, left for `resolveRef`.
 */
export type TicketPlanReference =
  | { readonly type: "number"; readonly ticket: string; readonly number: number }
  | { readonly type: "id"; readonly planId: TicketPlanId };

export function parseTicketPlanReference(input: string): TicketPlanReference | null {
  const text = input.trim();
  const numbered = /^(.+)\/P(\d+)$/i.exec(text);
  if (numbered) {
    const ticket = numbered[1]!.trim();
    const number = Number(numbered[2]);
    return number >= 1 && Number.isSafeInteger(number) && parseTicketReference(ticket) !== null
      ? { type: "number", ticket, number }
      : null;
  }
  // A plan id follows the ticket id rule, and `T-42` names a ticket rather than a plan.
  return parseTicketReference(text)?.type === "id"
    ? { type: "id", planId: TicketPlanId.make(text) }
    : null;
}

export class TicketPlanNotFoundError extends Schema.TaggedError<TicketPlanNotFoundError>()(
  "TicketPlanNotFoundError",
  { planId: Schema.String },
) {
  override get message(): string {
    return `Plan ${this.planId} was not found.`;
  }
}

export class TicketPlanRevisionConflictError extends Schema.TaggedError<TicketPlanRevisionConflictError>()(
  "TicketPlanRevisionConflictError",
  {
    planId: TicketPlanId,
    expectedRevision: PositiveInt,
    actualRevision: PositiveInt,
  },
) {
  override get message(): string {
    return "The plan changed since it was loaded. Reload it and try again.";
  }
}
