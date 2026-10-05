import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ClipboardListIcon, SquareKanbanIcon } from "lucide-react";

import { useTicket, useTicketStatuses } from "../../state/tickets";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { TicketStatusIcon } from "./ticketPresentation";
import { ticketPlanRouteParams } from "./ticketPlans.logic";
import { formatTicketRef } from "./ticketRefs";
import type { TicketToolCallTarget } from "./ticketToolCall";

export function TicketToolCallCard(props: {
  readonly environmentId: EnvironmentId;
  readonly target: TicketToolCallTarget;
}) {
  return props.target.kind === "ticket" ? (
    <CreatedTicketCard environmentId={props.environmentId} ticket={props.target.ticket} />
  ) : (
    <WrittenPlanCard environmentId={props.environmentId} plan={props.target.plan} />
  );
}

function CreatedTicketCard(props: {
  readonly environmentId: EnvironmentId;
  readonly ticket: Extract<TicketToolCallTarget, { kind: "ticket" }>["ticket"];
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

function WrittenPlanCard(props: {
  readonly environmentId: EnvironmentId;
  readonly plan: Extract<TicketToolCallTarget, { kind: "plan" }>["plan"];
}) {
  const ticketRef = { environmentId: props.environmentId, ticketId: props.plan.ticketId };
  const ticket = useTicket(ticketRef);
  const plan = ticket?.plans.find((candidate) => candidate.number === props.plan.number);
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <ClipboardListIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-muted-foreground">{props.plan.ref}</span>
      <span className="min-w-0 flex-1 truncate">{plan?.title ?? props.plan.title}</span>
      <Badge
        variant={
          (plan?.reviewStatus ?? props.plan.reviewStatus) === "ready" ? "success" : "warning"
        }
      >
        {(plan?.reviewStatus ?? props.plan.reviewStatus) === "ready" ? "Ready" : "Draft"}
        {plan ? null : " snapshot"}
      </Badge>
      {plan?.status === "archived" ? (
        <span className="shrink-0 text-xs text-muted-foreground">Archived</span>
      ) : null}
      {plan ? (
        <Button
          size="xs"
          variant="ghost"
          render={
            <Link
              to="/tickets/$ticketKey/plans/$planNumber"
              params={ticketPlanRouteParams(ticketRef, plan.number)}
            />
          }
        >
          Open
        </Button>
      ) : null}
    </div>
  );
}
