import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { EnvironmentId, TicketId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { SquareKanbanIcon } from "lucide-react";

import { useTicket, useTicketStatuses } from "../../state/tickets";
import { Button } from "../ui/button";
import { TicketStatusIcon } from "./ticketPresentation";
import { formatTicketRef } from "./ticketRefs";

export function TicketToolCallCard(props: {
  readonly environmentId: EnvironmentId;
  readonly ticket: { readonly id: TicketId; readonly number: number; readonly title: string };
}) {
  const { environmentId } = props;
  const ticket = useTicket({ environmentId, ticketId: props.ticket.id });
  const statuses = useTicketStatuses(environmentId);
  const status = statuses?.statuses.find((candidate) => candidate.id === ticket?.statusId);
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {status ? (
        <TicketStatusIcon color={status.color} category={status.category} />
      ) : (
        <SquareKanbanIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="shrink-0 text-muted-foreground">{formatTicketRef(props.ticket)}</span>
      <span className="min-w-0 flex-1 truncate">{ticket?.title ?? props.ticket.title}</span>
      {status ? (
        <span className="shrink-0 text-xs text-muted-foreground">{status.name}</span>
      ) : null}
      {ticket ? (
        <Button
          size="xs"
          variant="ghost"
          render={
            <Link
              to="/tickets/$ticketKey"
              params={{ ticketKey: ticketKey({ environmentId, ticketId: ticket.id }) }}
            />
          }
        >
          Open
        </Button>
      ) : null}
    </div>
  );
}
