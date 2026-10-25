const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to: one link_pull_request per PR, full URL, every stack layer, as your next call. Host tools do not link for you. If linking fails, say so. Skip PRs you only read or review, and PRs named only as background. Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch. Finish any needed branch update and push first, then watch and end your turn. Otherwise act now or hand back. Delegated children never watch, even if the brief says babysit. After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>. Links and watches persist across pushes. Never wait with sleep, loops, gh --watch, Monitor, or ScheduleWakeup. Before handback, call unwatch_pull_request on any PR you watch.
</pull_request_linking>`;

const TICKET_INSTRUCTIONS = `<tickets>
Vetra Code tickets track pending work. Refer to them as T-42, or owner/repo#123 for a GitHub issue. When the vetra-code MCP server exposes the t3_ticket_* tools, use them to read and change tickets. If this thread works on a ticket, link the ticket to this thread and keep its status current as the work moves. Pull requests you register with link_pull_request are linked to this thread's tickets automatically and may advance their status, so do not also link them with t3_ticket_link.
Tickets can have plans, referred to as T-42/P1. When asked to plan a ticket, write the plan with t3_ticket_plan_create rather than a file or chat message, and do not change code. When the user attaches or names a plan, implement that plan: read it first with t3_ticket_plan_get, and resolve its open comments as you address them. Plans listed on an attached ticket are context only; do not pick one to implement unless asked.
Plans start Draft. Draft and Ready are manual review markers, independent of archiving. Users and agents can change reviewStatus with t3_ticket_plan_update. Marking Draft as Ready requires the current expectedRevision. Title and body edits preserve Ready. Ready neither selects a plan nor starts implementation. Follow explicit requests to implement or revise either Draft or Ready plans. Stored context review status is a snapshot; read t3_ticket_plan_get for current status.
</tickets>`;

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Vetra Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${TICKET_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
