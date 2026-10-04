import type { EnvironmentId, TicketAttachment } from "@t3tools/contracts";
import { memo, useCallback, useState } from "react";

import ChatMarkdown, { type ChatMarkdownAttachmentReference } from "../ChatMarkdown";
import { setMarkdownTaskChecked } from "../files/filePreviewMode";
import { TicketAttachmentReference } from "./ticketAttachments";

type PlanHastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: PlanHastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** What a top-level block with its own comment button holds. */
export type PlanBlockKind = "diagram" | "code" | "image";

function planBlockKind(node: PlanHastNode): PlanBlockKind | undefined {
  if (node.tagName === "pre") {
    const code = node.children?.find((child) => child.tagName === "code");
    const className = code?.properties?.className;
    return Array.isArray(className) && className.includes("language-mermaid") ? "diagram" : "code";
  }
  const hasStandaloneImage = (parent: PlanHastNode): boolean =>
    parent.children?.some((child) =>
      child.tagName === "img"
        ? child.properties?.dataStandalone === true
        : hasStandaloneImage(child),
    ) ?? false;
  return node.tagName === "p" && hasStandaloneImage(node) ? "image" : undefined;
}

/**
 * Marks each top-level block with `data-plan-source-start` and `data-plan-source-end`, its offsets
 * into the body, so a selection maps back to the Markdown it came from. Diagrams, code blocks and
 * images also get `data-plan-block` with their kind.
 */
function rehypePlanSourcePositions() {
  return (tree: PlanHastNode) => {
    for (const node of tree.children ?? []) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (node.type !== "element" || start === undefined || end === undefined) continue;
      node.properties = {
        ...node.properties,
        dataPlanSourceStart: start,
        dataPlanSourceEnd: end,
        dataPlanBlock: planBlockKind(node),
      };
    }
  };
}

const PLAN_REHYPE_PLUGINS = [rehypePlanSourcePositions];

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
      extraRehypePlugins={PLAN_REHYPE_PLUGINS}
    />
  );
});
