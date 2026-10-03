import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { TicketContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { SquareKanbanIcon } from "lucide-react";

import { useTicket } from "~/state/tickets";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function TicketContextChip(props: {
  record: Pick<TicketContextRecord, "environmentId" | "ticketId" | "ref" | "title">;
  copyMarkdown?: string;
}) {
  const { environmentId, ticketId } = props.record;
  const ticket = useTicket({ environmentId, ticketId });
  const title = ticket?.title ?? props.record.title;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="ticket"
            render={
              <Link
                to="/tickets/$ticketKey"
                params={{ ticketKey: ticketKey({ environmentId, ticketId }) }}
              />
            }
            aria-label={`Ticket ${props.record.ref}, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
          >
            <SquareKanbanIcon />
            <ContextChipLabel>
              {props.record.ref} {title}
            </ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">{ticket ? "Open ticket" : "Ticket not available here"}</TooltipPopup>
    </Tooltip>
  );
}
