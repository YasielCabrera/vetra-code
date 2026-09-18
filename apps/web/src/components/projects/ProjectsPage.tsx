import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { CloudIcon, FolderPlusIcon, LayersIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjectGroups } from "../../hooks/useProjectGroups";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { ProjectFavicon } from "../ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import {
  buildProjectRowModels,
  matchesProjectQuery,
  threadCountLabel,
  type ProjectRowModel,
} from "./projectsList.logic";

export function ProjectsPage() {
  const navigate = useNavigate();
  const groups = useProjectGroups();
  const threads = useThreadShells();
  // Whether the workspace has said what it holds yet. Until it has, an empty
  // list is "not loaded" rather than "none", and telling somebody to add the
  // project they already have is the one wrong thing an empty state can say.
  const projectsKnown = useAllEnvironmentShellsBootstrapped();
  const [query, setQuery] = useState("");
  const startNewThread = useNewThreadHandler();

  const rows = useMemo(() => buildProjectRowModels(groups, threads), [groups, threads]);

  const trimmedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      trimmedQuery.length === 0
        ? rows
        : rows.filter((row) => matchesProjectQuery(row, trimmedQuery)),
    [rows, trimmedQuery],
  );

  const openProject = useCallback(
    (projectKey: string) => {
      void navigate({ to: "/projects/$projectKey", params: { projectKey } });
    },
    [navigate],
  );
  // A listing exists to get work started, so every row can start some. The
  // group's representative is the checkout the sidebar itself would open.
  const newThreadInProject = useCallback(
    (group: SidebarProjectSnapshot) => {
      void startNewThread(scopeProjectRef(group.environmentId, group.id));
    },
    [startNewThread],
  );

  const breadcrumb = (
    <WorkspaceBreadcrumb ariaLabel="Projects breadcrumb">
      <WorkspaceBreadcrumbItem current>
        <h1 className="truncate">Projects</h1>
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
  const addProject = () => openCommandPalette({ open: "add-project" });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header
            className={cn(
              "workspace-topbar px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            {breadcrumb}
          </header>
        )}
        {isElectron && (
          <div
            className={cn(
              "drag-region flex h-[52px] shrink-0 items-center px-5 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
              COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
            )}
          >
            {breadcrumb}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 pt-6 pb-12">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search projects"
                  aria-label="Search projects"
                  className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 sm:h-8"
                />
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={addProject}>
                <FolderPlusIcon />
                New project
              </Button>
            </div>

            {rows.length === 0 && !projectsKnown ? (
              <ProjectsListGhost rows={5} />
            ) : rows.length === 0 ? (
              <ProjectsEmptyState
                title="No projects yet"
                description="Add a folder or clone a repository to start directing agents in it."
                action={
                  <Button size="sm" onClick={addProject}>
                    <FolderPlusIcon />
                    Add a project
                  </Button>
                }
              />
            ) : visibleRows.length === 0 ? (
              <ProjectsEmptyState
                title="No projects match this search"
                description={`Nothing in this workspace matches “${query.trim()}”.`}
                action={
                  <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {visibleRows.map((row) => (
                  <ProjectRow
                    key={row.group.projectKey}
                    row={row}
                    onOpen={openProject}
                    onNewThread={newThreadInProject}
                  />
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/**
 * Memoized: a search narrows the list on every keystroke, and a row whose
 * project and counts are unchanged has nothing new to say. Effective because
 * the page hands it stable callbacks.
 */
const ProjectRow = memo(function ProjectRow({
  row,
  onOpen,
  onNewThread,
}: {
  row: ProjectRowModel;
  onOpen: (projectKey: string) => void;
  onNewThread: (group: SidebarProjectSnapshot) => void;
}) {
  const { group, repositoryLabel, threadCount, lastActiveAt } = row;
  const checkoutLabel =
    group.groupedProjectCount > 1 ? `${group.groupedProjectCount} checkouts` : null;
  // Named only when the project does not live entirely on this machine: a
  // label on every row would say nothing about any of them.
  const remoteLabel =
    group.environmentPresence === "local-only" ? null : (group.remoteEnvironmentLabels[0] ?? null);

  return (
    <li className="group/project-row flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-accent/60">
      <button
        type="button"
        onClick={() => onOpen(group.projectKey)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ProjectFavicon project={group} className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {group.displayName}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground/70">
            <Tooltip>
              <TooltipTrigger
                render={<span className="truncate">{repositoryLabel ?? group.workspaceRoot}</span>}
              />
              <TooltipPopup>{group.workspaceRoot}</TooltipPopup>
            </Tooltip>
            {checkoutLabel ? (
              <span className="flex shrink-0 items-center gap-1">
                <LayersIcon aria-hidden className="size-3" />
                {checkoutLabel}
              </span>
            ) : null}
            {remoteLabel ? (
              <span className="flex shrink-0 items-center gap-1">
                <CloudIcon aria-hidden className="size-3" />
                <span className="max-w-32 truncate">{remoteLabel}</span>
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground/70 tabular-nums">
          <span>{threadCountLabel(threadCount)}</span>
          {lastActiveAt ? <span>{formatRelativeTimeLabel(lastActiveAt)}</span> : null}
        </span>
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`New thread in ${group.displayName}`}
        title={`New thread in ${group.displayName}`}
        // Revealed on hover on a mouse, always present on touch, where there
        // is no hover to reveal it with.
        className="shrink-0 opacity-0 transition-opacity group-hover/project-row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        onClick={() => onNewThread(group)}
      >
        <SquarePenIcon />
      </Button>
    </li>
  );
});

function ProjectsEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Only for a cold start, where the workspace has not said what it holds yet. */
function ProjectsListGhost({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-0.5">
      {Array.from({ length: rows }, (_unused, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2">
          <div className="size-5 shrink-0 rounded bg-muted/60" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-40 rounded bg-muted/60" />
            <div className="h-2.5 w-64 rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}
