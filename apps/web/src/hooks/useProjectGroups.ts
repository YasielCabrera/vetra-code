import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { useProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useClientSettings } from "./useSettings";

/**
 * Every logical project group in the workspace, sorted by display name. The
 * projects listing and a project's own page read the same projection, so the
 * page a row opens is the row the page came from.
 */
export function useProjectGroups(): SidebarProjectSnapshot[] {
  const projects = useProjects();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  return buildSidebarProjectSnapshots({
    projects,
    settings: projectGroupingSettings,
    primaryEnvironmentId,
    resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
