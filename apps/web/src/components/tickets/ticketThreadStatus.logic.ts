import { resolveSidebarThreadStatus, resolveThreadStatusPill } from "../Sidebar.logic";

export function resolveTicketThreadStatus(
  thread: Parameters<typeof resolveThreadStatusPill>[0]["thread"],
) {
  const sidebarStatus = resolveSidebarThreadStatus(thread);
  if (sidebarStatus === "failed" || sidebarStatus === "limited") {
    return {
      kind: "error" as const,
      label: sidebarStatus === "limited" ? "Limited" : "Failed",
      colorClass: sidebarStatus === "limited" ? "text-warning" : "text-error",
      tooltip: thread.runtime?.lastError ?? "Error occurred",
    };
  }
  const status = resolveThreadStatusPill({ thread });
  return status === null
    ? null
    : { kind: "status" as const, ...status, pulse: false, tooltip: status.label };
}
