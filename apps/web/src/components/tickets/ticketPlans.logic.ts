import { ticketKey, type ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type { TicketActivity, TicketPlanId, TicketPlanSummary } from "@t3tools/contracts";

/** The `/tickets/$ticketKey/plans/$planNumber` params for one of a ticket's plans. */
export function ticketPlanRouteParams(ticket: ScopedTicketRef, planNumber: number) {
  return { ticketKey: ticketKey(ticket), planNumber: String(planNumber) };
}

/** The plan a `$planNumber` route param names, or null for a bad number or a deleted plan. */
export function findTicketPlanByNumber(
  plans: ReadonlyArray<TicketPlanSummary>,
  planNumber: string,
): TicketPlanSummary | null {
  if (!/^\d+$/.test(planNumber)) return null;
  const number = Number(planNumber);
  return plans.find((plan) => plan.number === number) ?? null;
}

/** Active plans to list, and archived ones to keep behind a toggle, each in number order. */
export function partitionTicketPlans(plans: ReadonlyArray<TicketPlanSummary>): {
  readonly active: ReadonlyArray<TicketPlanSummary>;
  readonly archived: ReadonlyArray<TicketPlanSummary>;
} {
  const active: TicketPlanSummary[] = [];
  const archived: TicketPlanSummary[] = [];
  for (const plan of plans) (plan.status === "archived" ? archived : active).push(plan);
  return { active, archived };
}

export type TicketPlanActivity = TicketActivity & {
  readonly entry: Extract<TicketActivity["entry"], { readonly planId: TicketPlanId }>;
};

/** One plan's history out of its ticket's activity (oldest first), newest first. */
export function ticketPlanHistory(
  activity: ReadonlyArray<TicketActivity>,
  planId: TicketPlanId,
): ReadonlyArray<TicketPlanActivity> {
  const history: TicketPlanActivity[] = [];
  for (let index = activity.length - 1; index >= 0; index--) {
    const item = activity[index]!;
    const { entry } = item;
    if ("planId" in entry && entry.planId === planId) history.push({ ...item, entry });
  }
  return history;
}
