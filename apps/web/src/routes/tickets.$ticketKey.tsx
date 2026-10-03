import { createFileRoute, redirect } from "@tanstack/react-router";

import { TicketDetailPage } from "../components/tickets/TicketDetailPage";

export const Route = createFileRoute("/tickets/$ticketKey")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: function TicketDetailRoute() {
    const { ticketKey } = Route.useParams();
    return <TicketDetailPage key={ticketKey} ticketKey={ticketKey} />;
  },
});
