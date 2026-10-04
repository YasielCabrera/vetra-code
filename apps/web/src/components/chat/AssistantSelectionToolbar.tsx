import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { QuoteIcon, SquareKanbanIcon } from "lucide-react";
import { useCallback } from "react";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { SelectionActionToolbar } from "../SelectionActionToolbar";

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
  onCreateTicket,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onCreateTicket?: ((citation: AssistantCitation) => void) | undefined;
}) {
  const capture = useCallback(
    (selection: Selection | null, viewport: HTMLElement) => {
      const captured = captureAssistantTextSelection(viewport, selection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) return null;
      const citation: AssistantCitation = {
        version: 1,
        ...threadRef,
        messageId: MessageId.make(messageId),
        ...captured.selector,
      };
      const sourceAnchor: AssistantCitationSourceAnchor = {
        source: captured.source,
        range: captured.range,
        viewport,
      };
      return { range: captured.range, citation, sourceAnchor };
    },
    [threadRef],
  );

  return (
    <SelectionActionToolbar
      viewport={viewport}
      capture={capture}
      actions={({ citation, sourceAnchor }) => {
        const tooLong = citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
        return [
          {
            label: tooLong ? "Shorten selection" : "Cite",
            ariaLabel: tooLong ? "Selection is too long to cite" : "Cite selection in composer",
            icon: QuoteIcon,
            disabled: tooLong,
            run: () => !tooLong && onCite(citation, sourceAnchor),
          },
          ...(onCreateTicket && !tooLong
            ? [
                {
                  label: "Create ticket",
                  ariaLabel: "Create a ticket from the selection",
                  icon: SquareKanbanIcon,
                  run: () => {
                    onCreateTicket(citation);
                    return true;
                  },
                },
              ]
            : []),
        ];
      }}
    />
  );
}
