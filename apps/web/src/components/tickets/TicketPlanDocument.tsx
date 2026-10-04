import type { EnvironmentId, TicketAttachment } from "@t3tools/contracts";
import { memo, useCallback, useState } from "react";

import ChatMarkdown, { type ChatMarkdownAttachmentReference } from "../ChatMarkdown";
import { setMarkdownTaskChecked } from "../files/filePreviewMode";
import { TicketAttachmentReference } from "./ticketAttachments";

/**
 * Keeps the last array while it lists the same attachments, which never change once uploaded,
 * so a plan push that changes only comments does not render the Markdown again.
 */
function useSameAttachments(attachments: ReadonlyArray<TicketAttachment>) {
  const [kept, setKept] = useState(attachments);
  const same =
    kept.length === attachments.length &&
    kept.every((attachment, index) => attachment.id === attachments[index]!.id);
  if (!same) setKept(attachments);
  return same ? kept : attachments;
}

/** A plan body as the preview and the plan page draw it. */
export const TicketPlanDocument = memo(function TicketPlanDocument(props: {
  readonly environmentId: EnvironmentId;
  readonly body: string;
  /** What `vetra-attachment://` references in the body resolve against. */
  readonly attachments: ReadonlyArray<TicketAttachment>;
  /** Takes the body with a task list item toggled; without it, task lists are read-only. */
  readonly onBodyChange?: ((body: string) => void) | undefined;
}) {
  const { environmentId, body, onBodyChange } = props;
  const attachments = useSameAttachments(props.attachments);
  const renderAttachment = useCallback(
    (reference: ChatMarkdownAttachmentReference) => (
      <TicketAttachmentReference
        environmentId={environmentId}
        attachments={attachments}
        reference={reference}
      />
    ),
    [attachments, environmentId],
  );
  const onTaskListChange = useCallback(
    ({ markerOffset, checked }: { markerOffset: number; checked: boolean }) =>
      onBodyChange?.(setMarkdownTaskChecked(body, markerOffset, checked)),
    [body, onBodyChange],
  );
  return (
    <ChatMarkdown
      allowLocalFileLinks={false}
      text={body}
      cwd={undefined}
      environmentId={environmentId}
      renderAttachmentReference={renderAttachment}
      onTaskListChange={onBodyChange === undefined ? undefined : onTaskListChange}
    />
  );
});
