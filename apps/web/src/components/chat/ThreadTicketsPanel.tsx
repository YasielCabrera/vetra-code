import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { Unlink2Icon } from "lucide-react";
import { useState } from "react";

import { useTicketActions } from "~/hooks/useTicketActions";
import { useTicketStatuses, useTicketsForThread } from "~/state/tickets";
import { TicketStatusMark } from "../tickets/TicketListRow";
import { formatTicketRef } from "../tickets/ticketRefs";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/**
 * Thread details panel section listing the tickets linked to this thread,
 * collapsed until opened. Rows open the ticket; unlinking only removes the
 * thread link and offers an undo. Renders nothing when no ticket links the thread.
 */
export function ThreadTicketsPanel(props: { readonly threadRef: ScopedThreadRef }) {
  const tickets = useTicketsForThread(props.threadRef);
  const statuses = useTicketStatuses(props.threadRef.environmentId)?.statuses;
  const { link, unlink } = useTicketActions();
  const [expanded, setExpanded] = useState(false);
  if (tickets.length === 0) return null;

  const unlinkTicket = async (ticket: EnvironmentTicket) => {
    const ticketRef = { environmentId: ticket.environmentId, ticketId: ticket.id };
    if ((await unlink(ticketRef, "thread", props.threadRef.threadId)) === null) return;
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Unlinked ${formatTicketRef(ticket)}`,
        description: ticket.title,
        timeout: 8_000,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            void link(ticketRef, { kind: "thread", threadId: props.threadRef.threadId });
          },
        },
      }),
    );
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-tickets-heading"
      title={`Tickets · ${tickets.length}`}
      data-thread-tickets-panel
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      {/* Bounded like Lineage so a long ticket list cannot push later sections out of view. */}
      <ul
        aria-label="Linked tickets"
        className="m-0 max-h-[11rem] list-none overflow-y-auto overscroll-contain p-0"
      >
        {tickets.map((ticket) => {
          const reference = formatTicketRef(ticket);
          const status = statuses?.find((candidate) => candidate.id === ticket.statusId);
          return (
            <li key={ticket.id} className="group relative flex h-8 items-center">
              <Tooltip>
                <TooltipTrigger
                  delay={300}
                  render={
                    <ThreadDetailsControl
                      size="sm"
                      variant="ghost"
                      part="row"
                      className="pe-8"
                      aria-label={`Open ticket ${reference}, ${ticket.title}`}
                      render={
                        <Link
                          to="/tickets/$ticketKey"
                          params={{
                            ticketKey: ticketKey({
                              environmentId: ticket.environmentId,
                              ticketId: ticket.id,
                            }),
                          }}
                        />
                      }
                    />
                  }
                >
                  <TicketStatusMark status={status} />
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                    {reference}
                  </span>
                  <span
                    className={
                      status?.category === "closed"
                        ? "min-w-0 flex-1 truncate text-muted-foreground"
                        : "min-w-0 flex-1 truncate"
                    }
                  >
                    {ticket.title}
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="left">
                  {status ? `${ticket.title} · ${status.name}` : ticket.title}
                </TooltipPopup>
              </Tooltip>
              <span className="absolute end-1 flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ThreadDetailsControl
                        size="icon-xs"
                        variant="ghost"
                        part="icon"
                        aria-label={`Unlink ${reference} from this thread`}
                        onClick={() => void unlinkTicket(ticket)}
                      >
                        <Unlink2Icon className="size-3.5 text-muted-foreground" />
                      </ThreadDetailsControl>
                    }
                  />
                  <TooltipPopup side="top">Unlink from this thread</TooltipPopup>
                </Tooltip>
              </span>
            </li>
          );
        })}
      </ul>
    </ThreadDetailsSection>
  );
}
