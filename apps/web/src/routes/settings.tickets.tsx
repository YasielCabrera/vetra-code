import { createFileRoute } from "@tanstack/react-router";

import { TicketsSettingsPanel } from "../components/settings/TicketsSettingsPanel";

export const Route = createFileRoute("/settings/tickets")({
  component: TicketsSettingsPanel,
});
