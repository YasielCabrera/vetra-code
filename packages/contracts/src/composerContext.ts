import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  ForwardCompatibleArray,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TicketId,
  TicketPlanId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { TicketLinkRef, TicketPlanStatus } from "./ticket.ts";

/**
 * Inline context records: the typed payload behind every composer chip.
 * A message's `text` carries position through canonical reference links
 * (`[label](vetra-context://v1/<kind>/<contextId>)`, see
 * `@t3tools/shared/composerContextReferences`); these records carry the payload,
 * keyed by `contextId`. Bytes never live here: image and file records bind to a
 * `ChatAttachment` by id.
 */

export const COMPOSER_CONTEXT_KINDS = [
  "image",
  "file",
  "terminal",
  "element",
  "preview-annotation",
  "review-comment",
  "mention",
  "skill",
  "thread",
  "ticket",
  "ticket-plan",
] as const;
export type KnownComposerContextKind = (typeof COMPOSER_CONTEXT_KINDS)[number];

const CONTEXT_ID_MAX_CHARS = 128;
const CONTEXT_ID_PATTERN = /^[a-z0-9_-]+$/i;
const CONTEXT_KIND_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const KNOWN_KIND_PATTERN = new RegExp(`^(?!(?:${COMPOSER_CONTEXT_KINDS.join("|")})$)`);

export const COMPOSER_CONTEXT_LABEL_MAX_CHARS = 200;
export const COMPOSER_CONTEXT_TERMINAL_TEXT_MAX_CHARS = 64_000;
const COMPOSER_CONTEXT_ELEMENT_HTML_MAX_CHARS = 8_000;
const COMPOSER_CONTEXT_ELEMENT_STYLES_MAX_CHARS = 8_000;
/** Exported so producers can clamp to the same boundary the schema enforces, rather than
    minting a record the send path would fail to encode. */
export const COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS = 16_000;
export const COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS = 32_000;
const COMPOSER_CONTEXT_PREVIEW_COMMENT_MAX_CHARS = 8_000;

/** Durable identity of one payload. Shared by every chip that points at it. */
export const ComposerContextId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CONTEXT_ID_MAX_CHARS),
  Schema.isPattern(CONTEXT_ID_PATTERN),
).pipe(Schema.brand("ComposerContextId"));
export type ComposerContextId = typeof ComposerContextId.Type;

/** Identity of one occurrence in a document. Changes when a chip is duplicated. */
export const ComposerContextReferenceId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CONTEXT_ID_MAX_CHARS),
  Schema.isPattern(CONTEXT_ID_PATTERN),
).pipe(Schema.brand("ComposerContextReferenceId"));
export type ComposerContextReferenceId = typeof ComposerContextReferenceId.Type;

/** Open kind: known kinds get typed records, everything else preserves its payload. */
export const ComposerContextKind = TrimmedNonEmptyString.check(
  Schema.isPattern(CONTEXT_KIND_PATTERN),
);
export type ComposerContextKind = typeof ComposerContextKind.Type;

// Same rules as the private `ChatAttachmentId` in orchestration.ts; duplicated here because
// orchestration.ts imports this module.
const ContextAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CONTEXT_ID_MAX_CHARS),
  Schema.isPattern(CONTEXT_ID_PATTERN),
);
const ContextLabel = Schema.String.check(Schema.isMaxLength(COMPOSER_CONTEXT_LABEL_MAX_CHARS));
const BoundedString = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const ShortString = BoundedString(2_048);
const NullableShortString = Schema.NullOr(ShortString);

/** Snapshot used to identify and present a pull request carried by a review-context record. */
export const PullRequestContextMetadata = Schema.Struct({
  number: PositiveInt,
  title: ShortString,
  url: ShortString,
  headBranch: ShortString,
  baseBranch: ShortString,
  state: Schema.Literals(["open", "closed", "merged"]),
  isDraft: Schema.Boolean,
});
export type PullRequestContextMetadata = typeof PullRequestContextMetadata.Type;

const recordBase = {
  version: Schema.Literal(1),
  contextId: ComposerContextId,
  label: ContextLabel,
} as const;

const attachmentBinding = {
  attachmentId: ContextAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sizeBytes: NonNegativeInt,
} as const;

export const ImageContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("image"),
  ...attachmentBinding,
});
export type ImageContextRecord = typeof ImageContextRecord.Type;

export const FileContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("file"),
  ...attachmentBinding,
});
export type FileContextRecord = typeof FileContextRecord.Type;

export const TerminalContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("terminal"),
  terminalId: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  terminalLabel: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  lineStart: NonNegativeInt,
  lineEnd: NonNegativeInt,
  text: BoundedString(COMPOSER_CONTEXT_TERMINAL_TEXT_MAX_CHARS),
}).check(Schema.makeFilter((record) => record.lineEnd >= record.lineStart));
export type TerminalContextRecord = typeof TerminalContextRecord.Type;

export const ElementContextSource = Schema.Struct({
  functionName: NullableShortString,
  fileName: NullableShortString,
  lineNumber: Schema.NullOr(NonNegativeInt),
  columnNumber: Schema.NullOr(NonNegativeInt),
});
export type ElementContextSource = typeof ElementContextSource.Type;

/** What a picked page element looks like to the agent; shared by element and annotation records. */
export const ElementContextDetails = Schema.Struct({
  pageUrl: ShortString,
  pageTitle: NullableShortString,
  tagName: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  selector: NullableShortString,
  htmlPreview: BoundedString(COMPOSER_CONTEXT_ELEMENT_HTML_MAX_CHARS),
  componentName: NullableShortString,
  source: Schema.NullOr(ElementContextSource),
  styles: BoundedString(COMPOSER_CONTEXT_ELEMENT_STYLES_MAX_CHARS),
});
export type ElementContextDetails = typeof ElementContextDetails.Type;

export const ElementContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("element"),
  ...ElementContextDetails.fields,
});
export type ElementContextRecord = typeof ElementContextRecord.Type;

export const PreviewAnnotationContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("preview-annotation"),
  annotationId: ShortString,
  pageUrl: ShortString,
  pageTitle: NullableShortString,
  comment: BoundedString(COMPOSER_CONTEXT_PREVIEW_COMMENT_MAX_CHARS),
  targetSummary: ShortString,
  styleChanges: Schema.Array(ShortString).check(Schema.isMaxLength(200)),
  /** Picked elements inside the annotation, with the detail the agent needs to find them. */
  elements: Schema.optional(Schema.Array(ElementContextDetails).check(Schema.isMaxLength(50))),
  /** Original target ids and edits allow pasted annotations to retain exact style changes. */
  elementIds: Schema.optional(Schema.Array(ShortString).check(Schema.isMaxLength(50))),
  /** Region and stroke geometry is lossy on purpose, but their counts feed the target summary,
      so a pasted annotation still says what it marked. */
  regionCount: Schema.optional(NonNegativeInt),
  strokeCount: Schema.optional(NonNegativeInt),
  styleChangeDetails: Schema.optional(
    Schema.Array(
      Schema.Struct({
        targetId: ShortString,
        selector: NullableShortString,
        property: ShortString,
        previousValue: BoundedString(COMPOSER_CONTEXT_ELEMENT_STYLES_MAX_CHARS),
        value: BoundedString(COMPOSER_CONTEXT_ELEMENT_STYLES_MAX_CHARS),
      }),
    ).check(Schema.isMaxLength(200)),
  ),
  /** The screenshot travels as its own image record; this links the two. */
  screenshotContextId: Schema.optional(ComposerContextId),
});
export type PreviewAnnotationContextRecord = typeof PreviewAnnotationContextRecord.Type;

export const ReviewCommentContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("review-comment"),
  sectionId: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  sectionTitle: ShortString,
  filePath: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  startIndex: NonNegativeInt,
  endIndex: NonNegativeInt,
  rangeLabel: ShortString,
  text: BoundedString(COMPOSER_CONTEXT_REVIEW_TEXT_MAX_CHARS),
  diff: BoundedString(COMPOSER_CONTEXT_REVIEW_DIFF_MAX_CHARS),
  fenceLanguage: Schema.optional(BoundedString(64)),
  pullRequest: Schema.optional(PullRequestContextMetadata),
}).check(Schema.makeFilter((record) => record.endIndex >= record.startIndex));
export type ReviewCommentContextRecord = typeof ReviewCommentContextRecord.Type;

export const MentionContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("mention"),
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
});
export type MentionContextRecord = typeof MentionContextRecord.Type;

export const SkillContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("skill"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
});
export type SkillContextRecord = typeof SkillContextRecord.Type;

/**
 * Another thread on the same server, attached so the agent can read its history through
 * `t3_thread_read`. Only identity travels; the title is a display snapshot.
 */
export const ThreadContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("thread"),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  title: ContextLabel,
});
export type ThreadContextRecord = typeof ThreadContextRecord.Type;

/** Longest ticket body a chip snapshots; the agent reads the rest with `t3_ticket_get`. */
export const COMPOSER_CONTEXT_TICKET_BODY_MAX_CHARS = 4_000;

const TicketContextRef = TrimmedNonEmptyString.check(Schema.isMaxLength(32));

/**
 * A ticket in the thread's environment. Identity leads: sending it links the thread to the
 * ticket. Title, body, links and plans are a snapshot for the agent; a chip picked from a list
 * has no body.
 */
export const TicketContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("ticket"),
  environmentId: EnvironmentId,
  ticketId: TicketId,
  /** `T-42`. */
  ref: TicketContextRef,
  title: ShortString,
  body: Schema.optional(BoundedString(COMPOSER_CONTEXT_TICKET_BODY_MAX_CHARS)),
  links: Schema.Array(TicketLinkRef).check(Schema.isMaxLength(50)),
  /**
   * References only: the agent reads a body with `t3_ticket_plan_get`. Optional because records
   * stored before plans existed carry none.
   */
  plans: Schema.optional(
    Schema.Array(
      Schema.Struct({
        planId: TicketPlanId,
        /** `T-42/P1`. */
        ref: TicketContextRef,
        title: ShortString,
        status: TicketPlanStatus,
        revision: PositiveInt,
        openCommentCount: NonNegativeInt,
      }),
    ).check(Schema.isMaxLength(50)),
  ),
});
export type TicketContextRecord = typeof TicketContextRecord.Type;

/**
 * One ticket plan, attached as the work to do. Only a reference travels, never the body, so a
 * long plan neither slips past the prompt length limit nor repeats in every message that carries
 * it; the agent reads the current body with `t3_ticket_plan_get`. Sending it links the thread to
 * the plan's ticket.
 */
export const TicketPlanContextRecord = Schema.Struct({
  ...recordBase,
  kind: Schema.Literal("ticket-plan"),
  environmentId: EnvironmentId,
  ticketId: TicketId,
  planId: TicketPlanId,
  /** `T-42/P1`. */
  ref: TicketContextRef,
  title: ShortString,
  /** The plan's revision when it was attached. */
  revision: PositiveInt,
  openCommentCount: NonNegativeInt,
});
export type TicketPlanContextRecord = typeof TicketPlanContextRecord.Type;

/**
 * Catch-all for kinds this build does not know. Known discriminators are excluded so a
 * malformed known record fails its own schema instead of sliding through unchecked.
 * Mirrors `ChatUnknownAttachment`.
 */
export const UnknownContextRecord = Schema.Struct({
  ...recordBase,
  kind: ComposerContextKind.check(Schema.isPattern(KNOWN_KIND_PATTERN)),
  payload: Schema.Unknown.check(
    Schema.makeFilter((payload) => {
      try {
        const encoded = JSON.stringify(payload);
        return encoded !== undefined && encoded.length <= 64_000;
      } catch {
        return false;
      }
    }),
  ),
});
export type UnknownContextRecord = typeof UnknownContextRecord.Type;

export const KnownComposerContextRecord = Schema.Union([
  ImageContextRecord,
  FileContextRecord,
  TerminalContextRecord,
  ElementContextRecord,
  PreviewAnnotationContextRecord,
  ReviewCommentContextRecord,
  MentionContextRecord,
  SkillContextRecord,
  ThreadContextRecord,
  TicketContextRecord,
  TicketPlanContextRecord,
]);
export type KnownComposerContextRecord = typeof KnownComposerContextRecord.Type;

export const ComposerContextRecord = Schema.Union([
  ...KnownComposerContextRecord.members,
  UnknownContextRecord,
]);
export type ComposerContextRecord = typeof ComposerContextRecord.Type;

export const COMPOSER_CONTEXT_MAX_RECORDS = 200;
const COMPOSER_CONTEXT_MAX_SERIALIZED_CHARS = 16_000_000;

/** Structured context riding on a user message. Undecodable records are dropped, not fatal. */
export const OrchestrationMessageContext = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Array(Schema.Unknown)
    .check(
      Schema.isMaxLength(COMPOSER_CONTEXT_MAX_RECORDS),
      Schema.makeFilter((records) => {
        try {
          return JSON.stringify(records).length <= COMPOSER_CONTEXT_MAX_SERIALIZED_CHARS;
        } catch {
          return false;
        }
      }),
    )
    .pipe(Schema.decodeTo(ForwardCompatibleArray(ComposerContextRecord)))
    .check(
      Schema.makeFilter(
        (records) => new Set(records.map((record) => record.contextId)).size === records.length,
      ),
    ),
});
export type OrchestrationMessageContext = typeof OrchestrationMessageContext.Type;
