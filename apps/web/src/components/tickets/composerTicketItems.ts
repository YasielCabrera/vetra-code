import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import type { EnvironmentId, TicketPlanSummary } from "@t3tools/contracts";

import { formatTicketRef } from "./ticketRefs";

const COMPOSER_TICKET_RESULT_LIMIT = 5;
const COMPOSER_PLAN_RESULT_LIMIT = 5;

export interface ComposerTicketItem {
  readonly id: string;
  readonly type: "ticket";
  readonly ticket: EnvironmentTicket;
  readonly label: string;
  readonly description: string;
}

export interface ComposerTicketPlanItem {
  readonly id: string;
  readonly type: "ticket-plan";
  readonly ticket: EnvironmentTicket;
  readonly plan: TicketPlanSummary;
  readonly label: string;
  readonly description: string;
}

function startsAnyWord(text: string, query: string): boolean {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word.startsWith(query));
}

function matchRank(ticket: EnvironmentTicket, query: string): number | null {
  const reference = /^t-(\d*)$/.exec(query);
  if (reference) {
    const digits = reference[1]!;
    const number = String(ticket.number);
    if (number === digits) return 0;
    if (number.startsWith(digits)) return 1;
  }
  if (startsAnyWord(ticket.title, query)) return 2;
  return ticket.title.toLowerCase().includes(query) ? 3 : null;
}

/**
 * `t-42/` lists that ticket's plans, archived ones included, and `t-42/p1` narrows them by
 * number. Otherwise a word from an active plan's title matches.
 */
function planMatchRank(
  ticket: EnvironmentTicket,
  plan: TicketPlanSummary,
  query: string,
): number | null {
  const reference = /^t-(\d+)\/(?:p(\d*))?$/.exec(query);
  if (reference) {
    if (String(ticket.number) !== reference[1]) return null;
    const digits = reference[2] ?? "";
    const number = String(plan.number);
    if (digits.length > 0 && number === digits) return 0;
    return number.startsWith(digits) ? 1 : null;
  }
  return plan.status === "active" && startsAnyWord(plan.title, query) ? 2 : null;
}

/**
 * Tickets the `#` picker offers above pull requests: `#T-42` by reference, or a word from the
 * title. Plans follow their own tickets: `#T-42/P1` by reference, or a word from the title. The
 * agent reaches tickets on its own server only, so candidates stay in the composer's environment.
 * Bare `#` and digits stay pull request lookups.
 */
export function matchComposerTicketItems(input: {
  readonly tickets: ReadonlyArray<EnvironmentTicket>;
  readonly environmentId: EnvironmentId;
  readonly query: string;
}): Array<ComposerTicketItem | ComposerTicketPlanItem> {
  const query = input.query.trim().toLowerCase();
  if (query.length === 0 || /^\d+$/.test(query)) return [];
  const tickets = input.tickets.filter(
    (ticket) =>
      ticket.environmentId === input.environmentId &&
      !(ticket.kind === "github" && ticket.hiddenAt !== null),
  );
  const ticketItems = tickets
    .flatMap((ticket) => {
      const rank = matchRank(ticket, query);
      return rank === null ? [] : [{ ticket, rank }];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank || right.ticket.updatedAt.localeCompare(left.ticket.updatedAt),
    )
    .slice(0, COMPOSER_TICKET_RESULT_LIMIT)
    .map(({ ticket }): ComposerTicketItem => ({
      id: `ticket:${ticket.environmentId}:${ticket.id}`,
      type: "ticket",
      ticket,
      label: formatTicketRef(ticket),
      description: ticket.title,
    }));
  const planItems = tickets
    .flatMap((ticket) =>
      ticket.plans.flatMap((plan) => {
        const rank = planMatchRank(ticket, plan, query);
        return rank === null ? [] : [{ ticket, plan, rank }];
      }),
    )
    // A reference lists one ticket's plans in number order; title matches put recent work first.
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        (left.rank < 2
          ? left.plan.number - right.plan.number
          : right.plan.updatedAt.localeCompare(left.plan.updatedAt)),
    )
    .slice(0, COMPOSER_PLAN_RESULT_LIMIT)
    .map(({ ticket, plan }): ComposerTicketPlanItem => ({
      id: `ticket-plan:${ticket.environmentId}:${plan.planId}`,
      type: "ticket-plan",
      ticket,
      plan,
      label: plan.ref,
      description: plan.status === "archived" ? `${plan.title} (archived)` : plan.title,
    }));
  return [...ticketItems, ...planItems];
}

const COMPOSER_PICKER_GROUP_LABELS: Partial<Record<string, string>> = {
  ticket: "Tickets",
  "ticket-plan": "Plans",
  "pull-request": "Pull requests",
};

/**
 * Headings for the `#` picker, which mixes tickets, plans and pull requests; other pickers stay
 * flat.
 */
export function groupComposerItems<Item extends { readonly type: string }>(
  items: ReadonlyArray<Item>,
) {
  const groups: Array<{ label: string | null; items: Item[] }> = [];
  for (const item of items) {
    const label = COMPOSER_PICKER_GROUP_LABELS[item.type] ?? null;
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups.length > 1 ? groups : groups.map((group) => ({ ...group, label: null }));
}
