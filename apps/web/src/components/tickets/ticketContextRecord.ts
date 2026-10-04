import {
  COMPOSER_CONTEXT_TICKET_BODY_MAX_CHARS,
  TICKET_CONTEXT_PLANS_MAX,
} from "@t3tools/contracts";
import type {
  EnvironmentId,
  TicketContextRecord,
  TicketPlanContextRecord,
  TicketPlanSummary,
  TicketSummary,
} from "@t3tools/contracts";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";

import type { AttachedContextRecord } from "../../composerDraftStore";
import { toKindScopedComposerContextId } from "../../lib/composerContextReferences";
import { formatTicketRef } from "./ticketRefs";

/**
 * One record per ticket. Pass the body when it is at hand (the ticket page has it); a ticket
 * picked from a list goes without, and the agent reads it with `t3_ticket_get`. Plans travel as
 * references only.
 */
export function ticketContextRecord(input: {
  readonly environmentId: EnvironmentId;
  readonly ticket: Pick<TicketSummary, "id" | "number" | "title" | "linkRefs" | "plans">;
  readonly body?: string;
}): TicketContextRecord {
  const ref = `T-${input.ticket.number}`;
  const body = input.body?.trim();
  const plans = input.ticket.plans.slice(0, TICKET_CONTEXT_PLANS_MAX);
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
    ...(plans.length > 0
      ? {
          plans: plans.map((plan) => ({
            planId: plan.planId,
            ref: plan.ref,
            title: plan.title,
            status: plan.status,
            revision: plan.revision,
            openCommentCount: plan.openCommentCount,
          })),
        }
      : {}),
  };
}

/** One plan, attached as the work to do; the agent reads its body with `t3_ticket_plan_get`. */
export function ticketPlanContextRecord(input: {
  readonly environmentId: EnvironmentId;
  readonly plan: TicketPlanSummary;
}): TicketPlanContextRecord {
  const { plan } = input;
  return {
    version: 1,
    kind: "ticket-plan",
    contextId: toKindScopedComposerContextId("ticket-plan", plan.planId),
    label: sanitizeComposerContextLabel(`${plan.ref} ${plan.title}`, "ticket-plan"),
    environmentId: input.environmentId,
    ticketId: plan.ticketId,
    planId: plan.planId,
    ref: plan.ref,
    title: plan.title,
    revision: plan.revision,
    openCommentCount: plan.openCommentCount,
  };
}

/** What a new thread's draft starts with: chips, then optional text the user edits. */
export interface TicketThreadPrefill {
  readonly records: ReadonlyArray<AttachedContextRecord>;
  readonly instruction?: string;
}

/** Implement a plan: its chip, with its ticket's for context. */
export function openPlanPrefill(
  environmentId: EnvironmentId,
  ticket: TicketSummary,
  plan: TicketPlanSummary,
): TicketThreadPrefill {
  return {
    records: [
      ticketPlanContextRecord({ environmentId, plan }),
      ticketContextRecord({ environmentId, ticket }),
    ],
  };
}

export function revisePlanPrefill(
  environmentId: EnvironmentId,
  plan: TicketPlanSummary,
): TicketThreadPrefill {
  const instruction =
    plan.openCommentCount === 0
      ? `Revise the plan text of ${plan.ref} with t3_ticket_plan_update. Do not change code.`
      : `Revise the plan text of ${plan.ref} to address its open comments: edit it with t3_ticket_plan_update and resolve each comment it addresses. Do not change code.`;
  return {
    records: [ticketPlanContextRecord({ environmentId, plan })],
    instruction,
  };
}

export function askForPlanPrefill(
  environmentId: EnvironmentId,
  ticket: Pick<TicketSummary, "id" | "number" | "title" | "linkRefs" | "plans">,
): TicketThreadPrefill {
  return {
    records: [ticketContextRecord({ environmentId, ticket })],
    instruction: `Write an implementation plan for ${formatTicketRef(ticket)} with t3_ticket_plan_create. Do not change code.`,
  };
}
