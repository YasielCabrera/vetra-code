import { createFileRoute, redirect } from "@tanstack/react-router";

import { AutomationsPage } from "../components/automations/AutomationsPage";

export const Route = createFileRoute("/automations/new")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (search: Record<string, unknown>) => ({
    template: typeof search.template === "string" ? search.template : undefined,
  }),
  component: () => {
    const { template } = Route.useSearch();
    return <AutomationsPage isNew {...(template !== undefined ? { templateId: template } : {})} />;
  },
});
