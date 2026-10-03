import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  AssistantCitation,
  EnvironmentId,
  OrchestrationMessageContext,
  ProjectId,
  ReviewCommentContextRecord,
  RunId,
  ThreadContextRecord,
  ThreadId,
  TicketSummary,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import { threadContextRecord } from "../../lib/composerContextRecords";
import { formatReviewCommentFence } from "../../reviewCommentContext";
import { isLatestRunSettled } from "../../session-logic";

export type TicketCaptureItem =
  | { readonly type: "quote"; readonly citation: AssistantCitation }
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "context"; readonly record: ThreadContextRecord | ReviewCommentContextRecord };

export interface TicketCapture {
  readonly environmentId: EnvironmentId;
  /** The thread the selection came from; the drafted ticket links it. */
  readonly sourceThreadId: ThreadId | null;
  /** The project to prefill; the dialog falls back to the source thread's. */
  readonly projectId: ProjectId | null;
  readonly items: ReadonlyArray<TicketCaptureItem>;
}

/** The whole thread as a capture; the analyzer reads its history with `t3_thread_read`. */
export function threadTicketCapture(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
}): TicketCapture {
  return {
    environmentId: thread.environmentId,
    sourceThreadId: thread.id,
    projectId: thread.projectId,
    items: [
      {
        type: "context",
        record: threadContextRecord(
          { environmentId: thread.environmentId, threadId: thread.id },
          thread.title,
        ),
      },
    ],
  };
}

function itemText(item: TicketCaptureItem): string {
  switch (item.type) {
    case "quote":
      return serializeAssistantCitation(item.citation);
    case "file":
      return serializeComposerFileLink(item.path);
    case "context":
      return formatComposerContextReference(item.record);
  }
}

/** The capture as the analyzer's message carries it: inline references plus their records. */
export function ticketCaptureSelection(items: ReadonlyArray<TicketCaptureItem>): {
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
} {
  const records = items.flatMap((item) => (item.type === "context" ? [item.record] : []));
  return {
    text: items.map(itemText).join("\n\n"),
    ...(records.length === 0 ? {} : { context: { version: 1, records } }),
  };
}

function itemMarkdown(item: TicketCaptureItem): string | null {
  switch (item.type) {
    case "quote":
      return [
        item.citation.text
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
        ...(item.citation.comment?.trim() ? [item.citation.comment.trim()] : []),
      ].join("\n\n");
    case "file":
      return `\`${item.path}\``;
    case "context": {
      const { record } = item;
      if (record.kind === "thread") return null;
      return [
        `\`${record.filePath}\` ${record.rangeLabel}`,
        formatReviewCommentFence(record.fenceLanguage ?? "diff", record.diff),
        ...(record.text.trim() ? [record.text.trim()] : []),
      ].join("\n\n");
    }
  }
}

/** The capture as a hand-written ticket body: quotes as blockquotes, code as fenced blocks. */
export function ticketCaptureMarkdown(items: ReadonlyArray<TicketCaptureItem>): string {
  return items.flatMap((item) => itemMarkdown(item) ?? []).join("\n\n");
}

export type TicketDraftAnalyzer =
  | { readonly type: "loading" }
  | { readonly type: "removed" }
  | {
      readonly type: "present";
      readonly shell: Pick<EnvironmentThreadShell, "latestRun" | "runtime">;
    };

/** Settlement alone cannot prove absence: ticket deltas may still be queued on the server. */
export function draftOutcome<T extends Pick<TicketSummary, "createdBy">>(
  tickets: ReadonlyArray<T>,
  threadId: ThreadId,
  analyzer: TicketDraftAnalyzer,
  confirmedTickets: ReadonlyArray<T> | null = null,
):
  | { readonly type: "filed"; readonly ticket: T }
  | { readonly type: "confirming"; readonly runId: RunId }
  | { readonly type: "abandoned" }
  | { readonly type: "removed" }
  | null {
  if (analyzer.type === "removed") return { type: "removed" };
  const filedByAnalyzer = (candidate: T) =>
    candidate.createdBy.type === "agent" && candidate.createdBy.threadId === threadId;
  const ticket = tickets.find(filedByAnalyzer) ?? confirmedTickets?.find(filedByAnalyzer);
  if (ticket !== undefined) return { type: "filed", ticket };
  if (analyzer.type !== "present") return null;
  const { latestRun, runtime } = analyzer.shell;
  if (latestRun === null || !isLatestRunSettled(latestRun, runtime)) return null;
  return confirmedTickets === null
    ? { type: "confirming", runId: latestRun.runId }
    : { type: "abandoned" };
}
