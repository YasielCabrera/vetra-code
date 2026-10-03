import { COMPOSER_CONTEXT_TICKET_BODY_MAX_CHARS } from "@t3tools/contracts";
import type { EnvironmentId, TicketContextRecord, TicketSummary } from "@t3tools/contracts";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";

import { toKindScopedComposerContextId } from "../../lib/composerContextReferences";

/**
 * One record per ticket. Pass the body when it is at hand (the ticket page has it); a ticket
 * picked from a list goes without, and the agent reads it with `t3_ticket_get`.
 */
export function ticketContextRecord(input: {
  readonly environmentId: EnvironmentId;
  readonly ticket: Pick<TicketSummary, "id" | "number" | "title" | "linkRefs">;
  readonly body?: string;
}): TicketContextRecord {
  const ref = `T-${input.ticket.number}`;
  const body = input.body?.trim();
  return {
    version: 1,
    kind: "ticket",
    contextId: toKindScopedComposerContextId("ticket", input.ticket.id),
    label: sanitizeComposerContextLabel(`${ref} ${input.ticket.title}`, "ticket"),
    environmentId: input.environmentId,
    ticketId: input.ticket.id,
    ref,
    title: input.ticket.title,
    ...(body ? { body: body.slice(0, COMPOSER_CONTEXT_TICKET_BODY_MAX_CHARS) } : {}),
    links: input.ticket.linkRefs.slice(0, 50),
  };
}
