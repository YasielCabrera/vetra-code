import type { EnvironmentId, TicketAttachment } from "@t3tools/contracts";
import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskEdits";
import type { PlanSourceSpan } from "@t3tools/shared/ticketPlanAnchors";
import { memo, useState } from "react";

import ChatMarkdown, { type ChatMarkdownAttachmentReference } from "../ChatMarkdown";
import { TicketAttachmentReference } from "./ticketAttachments";

export type { PlanBlockKind } from "~/markdown/wordsHast";

export const PLAN_SOURCE_SELECTOR = "[data-plan-source-start]";

export function planSourceSpan(element: Element): PlanSourceSpan {
  return {
    start: Number(element.getAttribute("data-plan-source-start")),
    end: Number(element.getAttribute("data-plan-source-end")),
  };
}

function useSameAttachments(attachments: ReadonlyArray<TicketAttachment>) {
  const [kept, setKept] = useState(attachments);
  const same =
    kept.length === attachments.length &&
    kept.every((attachment, index) => attachment.id === attachments[index]!.id);
  if (!same) setKept(attachments);
  return same ? kept : attachments;
}

export const TicketMarkdownBody = memo(function TicketMarkdownBody(props: {
  readonly environmentId: EnvironmentId;
  readonly body: string;
  readonly attachments: ReadonlyArray<TicketAttachment>;
  /** Takes the body with a task list item toggled; without it, task lists are read-only. */
  readonly onBodyChange?: ((body: string) => void) | undefined;
  readonly sourcePositions?: boolean;
}) {
  const { environmentId, body, onBodyChange } = props;
  const attachments = useSameAttachments(props.attachments);
  const renderAttachment = (reference: ChatMarkdownAttachmentReference) => (
    <TicketAttachmentReference
      environmentId={environmentId}
      attachments={attachments}
      reference={reference}
    />
  );
  const onTaskListChange = ({
    markerOffset,
    checked,
  }: {
    markerOffset: number;
    checked: boolean;
  }) => onBodyChange?.(setMarkdownTaskChecked(body, markerOffset, checked));
  return (
    <ChatMarkdown
      allowLocalFileLinks={false}
      text={body}
      cwd={undefined}
      environmentId={environmentId}
      renderAttachmentReference={renderAttachment}
      onTaskListChange={onBodyChange === undefined ? undefined : onTaskListChange}
      {...(props.sourcePositions ? { sourcePositions: true } : {})}
    />
  );
});
