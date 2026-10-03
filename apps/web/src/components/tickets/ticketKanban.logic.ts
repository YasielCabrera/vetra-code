import { type EnvironmentTicket, ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { TicketStatusDefinition, TicketStatusId, TicketStatusSet } from "@t3tools/contracts";
import { keyBetween } from "@t3tools/shared/fractionalIndex";

import { ticketStatusGroupKey } from "./ticketBoard.logic";

/**
 * The sort key that places a dropped card at `slot`, the gap before `sortKeys[slot]` (the column's
 * length for the bottom). `movedIndex` is the card's own index when it is reordered inside this
 * column, or -1 when it comes from another column. Null when the drop leaves it where it is.
 *
 * A merged column mixes environments whose keys can tie, so the upper neighbour is the first key
 * strictly above the lower one.
 */
export function dropSortKey(
  sortKeys: ReadonlyArray<string>,
  slot: number,
  movedIndex: number,
): string | null {
  if (movedIndex !== -1 && (slot === movedIndex || slot === movedIndex + 1)) return null;
  const others = movedIndex === -1 ? sortKeys : sortKeys.toSpliced(movedIndex, 1);
  const at = movedIndex !== -1 && slot > movedIndex ? slot - 1 : slot;
  const before = others[at - 1] ?? null;
  const after = others.slice(at).find((key) => before === null || key > before) ?? null;
  return keyBetween(before, after);
}

/**
 * The status a ticket takes when dropped on a merged column: the one in its own environment that
 * shares the column's category and name, keeping its current status when that one matches.
 * Undefined when its environment has no such status.
 */
export function statusForColumn(
  statusSet: TicketStatusSet | undefined,
  columnKey: string,
  currentStatusId: TicketStatusId,
): TicketStatusDefinition | undefined {
  const matches = statusSet?.statuses.filter(
    (status) => ticketStatusGroupKey(status) === columnKey,
  );
  return matches?.find((status) => status.id === currentStatusId) ?? matches?.[0];
}

/** A drop the server has not confirmed yet, keyed by `ticketKey`. */
export interface PendingTicketMove {
  readonly fromRevision: number;
  readonly statusId: TicketStatusId;
  readonly sortKey: string;
}

/**
 * Shows pending drops over the folded list. A move applies only while the ticket is still at the
 * revision it was dragged from, so the server's next version of the ticket replaces it.
 */
export function applyPendingMoves(
  tickets: ReadonlyArray<EnvironmentTicket>,
  pending: ReadonlyMap<string, PendingTicketMove>,
): ReadonlyArray<EnvironmentTicket> {
  if (pending.size === 0) return tickets;
  return tickets.map((ticket) => {
    const move = pending.get(
      ticketKey({ environmentId: ticket.environmentId, ticketId: ticket.id }),
    );
    return move === undefined || move.fromRevision !== ticket.revision
      ? ticket
      : { ...ticket, statusId: move.statusId, sortKey: move.sortKey };
  });
}

/** Drops pending moves the server has answered: the ticket is gone or past the dragged revision. */
export function settlePendingMoves(
  pending: ReadonlyMap<string, PendingTicketMove>,
  tickets: ReadonlyArray<EnvironmentTicket>,
): ReadonlyMap<string, PendingTicketMove> {
  if (pending.size === 0) return pending;
  const revisions = new Map(
    tickets.map((ticket) => [
      ticketKey({ environmentId: ticket.environmentId, ticketId: ticket.id }),
      ticket.revision,
    ]),
  );
  const next = new Map(
    [...pending].filter(([key, move]) => revisions.get(key) === move.fromRevision),
  );
  return next.size === pending.size ? pending : next;
}
