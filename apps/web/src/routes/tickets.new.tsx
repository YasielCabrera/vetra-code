import { createFileRoute, redirect } from "@tanstack/react-router";

import { NewTicketPage } from "../components/tickets/NewTicketPage";
import { validateNewTicketSearch } from "../components/tickets/ticketDraft.logic";

export const Route = createFileRoute("/tickets/new")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: validateNewTicketSearch,
  component: function NewTicketRoute() {
    const prefill = Route.useSearch();
    // A new prefill (e.g. "Write it myself" while already here) starts a fresh form.
    return <NewTicketPage key={JSON.stringify(prefill)} prefill={prefill} />;
  },
});
