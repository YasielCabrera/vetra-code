import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, TicketGitHubRef } from "@t3tools/contracts";

import { ticketRepositoryProjectId } from "./ticketGitHub.logic";

export function availableTicketProjects<
  Project extends Pick<EnvironmentProject, "environmentId" | "id" | "title" | "workspaceRoot">,
>(input: {
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<Project>;
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  readonly query: string;
}): ReadonlyArray<Project> {
  const linked = new Set(input.linkedProjectIds);
  const query = input.query.trim().toLowerCase();
  return input.projects.filter(
    (project) =>
      project.environmentId === input.environmentId &&
      !linked.has(project.id) &&
      (project.title.toLowerCase().includes(query) ||
        project.workspaceRoot.toLowerCase().includes(query)),
  );
}

export function projectChangeWouldLoseIssueAccess(input: {
  readonly environmentId: EnvironmentId;
  readonly repository: TicketGitHubRef | null;
  readonly context: Parameters<typeof ticketRepositoryProjectId>[2];
  readonly removeProjectId: ProjectId;
  readonly replacementProjectId: ProjectId | null;
}): boolean {
  if (input.repository === null) return false;
  const remaining = input.context.linkedProjectIds.filter((id) => id !== input.removeProjectId);
  if (input.replacementProjectId !== null) remaining.push(input.replacementProjectId);
  return (
    ticketRepositoryProjectId(input.environmentId, input.repository, input.context) !== null &&
    ticketRepositoryProjectId(input.environmentId, input.repository, {
      ...input.context,
      linkedProjectIds: remaining,
    }) === null
  );
}
