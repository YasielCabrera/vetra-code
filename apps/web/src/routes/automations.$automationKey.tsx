import { createFileRoute, redirect } from "@tanstack/react-router";

import { AutomationsPage } from "../components/automations/AutomationsPage";

export const Route = createFileRoute("/automations/$automationKey")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: () => <AutomationsPage automationKey={Route.useParams().automationKey} />,
});
