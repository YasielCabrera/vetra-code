export function formatTicketRef(ticket: { readonly number: number }): string {
  return `T-${ticket.number}`;
}
