import type { TicketStatusDefinition, TicketSummary } from "@t3tools/contracts";

export function summarizeThreadTicketStatuses(input: {
  readonly tickets: ReadonlyArray<Pick<TicketSummary, "statusId">>;
  readonly statuses: ReadonlyArray<TicketStatusDefinition> | undefined;
}): ReadonlyArray<{ readonly status: TicketStatusDefinition | undefined; readonly count: number }> {
  const counts = new Map<TicketSummary["statusId"], number>();
  for (const ticket of input.tickets) {
    counts.set(ticket.statusId, (counts.get(ticket.statusId) ?? 0) + 1);
  }

  const rows = (input.statuses ?? [])
    .map((status) => {
      const count = counts.get(status.id) ?? 0;
      counts.delete(status.id);
      return { status, count };
    })
    .filter((row) => row.count > 0);
  const unknownCount = [...counts.values()].reduce((total, count) => total + count, 0);
  return unknownCount > 0 ? [...rows, { status: undefined, count: unknownCount }] : rows;
}
