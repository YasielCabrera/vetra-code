import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { useTicketsForThread } from "~/state/tickets";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatTicketRef } from "./ticketRefs";

export function ThreadTicketChips(props: { readonly threadRef: ScopedThreadRef }) {
  const tickets = useTicketsForThread(props.threadRef);
  if (tickets.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {tickets.map((ticket) => (
        <Tooltip key={ticket.id}>
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                render={
                  <Link
                    to="/tickets/$ticketKey"
                    params={{
                      ticketKey: ticketKey({
                        environmentId: ticket.environmentId,
                        ticketId: ticket.id,
                      }),
                    }}
                    aria-label={`Ticket ${formatTicketRef(ticket)}, ${ticket.title}`}
                  />
                }
              />
            }
          >
            <span className="font-mono">{formatTicketRef(ticket)}</span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">{ticket.title}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
