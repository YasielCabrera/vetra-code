import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import type { EnvironmentId } from "@t3tools/contracts";

import { formatTicketRef } from "./ticketRefs";

const COMPOSER_TICKET_RESULT_LIMIT = 5;

export interface ComposerTicketItem {
  readonly id: string;
  readonly type: "ticket";
  readonly ticket: EnvironmentTicket;
  readonly label: string;
  readonly description: string;
}

function matchRank(ticket: EnvironmentTicket, query: string): number | null {
  const reference = /^t-(\d*)$/.exec(query);
  if (reference) {
    const digits = reference[1]!;
    const number = String(ticket.number);
    if (number === digits) return 0;
    if (number.startsWith(digits)) return 1;
  }
  const title = ticket.title.toLowerCase();
  if (title.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 2;
  return title.includes(query) ? 3 : null;
}

/**
 * Tickets the `#` picker offers above pull requests: `#T-42` by reference, or a word from the
 * title. The agent reaches tickets on its own server only, so candidates stay in the composer's
 * environment. Bare `#` and digits stay pull request lookups.
 */
export function matchComposerTicketItems(input: {
  readonly tickets: ReadonlyArray<EnvironmentTicket>;
  readonly environmentId: EnvironmentId;
  readonly query: string;
}): ComposerTicketItem[] {
  const query = input.query.trim().toLowerCase();
  if (query.length === 0 || /^\d+$/.test(query)) return [];
  return input.tickets
    .flatMap((ticket) => {
      if (ticket.environmentId !== input.environmentId) return [];
      if (ticket.kind === "github" && ticket.hiddenAt !== null) return [];
      const rank = matchRank(ticket, query);
      return rank === null ? [] : [{ ticket, rank }];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank || right.ticket.updatedAt.localeCompare(left.ticket.updatedAt),
    )
    .slice(0, COMPOSER_TICKET_RESULT_LIMIT)
    .map(({ ticket }) => ({
      id: `ticket:${ticket.environmentId}:${ticket.id}`,
      type: "ticket",
      ticket,
      label: formatTicketRef(ticket),
      description: ticket.title,
    }));
}

const COMPOSER_PICKER_GROUP_LABELS: Partial<Record<string, string>> = {
  ticket: "Tickets",
  "pull-request": "Pull requests",
};

/** Headings for the `#` picker, which mixes tickets and pull requests; other pickers stay flat. */
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
