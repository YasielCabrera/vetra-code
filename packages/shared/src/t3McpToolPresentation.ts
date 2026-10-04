export type T3McpToolLogo = "vetra-code";

export interface T3McpToolPresentation {
  readonly displayName: string;
  readonly logo: T3McpToolLogo;
}

export type T3McpToolSummaryAction =
  | "capabilities"
  | "delegate"
  | "task-status"
  | "task-cancel"
  | "schedule-run"
  | "schedule-create"
  | "schedule-list"
  | "schedule-update"
  | "schedule-delete"
  | "thread-create"
  | "thread-list"
  | "thread-read"
  | "thread-send"
  | "thread-wait"
  | "thread-interrupt"
  | "thread-configuration"
  | "thread-configure"
  | "thread-fork"
  | "thread-merge"
  | "thread-search"
  | "thread-transfers"
  | "thread-organize"
  | "thread-update"
  | "queue-list"
  | "queue-read"
  | "queue-edit"
  | "queue-cancel"
  | "queue-reorder"
  | "queue-steer"
  | "question-list"
  | "question-read"
  | "question-respond"
  | "worktree-handoff"
  | "worktree-list"
  | "worktree-status"
  | "project-list"
  | "project-read"
  | "project-create"
  | "project-update"
  | "project-delete"
  | "project-clone"
  | "environment-read"
  | "environment-update"
  | "attachment-prepare"
  | "attachment-discard"
  | "attachment-send"
  | "link-pr"
  | "unlink-pr"
  | "list-prs"
  | "ticket-list"
  | "ticket-read"
  | "ticket-create"
  | "ticket-update"
  | "ticket-link"
  | "ticket-unlink"
  | "ticket-note"
  | "ticket-plan-list"
  | "ticket-plan-read"
  | "ticket-plan-create"
  | "ticket-plan-update"
  | "ticket-plan-comment"
  | "browser"
  | "device";

export interface T3McpToolDefinition {
  readonly displayName: string;
  readonly labels: readonly [action: string, running: string, completed: string, detail: string];
  readonly icon: "vetra-code" | "browser" | "device" | "pull-request";
  readonly summaryAction: T3McpToolSummaryAction;
}

function tool(
  labels: T3McpToolDefinition["labels"],
  summaryAction: T3McpToolSummaryAction,
  icon: T3McpToolDefinition["icon"] = "vetra-code",
  displayName = `${labels[0]} ${labels[3]}`,
): T3McpToolDefinition {
  return { displayName, labels, icon, summaryAction };
}

const VETRA_MCP_SERVER_ALIASES = new Set(["vetra-code", "vetra_code", "vetracode"]);

// Cards, activity rows, summaries, and provider identity recovery share this inventory.
const VETRA_MCP_TOOLS: Readonly<Record<string, T3McpToolDefinition>> = {
  link_pull_request: tool(
    ["Link", "Linking", "Linked", "a pull request"],
    "link-pr",
    "pull-request",
  ),
  unlink_pull_request: tool(
    ["Unlink", "Unlinking", "Unlinked", "a pull request"],
    "unlink-pr",
    "pull-request",
  ),
  list_thread_pull_requests: tool(
    ["Check", "Checking", "Checked", "linked pull requests"],
    "list-prs",
    "pull-request",
  ),
  orchestrator_capabilities: tool(
    ["Get", "Getting", "Got", "orchestration capabilities"],
    "capabilities",
  ),
  delegate_task: tool(["Delegate", "Delegating", "Delegated", "a child task"], "delegate"),
  task_status: tool(["Get", "Getting", "Got", "delegated task status"], "task-status"),
  task_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "delegated task"],
    "task-cancel",
  ),
  schedule_task: tool(
    ["Schedule", "Scheduling", "Scheduled", "a recurring task"],
    "schedule-create",
  ),
  list_scheduled_tasks: tool(["List", "Listing", "Listed", "scheduled tasks"], "schedule-list"),
  update_scheduled_task: tool(
    ["Update", "Updating", "Updated", "a scheduled task"],
    "schedule-update",
  ),
  delete_scheduled_task: tool(
    ["Delete", "Deleting", "Requested deletion of", "a scheduled task"],
    "schedule-delete",
  ),
  create_threads: tool(["Create", "Creating", "Created", "Vetra Code threads"], "thread-create"),
  t3_thread_start: tool(["Start", "Starting", "Started", "a Vetra Code thread"], "thread-create"),
  t3_thread_list: tool(["List", "Listing", "Listed", "Vetra Code threads"], "thread-list"),
  t3_thread_read: tool(["Read", "Reading", "Read", "a Vetra Code thread"], "thread-read"),
  t3_thread_send: tool(["Send", "Sending", "Sent", "to a Vetra Code thread"], "thread-send"),
  t3_thread_wait: tool(["Wait", "Waiting", "Waited", "for a Vetra Code thread"], "thread-wait"),
  t3_thread_interrupt: tool(
    ["Interrupt", "Interrupting", "Requested an interrupt of", "a Vetra Code thread"],
    "thread-interrupt",
  ),
  t3_worktree_handoff: tool(
    ["Hand off", "Handing off", "Handed off", "thread to a git worktree"],
    "worktree-handoff",
  ),
  t3_worktree_status: tool(["Get", "Getting", "Got", "thread worktree status"], "worktree-status"),
  preview_status: tool(["Get", "Getting", "Got", "preview browser status"], "browser", "browser"),
  preview_open: tool(
    ["Open", "Opening", "Opened", "a page in the preview browser"],
    "browser",
    "browser",
  ),
  preview_navigate: tool(
    ["Navigate", "Navigating", "Navigated", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_snapshot: tool(
    ["Take a snapshot of", "Taking a snapshot of", "Took a snapshot of", "the preview page"],
    "browser",
    "browser",
    "Snapshot the preview page",
  ),
  preview_click: tool(
    ["Click", "Clicking", "Clicked", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_press: tool(
    ["Press", "Pressing", "Pressed", "a key in the preview browser"],
    "browser",
    "browser",
  ),
  preview_type: tool(["Type", "Typing", "Typed", "in the preview browser"], "browser", "browser"),
  preview_scroll: tool(
    ["Scroll", "Scrolling", "Scrolled", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_resize: tool(
    ["Resize", "Resizing", "Resized", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_evaluate: tool(
    ["Evaluate", "Evaluating", "Evaluated", "script in the preview browser"],
    "browser",
    "browser",
  ),
  preview_wait_for: tool(
    ["Wait", "Waiting", "Waited", "for the preview page"],
    "browser",
    "browser",
  ),
  preview_set_appearance: tool(
    ["Set", "Setting", "Set", "preview browser appearance"],
    "browser",
    "browser",
  ),
  preview_recording_start: tool(
    ["Start", "Starting", "Started", "recording the preview browser"],
    "browser",
    "browser",
  ),
  preview_recording_stop: tool(
    ["Stop", "Stopping", "Stopped", "recording the preview browser"],
    "browser",
    "browser",
  ),
  device_list: tool(["List", "Listing", "Listed", "simulators and emulators"], "device", "device"),
  device_open: tool(
    ["Open", "Opening", "Opened", "a device in the Device panel"],
    "device",
    "device",
  ),
  device_screenshot: tool(
    ["Take a screenshot of", "Taking a screenshot of", "Took a screenshot of", "the device"],
    "device",
    "device",
  ),
  device_close: tool(["Close", "Closing", "Closed", "a device"], "device", "device"),
  run_scheduled_task_now: tool(
    ["Run", "Running", "Requested a run of", "a scheduled task"],
    "schedule-run",
  ),
  t3_queue_list: tool(["List", "Listing", "Listed", "queued messages"], "queue-list"),
  t3_queue_read: tool(["Read", "Reading", "Read", "a queued message"], "queue-read"),
  t3_queue_edit: tool(["Edit", "Editing", "Edited", "a queued message"], "queue-edit"),
  t3_queue_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a queued run"],
    "queue-cancel",
  ),
  t3_queue_reorder: tool(["Reorder", "Reordering", "Reordered", "a queued run"], "queue-reorder"),
  t3_queue_promote_to_steer: tool(
    ["Steer with", "Steering with", "Requested steering with", "a queued message"],
    "queue-steer",
  ),
  t3_pending_request_list: tool(
    ["List", "Listing", "Listed", "pending questions"],
    "question-list",
  ),
  t3_pending_request_read: tool(["Read", "Reading", "Read", "pending questions"], "question-read"),
  t3_pending_request_respond: tool(
    ["Answer", "Answering", "Answered", "pending questions"],
    "question-respond",
  ),
  t3_thread_configuration: tool(
    ["Read", "Reading", "Read", "thread configuration"],
    "thread-configuration",
  ),
  t3_thread_configure: tool(["Set", "Setting", "Set", "thread model"], "thread-configure"),
  t3_thread_fork: tool(["Fork", "Forking", "Requested a fork of", "this thread"], "thread-fork"),
  t3_thread_merge_back: tool(
    ["Merge", "Merging", "Requested a merge of", "thread context"],
    "thread-merge",
  ),
  t3_thread_search: tool(["Search", "Searching", "Searched", "thread content"], "thread-search"),
  t3_thread_transfers: tool(["Read", "Reading", "Read", "thread transfers"], "thread-transfers"),
  t3_thread_organize: tool(["Organize", "Organizing", "Organized", "a thread"], "thread-organize"),
  t3_thread_update: tool(
    ["Update", "Updating", "Updated", "Vetra Code thread metadata"],
    "thread-update",
  ),
  t3_worktree_list: tool(["List", "Listing", "Listed", "workspace branches"], "worktree-list"),
  t3_preview_list: tool(["List", "Listing", "Listed", "preview tabs"], "browser", "browser"),
  t3_preview_close: tool(["Close", "Closing", "Closed", "a preview tab"], "browser", "browser"),
  t3_environment_read: tool(
    ["Read", "Reading", "Read", "environment preferences"],
    "environment-read",
  ),
  t3_environment_preferences_update: tool(
    ["Update", "Updating", "Updated", "environment preferences"],
    "environment-update",
  ),
  t3_thread_launch: tool(["Launch", "Launching", "Launched", "a project thread"], "thread-create"),
  t3_project_list: tool(["List", "Listing", "Listed", "projects"], "project-list"),
  t3_project_read: tool(["Read", "Reading", "Read", "a project"], "project-read"),
  t3_project_create: tool(["Register", "Registering", "Registered", "a project"], "project-create"),
  t3_project_update: tool(["Update", "Updating", "Updated", "a project"], "project-update"),
  t3_project_delete: tool(["Delete", "Deleting", "Deleted", "a project"], "project-delete"),
  t3_project_clone: tool(["Clone", "Cloning", "Cloned", "a repository"], "project-clone"),
  t3_attachment_prepare_upload: tool(
    ["Prepare", "Preparing", "Prepared", "an attachment upload"],
    "attachment-prepare",
  ),
  t3_attachment_discard: tool(
    ["Discard", "Discarding", "Discarded", "a pending attachment"],
    "attachment-discard",
  ),
  t3_thread_send_attachments: tool(["Send", "Sending", "Sent", "attachments"], "attachment-send"),
  t3_ticket_list: tool(["List", "Listing", "Listed", "tickets"], "ticket-list"),
  t3_ticket_get: tool(["Read", "Reading", "Read", "a ticket"], "ticket-read"),
  t3_ticket_create: tool(["Create", "Creating", "Created", "a ticket"], "ticket-create"),
  t3_ticket_update: tool(["Update", "Updating", "Updated", "a ticket"], "ticket-update"),
  t3_ticket_link: tool(["Link", "Linking", "Linked", "a ticket"], "ticket-link"),
  t3_ticket_unlink: tool(["Unlink", "Unlinking", "Unlinked", "a ticket"], "ticket-unlink"),
  t3_ticket_note: tool(["Add", "Adding", "Added", "a ticket note"], "ticket-note"),
  t3_ticket_plan_list: tool(["List", "Listing", "Listed", "ticket plans"], "ticket-plan-list"),
  t3_ticket_plan_get: tool(["Read", "Reading", "Read", "a ticket plan"], "ticket-plan-read"),
  t3_ticket_plan_create: tool(
    ["Create", "Creating", "Created", "a ticket plan"],
    "ticket-plan-create",
  ),
  t3_ticket_plan_update: tool(
    ["Update", "Updating", "Updated", "a ticket plan"],
    "ticket-plan-update",
  ),
  t3_ticket_plan_comment: tool(
    ["Comment on", "Commenting on", "Commented on", "a ticket plan"],
    "ticket-plan-comment",
  ),
};

/**
 * The Vetra Code orchestration tool inventory, used to gate loose name matching on
 * both the server (ACP MCP identity recovery) and the client (logo branding).
 */
export const VETRA_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(VETRA_MCP_TOOLS));

function normalizeT3McpToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

/**
 * ACP agents disagree on how the injected T3 server prefixes its tools:
 * `mcp__vetra-code__x` (Claude/Cursor), `vetra-code.x` (Codex), plus single
 * underscore, colon, slash, dash, and space separators seen from registry
 * agents. The prefix match is deliberately loose because the display-name
 * inventory is the real gate; unknown tools stay on the generic renderer.
 */
function resolveT3McpToolName(value: string): string | null {
  const label = normalizeT3McpToolLabel(value);
  const mcpMatch = /^mcp__(?<server>.+?)__(?<tool>.+)$/i.exec(label);
  if (mcpMatch?.groups) {
    const { server, tool } = mcpMatch.groups;
    return server !== undefined &&
      tool !== undefined &&
      VETRA_MCP_SERVER_ALIASES.has(server.toLowerCase())
      ? tool
      : null;
  }

  const namespaceMatch =
    /^(?<server>vetra-code|vetra_code|vetracode)(?:[.:/]|\s*·\s*)(?<tool>.+)$/i.exec(label);
  if (namespaceMatch?.groups) {
    return namespaceMatch.groups.tool ?? null;
  }

  const prefixed = /^(?:mcp[-_]{1,2})?vetra[-_ ]?code(?:__|[-_.:/ ])(?<tool>.+)$/i.exec(label);
  const candidate = prefixed?.groups?.tool ?? label;
  return Object.hasOwn(VETRA_MCP_TOOLS, candidate) ? candidate : null;
}

export function resolveT3McpToolDefinition(
  toolName: string | null | undefined,
): T3McpToolDefinition | null {
  const name = toolName == null ? null : resolveT3McpToolName(toolName);
  return name !== null && Object.hasOwn(VETRA_MCP_TOOLS, name) ? VETRA_MCP_TOOLS[name]! : null;
}

export function resolveT3McpToolPresentation(
  toolName: string | null | undefined,
): T3McpToolPresentation | null {
  const definition = resolveT3McpToolDefinition(toolName);
  return definition === null ? null : { displayName: definition.displayName, logo: "vetra-code" };
}

export function resolveT3McpToolSummaryAction(
  toolName: string | null | undefined,
): T3McpToolSummaryAction | null {
  return resolveT3McpToolDefinition(toolName)?.summaryAction ?? null;
}
