import {
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  PositiveInt,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ProjectId,
  ThreadId,
  TICKET_LINKS_MAX_COUNT,
  TicketCommentInput,
  TicketCreateInput,
  TicketDetail,
  TicketError,
  TicketGitHubRef,
  TicketId,
  TicketLinkKind,
  TicketNotFoundError,
  TicketPlanComment,
  TicketPlanCommentInput,
  TicketPlanCreateInput,
  TicketPlanNotFoundError,
  TicketPlanRevisionConflictError,
  TicketPlanStatus,
  TicketPlanSummary,
  TicketPlanUpdateInput,
  TicketRevisionConflictError,
  TicketStatusCategory,
  TicketStatusDefinition,
  TicketStatusId,
  TicketSummary,
  TicketUpdateInput,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { McpAttachmentInput } from "../attachment/input.ts";

const shared = {
  failure: Schema.Union([
    McpCapabilityUnavailableError,
    OrchestratorMcpFailure,
    TicketNotFoundError,
    TicketRevisionConflictError,
    TicketPlanNotFoundError,
    TicketPlanRevisionConflictError,
    TicketError,
  ]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const ticket = TrimmedNonEmptyString.annotate({
  description: "The ticket as T-42, its ticket id, or owner/repo#123 for a GitHub ticket.",
});

const plan = TrimmedNonEmptyString.annotate({
  description: "The plan as T-42/P1, owner/repo#123/P1 for a GitHub ticket's plan, or its plan id.",
});

const planAttachments = Schema.optional(
  Schema.Array(McpAttachmentInput)
    .check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS))
    .annotate({
      description:
        "Pending uploads from t3_attachment_prepare_upload that the body references as vetra-attachment://<pending id>.",
    }),
);

/** A plan summary with its ticket, which a link to the plan needs. */
const PlanResult = Schema.Struct({ ticketId: TicketId, ...TicketPlanSummary.fields });

const PlanCommentReply = TicketPlanComment.mapFields(
  Struct.pick(["id", "author", "body", "createdAt"]),
);

const status = TicketStatusId.annotate({
  description: "A status id from t3_ticket_list's statuses.",
});

/**
 * What an agent may link. A pull request or issue is named by its ref, or a pull request by its
 * URL; Vetra Code derives the URL and fills the title and state itself.
 */
export const AgentTicketLinkTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({ kind: Schema.Literals(["pull_request", "issue"]), ref: TicketGitHubRef }),
  Schema.Struct({
    kind: Schema.Literal("pull_request"),
    url: TrimmedNonEmptyString.annotate({ description: "The pull request's web URL." }),
  }),
]);
export type AgentTicketLinkTarget = typeof AgentTicketLinkTarget.Type;

const TicketListTool = Tool.make("t3_ticket_list", {
  ...shared,
  description:
    "List this environment's tickets, most recently updated first, with the status set they move through. Every filter given must match.",
  parameters: Schema.Struct({
    status: Schema.optional(
      Schema.Union([TicketStatusCategory, TicketStatusId]).annotate({
        description: "A status id, or a category (open, active, closed) for all its statuses.",
      }),
    ),
    kind: Schema.optional(Schema.Literals(["local", "github"])),
    projectId: Schema.optional(ProjectId.annotate({ description: "Tickets linked to a project." })),
    threadId: Schema.optional(ThreadId.annotate({ description: "Tickets linked to a thread." })),
    label: Schema.optional(TrimmedNonEmptyString),
    query: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(500)).annotate({
        description: "Words to match in the title, body or labels.",
      }),
    ),
    limit: Schema.optional(
      PositiveInt.check(Schema.isLessThanOrEqualTo(200)).annotate({
        description: "Defaults to 50.",
      }),
    ),
  }),
  success: Schema.Struct({
    tickets: Schema.Array(TicketSummary),
    truncated: Schema.Boolean.annotate({ description: "True when more tickets matched." }),
    statuses: Schema.Array(TicketStatusDefinition),
  }),
})
  .annotate(Tool.Title, "List tickets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketGetTool = Tool.make("t3_ticket_get", {
  ...shared,
  description:
    "Read one ticket: body, links, attachments and recent activity. summary.revision is the expectedRevision t3_ticket_update needs.",
  parameters: Schema.Struct({ ticket }),
  success: TicketDetail,
})
  .annotate(Tool.Title, "Read a ticket")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketCreateTool = Tool.make("t3_ticket_create", {
  ...shared,
  description:
    "Create a local ticket. It links this thread and its project unless linkCaller is false. An analyzer draft always links its recorded project and source thread instead of the analyzer thread. New tickets land in the default open status unless status is given.",
  parameters: Schema.Struct({
    title: TicketCreateInput.fields.title,
    body: TicketCreateInput.fields.body.annotate({ description: "Markdown." }),
    labels: TicketCreateInput.fields.labels,
    status: Schema.optional(status),
    links: Schema.optional(
      Schema.Array(AgentTicketLinkTarget)
        .check(Schema.isMaxLength(TICKET_LINKS_MAX_COUNT))
        .annotate({
          description: "Links to add besides this thread.",
        }),
    ),
    linkCaller: Schema.optional(Schema.Boolean.annotate({ description: "Defaults to true." })),
  }),
  success: TicketSummary,
})
  .annotate(Tool.Title, "Create a ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const TicketUpdateTool = Tool.make("t3_ticket_update", {
  ...shared,
  description:
    "Change a ticket's title, body, labels or status. Omitted fields stay as they are. Fails if the ticket changed since you read the revision you pass: read it again and reapply. A GitHub ticket's title, body and labels belong to the issue, and only the user can move it into or out of a closed status.",
  parameters: Schema.Struct({
    ticket,
    expectedRevision: PositiveInt.annotate({
      description: "summary.revision from your latest t3_ticket_get or t3_ticket_list.",
    }),
    title: TicketUpdateInput.fields.title,
    body: TicketUpdateInput.fields.body.annotate({ description: "Markdown; replaces the body." }),
    labels: TicketUpdateInput.fields.labels,
    status: Schema.optional(status),
  }),
  success: TicketSummary,
})
  .annotate(Tool.Title, "Update a ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketLinkTool = Tool.make("t3_ticket_link", {
  ...shared,
  description:
    "Link a ticket to a project, thread, pull request or issue. Name a pull request or issue by host, repository and number, or a pull request by its URL. Linking an existing link succeeds and leaves it as it is.",
  parameters: Schema.Struct({ ticket, target: AgentTicketLinkTarget }),
  success: TicketSummary,
})
  .annotate(Tool.Title, "Link a ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketUnlinkTool = Tool.make("t3_ticket_unlink", {
  ...shared,
  description: "Remove one of a ticket's links. Removing a missing link succeeds.",
  parameters: Schema.Struct({
    ticket,
    kind: TicketLinkKind,
    targetKey: TrimmedNonEmptyString.annotate({
      description:
        "The link's targetKey from the ticket's linkRefs: a project or thread id, or host/owner/repo#123.",
    }),
  }),
  success: TicketSummary,
})
  .annotate(Tool.Title, "Unlink a ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketNoteTool = Tool.make("t3_ticket_note", {
  ...shared,
  description:
    "Add a note to a ticket's activity in Vetra Code, such as progress or findings. Notes stay local and never post to GitHub.",
  parameters: Schema.Struct({ ticket, body: TicketCommentInput.fields.body }),
  success: TicketSummary,
})
  .annotate(Tool.Title, "Note on a ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const TicketPlanListTool = Tool.make("t3_ticket_plan_list", {
  ...shared,
  description:
    "List a ticket's plans by number, without their bodies. Each ref, such as T-42/P1, names the plan for the other t3_ticket_plan_* tools.",
  parameters: Schema.Struct({ ticket }),
  success: Schema.Struct({ plans: Schema.Array(PlanResult) }),
})
  .annotate(Tool.Title, "List ticket plans")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketPlanGetTool = Tool.make("t3_ticket_plan_get", {
  ...shared,
  description:
    "Read a plan's Markdown body and its open comments in document order, each with its replies. A comment's quote and source are the passage it points at, and outdated means that passage is no longer in the body; comments without them are about the whole plan. plan.revision is the expectedRevision t3_ticket_plan_update needs.",
  parameters: Schema.Struct({
    plan,
    includeResolved: Schema.optional(
      Schema.Boolean.annotate({ description: "Also return resolved comments." }),
    ),
  }),
  success: Schema.Struct({
    ticketId: TicketId,
    plan: TicketPlanSummary,
    body: Schema.String,
    comments: Schema.Array(
      Schema.Struct({
        ...PlanCommentReply.fields,
        quote: Schema.optional(Schema.String),
        source: Schema.optional(Schema.String),
        outdated: Schema.Boolean,
        resolved: Schema.Boolean,
        replies: Schema.Array(PlanCommentReply),
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Read a ticket plan")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketPlanCreateTool = Tool.make("t3_ticket_plan_create", {
  ...shared,
  description:
    "Write a new plan for a ticket: how to implement it, in Markdown. Returns its ref, such as T-42/P1. To include an image, upload it with t3_attachment_prepare_upload, POST the bytes, write ![alt](vetra-attachment://<pending id>) in the body, and list the upload in attachments.",
  parameters: Schema.Struct({
    ticket,
    title: TicketPlanCreateInput.fields.title,
    body: TicketPlanCreateInput.fields.body.annotate({ description: "Markdown." }),
    attachments: planAttachments,
  }),
  success: PlanResult,
})
  .annotate(Tool.Title, "Create a ticket plan")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const TicketPlanUpdateTool = Tool.make("t3_ticket_plan_update", {
  ...shared,
  description:
    "Change a plan's title, body or status, and resolve the comments the change addresses, in one call. Omitted fields stay as they are. Prefer edits to a whole body: they cost fewer tokens and do not clobber concurrent edits. body and edits are mutually exclusive. A title, body or edits change fails without changing anything if the plan changed since expectedRevision: read it again and reapply. Images work as in t3_ticket_plan_create.",
  parameters: Schema.Struct({
    plan,
    expectedRevision: PositiveInt.annotate({
      description: "plan.revision from your latest t3_ticket_plan_get.",
    }),
    title: TicketPlanUpdateInput.fields.title,
    body: TicketPlanUpdateInput.fields.body.annotate({
      description: "Markdown; replaces the whole body.",
    }),
    edits: TicketPlanUpdateInput.fields.edits.annotate({
      description:
        "Find-and-replace edits applied in order. Each find must match exactly once in the body the earlier edits left; otherwise the call fails and names the edit.",
    }),
    status: Schema.optional(
      TicketPlanStatus.annotate({ description: "archived retires the plan; active restores it." }),
    ),
    resolveCommentIds: TicketPlanUpdateInput.fields.resolveCommentIds.annotate({
      description: "Top-level comments from t3_ticket_plan_get that this change addresses.",
    }),
    attachments: planAttachments,
  }),
  success: PlanResult,
})
  .annotate(Tool.Title, "Update a ticket plan")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const TicketPlanCommentTool = Tool.make("t3_ticket_plan_comment", {
  ...shared,
  description:
    "Comment on a plan, or reply to one of its comments with parentCommentId. To point at a passage, pass quote: text copied exactly from the Markdown body t3_ticket_plan_get returns, long enough to occur only once. Without a quote the comment is about the whole plan. Replies take no quote.",
  parameters: Schema.Struct({
    plan,
    body: TicketPlanCommentInput.fields.body.annotate({ description: "Markdown." }),
    parentCommentId: TicketPlanCommentInput.fields.parentCommentId,
    quote: Schema.optional(
      Schema.String.check(Schema.isMaxLength(8_000), Schema.isPattern(/\S/)).annotate({
        description: "Exact Markdown source text from the plan body that occurs only once.",
      }),
    ),
  }),
  success: TicketPlanComment,
})
  .annotate(Tool.Title, "Comment on a ticket plan")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const TicketsToolkit = Toolkit.make(
  TicketListTool,
  TicketGetTool,
  TicketCreateTool,
  TicketUpdateTool,
  TicketLinkTool,
  TicketUnlinkTool,
  TicketNoteTool,
  TicketPlanListTool,
  TicketPlanGetTool,
  TicketPlanCreateTool,
  TicketPlanUpdateTool,
  TicketPlanCommentTool,
);
