import { createFileRoute, redirect } from "@tanstack/react-router";

import { TicketPlanPage } from "../components/tickets/TicketPlanPage";

export const Route = createFileRoute("/tickets/$ticketKey_/plans/$planNumber")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (search: Record<string, unknown>): { readonly edit?: true } =>
    search.edit === true ? { edit: true } : {},
  component: function TicketPlanRoute() {
    const { ticketKey, planNumber } = Route.useParams();
    const { edit } = Route.useSearch();
    return (
      <TicketPlanPage
        key={`${ticketKey}/${planNumber}`}
        ticketKey={ticketKey}
        planNumber={planNumber}
        startEditing={edit === true}
      />
    );
  },
});
