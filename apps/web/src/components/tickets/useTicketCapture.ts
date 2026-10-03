import type {
  AssistantCitation,
  ContextMenuItem,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import {
  type FileContextMenuAction,
  type FileContextMenuTarget,
  useFileContextMenu,
} from "../../fileContextMenu";
import { reviewCommentContextRecord } from "../../lib/composerContextRecords";
import { readLocalApi } from "../../localApi";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { useEnvironmentSupportsTickets } from "../../state/tickets";
import { openCreateTicketDialog } from "./CreateTicketDialog";
import type { TicketCaptureItem } from "./ticketCapture";

const CREATE_TICKET_MENU_ITEM = {
  id: "create-ticket",
  label: "Create ticket…",
  icon: "square-kanban",
  separatorBefore: true,
} as const satisfies ContextMenuItem;

interface TicketCaptureSource {
  readonly environmentId: EnvironmentId | null;
  /** The thread the capture comes from, which the drafted ticket links; null for a draft thread. */
  readonly sourceThreadId: ThreadId | null;
  readonly projectId: ProjectId | null;
}

/**
 * Opens the create-ticket dialog from one surface's captures. Null where the environment keeps no
 * tickets, so a surface shows no ticket action there.
 */
export function useTicketCapture(source: TicketCaptureSource) {
  const supported = useEnvironmentSupportsTickets(source.environmentId);
  const { environmentId, sourceThreadId, projectId } = source;
  return useMemo(() => {
    if (!supported || environmentId === null) return null;
    const open = (items: ReadonlyArray<TicketCaptureItem>) =>
      openCreateTicketDialog({ environmentId, sourceThreadId, projectId, items });
    return {
      quote: (citation: AssistantCitation) => open([{ type: "quote", citation }]),
      reviewComment: (comment: ReviewCommentContext) =>
        open([{ type: "context", record: reviewCommentContextRecord(comment) }]),
      fileMenuItems: [CREATE_TICKET_MENU_ITEM],
      activateFileMenuItem: (clicked: string, path: string) => {
        if (clicked !== CREATE_TICKET_MENU_ITEM.id) return false;
        open([{ type: "file", path }]);
        return true;
      },
    };
  }, [environmentId, projectId, sourceThreadId, supported]);
}

export function useFileContextMenuHandlerWithTicket(
  environmentId: EnvironmentId | null,
  ticketCapture: ReturnType<typeof useTicketCapture>,
) {
  const fileMenu = useFileContextMenu(environmentId);
  return useCallback(
    (target: FileContextMenuTarget, event?: { clientX: number; clientY: number }) => {
      const api = readLocalApi();
      if (!api) return;
      void api.contextMenu
        .show(
          [...fileMenu.buildItems(target), ...(ticketCapture?.fileMenuItems ?? [])],
          event ? { x: event.clientX, y: event.clientY } : undefined,
        )
        .then((clicked) => {
          if (clicked === null || ticketCapture?.activateFileMenuItem(clicked, target.filePath)) {
            return;
          }
          return fileMenu.activate(clicked as FileContextMenuAction, target);
        });
    },
    [fileMenu, ticketCapture],
  );
}
