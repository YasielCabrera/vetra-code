import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
import type { PlanSourceSpan } from "@t3tools/shared/ticketPlanAnchors";
import { MessageSquarePlusIcon } from "lucide-react";
import { type RefObject, useCallback, useLayoutEffect, useState } from "react";

import { captureAssistantTextSelection } from "../../lib/assistantTextSelection";
import { SelectionActionToolbar } from "../SelectionActionToolbar";
import { PLAN_SOURCE_SELECTOR, planSourceSpan } from "./TicketMarkdownBody";

const DOCUMENT_SELECTOR = "[data-plan-document]";

function blockOf(node: Node, after: boolean): Element | null {
  const block = (node instanceof Element ? node : node.parentElement)?.closest(
    PLAN_SOURCE_SELECTOR,
  );
  if (block) return block;
  // A triple-click ends on the line break react-markdown leaves after the paragraph.
  const next = (sibling: Node) => (after ? sibling.nextSibling : sibling.previousSibling);
  for (let sibling = next(node); sibling !== null; sibling = next(sibling)) {
    if (!(sibling instanceof Element)) continue;
    return sibling.matches(PLAN_SOURCE_SELECTOR)
      ? sibling
      : sibling.querySelector(PLAN_SOURCE_SELECTOR);
  }
  return null;
}

function selectionSpan(range: Range): PlanSourceSpan | null {
  const first = blockOf(range.startContainer, true);
  const last = blockOf(range.endContainer, false);
  if (!first || !last) return null;
  const from = planSourceSpan(first);
  const to = planSourceSpan(last);
  return {
    start: Math.min(from.start, to.start),
    end: Math.max(from.end, to.end),
  };
}

type PlanSelection = NonNullable<ReturnType<typeof captureAssistantTextSelection>> & {
  readonly span: PlanSourceSpan;
};

export function TicketPlanSelectionComment(props: {
  readonly documentRef: RefObject<HTMLDivElement | null>;
  readonly onComment: (selection: PlanSelection) => void;
}) {
  const { documentRef, onComment } = props;
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = documentRef.current;
    const scrollViewport =
      root === null
        ? null
        : (root.closest<HTMLElement>("[data-slot=scroll-area-viewport]") ??
          root.parentElement ??
          root);
    setViewport(scrollViewport);
  }, [documentRef]);
  const capture = useCallback(
    (selection: Selection | null): PlanSelection | null => {
      const root = documentRef.current;
      const captured =
        root === null ? null : captureAssistantTextSelection(root, selection, DOCUMENT_SELECTOR);
      const span = captured === null ? null : selectionSpan(captured.range);
      return captured === null || span === null ? null : { ...captured, span };
    },
    [documentRef],
  );

  return (
    <SelectionActionToolbar
      viewport={viewport}
      capture={capture}
      actions={(selection) => {
        const tooLong = selection.selector.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
        return [
          {
            label: tooLong ? "Shorten selection" : "Comment",
            ariaLabel: tooLong ? "Selection is too long to comment on" : "Comment on the selection",
            icon: MessageSquarePlusIcon,
            disabled: tooLong,
            run: () => {
              if (tooLong) return false;
              onComment(selection);
              return true;
            },
          },
        ];
      }}
    />
  );
}
