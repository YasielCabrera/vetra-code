import {
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  PositiveInt,
  ProjectId,
  ThreadId,
  TICKET_LINKS_MAX_COUNT,
  TicketCommentInput,
  TicketCreateInput,
  TicketDetail,
  TicketError,
  TicketGitHubRef,
  TicketLinkKind,
  TicketNotFoundError,
  TicketRevisionConflictError,
  TicketStatusCategory,
  TicketStatusDefinition,
  TicketStatusId,
  TicketSummary,
  TicketUpdateInput,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([
    McpCapabilityUnavailableError,
    OrchestratorMcpFailure,
    TicketNotFoundError,
    TicketRevisionConflictError,
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

export const TicketsToolkit = Toolkit.make(
  TicketListTool,
  TicketGetTool,
  TicketCreateTool,
  TicketUpdateTool,
  TicketLinkTool,
  TicketUnlinkTool,
  TicketNoteTool,
);
