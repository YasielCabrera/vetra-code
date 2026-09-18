import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, IssueDetail } from "@t3tools/contracts";
import { BookOpenIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";

import { MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { buildAttachIssueHandoff, buildExplainIssueHandoff } from "./issueHandoff.logic";

type IssueHandoffKind = "attach" | "explain";

export function IssueHandoffMenuItems({
  detail,
  environmentId,
}: {
  readonly detail: IssueDetail;
  readonly environmentId: EnvironmentId;
}) {
  const newThread = useNewThreadHandler();
  const [pending, setPending] = useState<IssueHandoffKind | null>(null);

  const startHandoff = async (kind: IssueHandoffKind) => {
    if (pending !== null) return;
    setPending(kind);
    try {
      const opened = await newThread(scopeProjectRef(environmentId, detail.projectId));
      if (opened === null) {
        toastManager.add({
          type: "error",
          title: "Could not open a thread",
          description: "Try again, or open a new thread from the project first.",
        });
        return;
      }

      const handoff =
        kind === "explain" ? buildExplainIssueHandoff(detail) : buildAttachIssueHandoff(detail);
      const store = useComposerDraftStore.getState();
      store.setPrompt(opened.draftId, handoff.prompt);
      store.setReviewComments(opened.draftId, handoff.reviewComments);
      toastManager.add({
        type: "success",
        title: kind === "explain" ? "Issue ready to explain" : "Issue attached",
        description:
          kind === "explain"
            ? "The request and issue context are in the composer — read them over, then send."
            : "The issue is in the composer — add your request, then send.",
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again, or open a new thread from the project first.",
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <MenuItem disabled={pending !== null} onClick={() => void startHandoff("attach")}>
        <MessageCircleQuestionIcon className="mt-0.5 size-3.5 shrink-0 self-start" />
        <span className="flex min-w-0 flex-col">
          <span>{pending === "attach" ? "Opening..." : "Attach to new thread"}</span>
          <span className="text-xs text-muted-foreground">
            Opens a thread that knows which issue you mean.
          </span>
        </span>
      </MenuItem>
      <MenuItem disabled={pending !== null} onClick={() => void startHandoff("explain")}>
        <BookOpenIcon className="mt-0.5 size-3.5 shrink-0 self-start" />
        <span className="flex min-w-0 flex-col">
          <span>{pending === "explain" ? "Opening..." : "Explain this issue"}</span>
          <span className="text-xs text-muted-foreground">
            A guided read of the issue and the relevant code.
          </span>
        </span>
      </MenuItem>
    </>
  );
}
