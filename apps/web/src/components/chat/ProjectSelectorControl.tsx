import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useMemo } from "react";

import { sortLogicalProjectsForSidebar } from "~/components/Sidebar.logic";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "~/sidebarProjectGrouping";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";

interface ProjectSelectorControlProps {
  selectedProjectRef: ScopedProjectRef | null;
  selectedProjectTitle: string | null;
  onSelectProject: (project: EnvironmentProject) => void;
  onCreateProject: () => void;
}

export function ProjectSelectorControl(props: ProjectSelectorControlProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: groupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      groupingSettings,
      primaryEnvironmentId,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  const entries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: props.selectedProjectRef,
      }),
    [projectGroups, props.selectedProjectRef],
  );
  const entryByKey = useMemo(
    () => new Map(entries.map((entry) => [entry.group.projectKey, entry] as const)),
    [entries],
  );
  const selectedGroup =
    props.selectedProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) =>
              scopedProjectKey(projectRef) === scopedProjectKey(props.selectedProjectRef!),
          ),
        ) ?? null);
  const selectedProjectKey = selectedGroup?.projectKey ?? "";
  const label = selectedGroup?.displayName ?? props.selectedProjectTitle ?? "Select project";

  return (
    <Menu>
      <MenuTrigger
        aria-label={props.selectedProjectRef ? "Change project" : "Select project"}
        title={label}
        render={
          <button
            type="button"
            className="flex h-8 max-w-52 min-w-32 items-center gap-1.5 rounded-lg border border-border/70 bg-background/55 px-2.5 text-sm text-secondary-label outline-hidden transition-colors hover:border-primary/35 hover:bg-accent/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <FolderIcon className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="end" className="max-h-80 min-w-56 max-w-72 overflow-y-auto">
        {entries.length > 0 ? (
          <>
            <MenuRadioGroup
              value={selectedProjectKey}
              onValueChange={(value) => {
                const entry = entryByKey.get(value as string);
                if (!entry || value === selectedProjectKey) {
                  return;
                }
                props.onSelectProject(entry.targetProject);
              }}
            >
              {entries.map(({ group }) => (
                <MenuRadioItem key={group.projectKey} value={group.projectKey} closeOnClick>
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="block min-w-0 truncate">{group.displayName}</span>}
                    />
                    <TooltipPopup>{group.displayName}</TooltipPopup>
                  </Tooltip>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem onClick={props.onCreateProject}>
          <FolderPlusIcon />
          New project
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
