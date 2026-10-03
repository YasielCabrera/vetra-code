import { createFileRoute, redirect } from "@tanstack/react-router";

import { TicketsPage } from "../components/tickets/TicketsPage";
import {
  TICKET_BOARD_SEARCH_SETTLED,
  ticketBoardRestoreRedirect,
  validateTicketBoardSearch,
} from "../components/tickets/ticketBoard.logic";
import { readTicketBoardPreferences } from "../components/tickets/ticketBoardPreferences";

declare module "@tanstack/react-router" {
  interface HistoryState {
    [TICKET_BOARD_SEARCH_SETTLED]?: boolean;
  }
}

export const Route = createFileRoute("/tickets/")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    // Replace, so sidebar, command palette, and back-to-tickets (all `search: {}`)
    // land on the remembered URL without an extra history entry for the empty one.
    const search = ticketBoardRestoreRedirect({
      urlSearch: location.search,
      historyState: location.state,
      rememberedSearch: readTicketBoardPreferences(),
    });
    if (search !== null) {
      throw redirect({ to: "/tickets", search, replace: true });
    }
  },
  validateSearch: validateTicketBoardSearch,
  component: TicketsPage,
});
