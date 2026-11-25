import type { AgentFeedbackMode } from "@t3tools/contracts";

import type { ProviderAdapterV2RuntimePolicy } from "./ProviderAdapter.ts";

/** None while agent feedback is off, so users who never opt in pay no context for it. */
export const AGENT_FEEDBACK_INSTRUCTIONS = {
  off: "",
  "on-request": "Use `t3_feedback` only when the user asks you to send T3 feedback.",
  auto: "`t3_feedback` reports are wanted and cheap. Send one, then continue, when a Vetra Code tool or `vetra` command fails or gives a wrong result, the user corrects how you use Vetra Code, or a T3 capability you looked for is missing. Once per problem; also when the user asks. Only about Vetra Code, never the user's code or other tools.",
} satisfies Record<AgentFeedbackMode, string>;

/** Session-invariant; harnesses with a native system-prompt append can carry it once per session. */
export const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to: link_pull_request, or link_pull_requests for several, full URL, every stack layer, as your next call. Host tools don't link for you. If linking fails, say so. Skip PRs you only read or review and PRs named only as background. Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch. Finish any needed branch update and push first, then watch and end your turn. Otherwise act now or hand back. Delegated children never watch, even if the brief says babysit. After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>. Links and watches persist across pushes. For PR waits, no sleep, loops, gh --watch, Monitor or ScheduleWakeup. Before handback, call unwatch_pull_request on any PR you watch. When pull_request_* tools are listed, use them, not gh or cafe, to read, list, open, edit, review, reply on, close, or merge PRs, and ci_logs and ci_rerun for their checks. pull_request_create links for you.
If available, call link_issue for each issue you take on or file, even via CLI; skip issues you only read.
</pull_request_linking>`;

export const TICKET_INSTRUCTIONS = `<tickets>
Vetra Code tickets track pending work. Refer to them as T-42, or owner/repo#123 for a GitHub issue. When the vetra-code MCP server exposes the t3_ticket_* tools, use them to read and change tickets. If this thread works on a ticket, link the ticket to this thread and keep its status current as the work moves. Pull requests you register with link_pull_request are linked to this thread's tickets automatically and may advance their status, so do not also link them with t3_ticket_link.
Tickets can have plans, referred to as T-42/P1. When asked to plan a ticket, write the plan with t3_ticket_plan_create rather than a file or chat message, and do not change code. When the user attaches or names a plan, implement that plan: read it first with t3_ticket_plan_get, and resolve its open comments as you address them. Plans listed on an attached ticket are context only; do not pick one to implement unless asked.
Plans start Draft. Draft and Ready are manual review markers, independent of archiving. Users and agents can change reviewStatus with t3_ticket_plan_update. Marking Draft as Ready requires the current expectedRevision. Title and body edits preserve Ready. Ready neither selects a plan nor starts implementation. Follow explicit requests to implement or revise either Draft or Ready plans. Stored context review status is a snapshot; read t3_ticket_plan_get for current status.
</tickets>`;

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly agentFeedback?: AgentFeedbackMode;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** False when the session's system prompt already carries the linking instructions. */
  readonly pullRequestLinking?: boolean;
  /** Adds the folder list of a multi-folder thread. */
  readonly runtimePolicy?: Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace"> | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const runtimeInfo = `<runtime_info>In case you're asked: you are running in Vetra Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images, video, and audio using Markdown image syntax with absolute file paths. Link every other file you cite or produce by its absolute path, as in [http.ts:42](/abs/path/http.ts:42), so the user can open it in Vetra Code's files viewer.</runtime_info>`;
  const feedbackLine = AGENT_FEEDBACK_INSTRUCTIONS[runtime.agentFeedback ?? "off"];
  const feedback = feedbackLine ? `\n${feedbackLine}` : "";
  const workspace =
    runtime.runtimePolicy === undefined ? "" : buildWorkspaceInstructions(runtime.runtimePolicy);
  const linked =
    runtime.pullRequestLinking === false
      ? runtimeInfo
      : `${runtimeInfo}\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}`;
  return [linked + feedback, TICKET_INSTRUCTIONS, ...(workspace === "" ? [] : [workspace])].join(
    "\n\n",
  );
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

// Codex truncates context entries over 4,000 bytes, and this block is sent as its own entry.
const WORKSPACE_INSTRUCTIONS_MAX_BYTES = 3_600;
const FOLDER_NAME_MAX_LENGTH = 64;
// Control characters and Unicode line separators would let a name or path add lines.
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const textEncoder = new TextEncoder();

const byteLength = (value: string) => textEncoder.encode(value).length;

/** Names come from users and disk; keep each one a short label that cannot close the block. */
function folderLabel(name: string): string {
  const label = Array.from(
    name.replaceAll(LINE_BREAKING, " ").replaceAll(/[<>`]/g, " ").replaceAll(/\s+/g, " ").trim(),
  );
  if (label.length === 0) return "folder";
  return label.length > FOLDER_NAME_MAX_LENGTH
    ? `${label.slice(0, FOLDER_NAME_MAX_LENGTH - 1).join("")}…`
    : label.join("");
}

const folderPath = (value: string) =>
  value.replaceAll(LINE_BREAKING, "?").replaceAll("<", "‹").replaceAll(">", "›");

/** Lists a multi-folder thread's folders. Empty for single-folder threads, so their text is unchanged. */
export function buildWorkspaceInstructions(
  runtimePolicy: Pick<ProviderAdapterV2RuntimePolicy, "cwd" | "workspace">,
): string {
  const workspace = runtimePolicy.workspace;
  if (workspace === undefined || workspace.folders.length === 0) return "";
  const head = [
    "<workspace_folders>",
    "This project spans several folders. Each Git repository has its own history and branches: run Git commands inside the repository you change, and commit each one separately.",
    ...(runtimePolicy.cwd === null
      ? []
      : [`- Your working directory: ${folderPath(runtimePolicy.cwd)}`]),
  ];
  const tail = ["</workspace_folders>"];
  const entries = workspace.folders.map(
    (folder) =>
      `- ${folderLabel(folder.name)} (${folder.isGitRepository ? "Git repository" : "folder"}): ${folderPath(folder.path)}`,
  );
  // Reserve room for the line that counts folders left out.
  let budget = WORKSPACE_INSTRUCTIONS_MAX_BYTES - byteLength([...head, ...tail].join("\n")) - 32;
  const shown: Array<string> = [];
  for (const entry of entries) {
    budget -= byteLength(entry) + 1;
    if (budget < 0) break;
    shown.push(entry);
  }
  const hidden = entries.length - shown.length;
  return [...head, ...shown, ...(hidden > 0 ? [`- Not listed: ${hidden} more`] : []), ...tail].join(
    "\n",
  );
}
