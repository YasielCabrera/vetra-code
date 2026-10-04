import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import {
  parseTicketPlanReference,
  type TicketContextRecord,
  type TicketPlanContextRecord,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ClipboardListIcon, SquareKanbanIcon } from "lucide-react";

import { useTicket } from "~/state/tickets";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ticketPlanRouteParams } from "./ticketPlans.logic";

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
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="ticket-plan"
            render={
              planNumber === null ? (
                <Link to="/tickets/$ticketKey" params={{ ticketKey: ticketKey(scope) }} />
              ) : (
                <Link
                  to="/tickets/$ticketKey/plans/$planNumber"
                  params={ticketPlanRouteParams(scope, planNumber)}
                />
              )
            }
            aria-label={`Plan ${ref}, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
          >
            <ClipboardListIcon />
            <ContextChipLabel>
              {ref} {title}
            </ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">{plan ? "Open plan" : "Plan not available here"}</TooltipPopup>
    </Tooltip>
  );
}
