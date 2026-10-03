import { createFileRoute, redirect } from "@tanstack/react-router";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";

// Vetra edits scheduled tasks on the Automations page; upstream links that
// still point here (a run's "Sent by automation", the thread panel) land there.
export const Route = createFileRoute("/settings/scheduled-tasks")({
  validateSearch: validateScheduledTasksSearch,
  beforeLoad: ({ search }) => {
    if (search.environmentId !== undefined && search.taskId !== undefined) {
      throw redirect({
        to: "/automations/$automationKey",
        params: { automationKey: `${search.environmentId}:${search.taskId}` },
        replace: true,
      });
    }
    throw redirect({ to: "/automations", replace: true });
  },
});
