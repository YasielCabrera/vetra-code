import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import {
  parseTicketPlanReference,
  type TicketContextRecord,
  type TicketPlanContextRecord,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ClipboardListIcon, SquareKanbanIcon } from "lucide-react";

import { useTicket } from "~/state/tickets";
import { LinkedContextChip } from "../ContextChip";
import { ticketPlanRouteParams } from "./ticketPlans.logic";

export function TicketContextChip(props: {
  record: Pick<TicketContextRecord, "environmentId" | "ticketId" | "ref" | "title">;
  copyMarkdown?: string;
}) {
  const { environmentId, ticketId, ref } = props.record;
  const ticket = useTicket({ environmentId, ticketId });
  const title = ticket?.title ?? props.record.title;
  return (
    <LinkedContextChip
      kind="ticket"
      link={
        <Link
          to="/tickets/$ticketKey"
          params={{ ticketKey: ticketKey({ environmentId, ticketId }) }}
        />
      }
      icon={<SquareKanbanIcon />}
      label={`${ref} ${title}`}
      ariaLabel={`Ticket ${ref}, ${title}`}
      tooltip={ticket ? "Open ticket" : "Ticket not available here"}
      copyMarkdown={props.copyMarkdown}
    />
  );
}

/** Links to the plan page; the title is live while the plan's ticket is loaded. */
export function TicketPlanContextChip(props: {
  record: Pick<TicketPlanContextRecord, "environmentId" | "ticketId" | "planId" | "ref" | "title">;
  copyMarkdown?: string;
}) {
  const { environmentId, ticketId, planId, ref } = props.record;
  const ticket = useTicket({ environmentId, ticketId });
  const plan = ticket?.plans.find((candidate) => candidate.planId === planId) ?? null;
  const title = plan?.title ?? props.record.title;
  const reference = parseTicketPlanReference(ref);
  const planNumber = plan?.number ?? (reference?.type === "number" ? reference.number : null);
  const scope = { environmentId, ticketId };
  return (
    <LinkedContextChip
      kind="ticket-plan"
      link={
        planNumber === null ? (
          <Link to="/tickets/$ticketKey" params={{ ticketKey: ticketKey(scope) }} />
        ) : (
          <Link
            to="/tickets/$ticketKey/plans/$planNumber"
            params={ticketPlanRouteParams(scope, planNumber)}
          />
        )
      }
      icon={<ClipboardListIcon />}
      label={`${ref} ${title}`}
      ariaLabel={`Plan ${ref}, ${title}`}
      tooltip={plan ? "Open plan" : "Plan not available here"}
      copyMarkdown={props.copyMarkdown}
    />
  );
}
