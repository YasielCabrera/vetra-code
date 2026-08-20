import {
  EnvironmentId as EnvironmentIdSchema,
  ProjectId as ProjectIdSchema,
  type EnvironmentId,
  type IssueListCursors,
  type IssueListInput,
  type IssueListState,
  type IssueRef,
  type ProjectId,
} from "@vetra-code/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  LayersIcon,
  ListFilterIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IssueDetail } from "../components/issue/IssueDetail";
import { normalizeIssueExternalUrl } from "../components/issue/issueExternalUrl";
import { mergeIssueListPage } from "../components/issue/issueListPagination";
import { IssueRow } from "../components/issue/IssueRow";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { assignProjectsToEnvironments } from "../components/pullRequest/pullRequestProjectAssignment.logic";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { Input } from "../components/ui/input";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { readLocalApi } from "../localApi";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import {
  issueEnvironment,
  issueEntryKey,
  useIssueList,
  type EnvironmentIssueEntry,
  type IssueEnvironmentQueryTarget,
  type MergedIssueList,
} from "../state/issues";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

export interface IssuesSearch {
  readonly state: IssueListState;
  readonly q?: string;
  readonly host?: string;
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly selectedEnvironmentId?: EnvironmentId;
  readonly selectedProjectId?: ProjectId;
  readonly repository?: string;
  readonly number?: number;
}

type IssuesSearchPatch = {
  readonly [Key in keyof IssuesSearch]?: IssuesSearch[Key] | undefined;
};

function withSearchPatch(previous: IssuesSearch, patch: IssuesSearchPatch): IssuesSearch {
  const next = { ...previous } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (key !== "state") delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next as unknown as IssuesSearch;
}

const SEARCH_DEBOUNCE_MS = 250;
const ISSUE_PAGE_SIZE = 99;
const EMPTY_ENVIRONMENT_CURSORS: Readonly<Record<string, IssueListCursors>> = {};
const EMPTY_ISSUE_ENTRIES: ReadonlyArray<EnvironmentIssueEntry> = [];
const ISSUES_PROJECT_SCOPE_STORAGE_KEY = "vetra:issues-project-scope:v1";
const IssuesProjectScope = Schema.NullOr(
  Schema.Struct({
    environmentId: EnvironmentIdSchema,
    projectId: ProjectIdSchema,
  }),
);

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): IssuesSearch => ({
    state: raw.state === "all" || raw.state === "closed" ? raw.state : "open",
    ...(typeof raw.q === "string" && raw.q.trim() ? { q: raw.q.slice(0, 200) } : {}),
    ...(typeof raw.host === "string" && raw.host.trim() ? { host: raw.host.slice(0, 200) } : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.selectedEnvironmentId === "string" && raw.selectedEnvironmentId
      ? { selectedEnvironmentId: raw.selectedEnvironmentId as EnvironmentId }
      : {}),
    ...(typeof raw.selectedProjectId === "string" && raw.selectedProjectId
      ? { selectedProjectId: raw.selectedProjectId as ProjectId }
      : {}),
    ...(typeof raw.repository === "string" && raw.repository
      ? { repository: raw.repository.slice(0, 200) }
      : {}),
    ...(typeof raw.number === "number" && Number.isSafeInteger(raw.number) && raw.number > 0
      ? { number: raw.number }
      : {}),
  }),
  component: IssuesRouteView,
});

function IssueListGhost() {
  return (
    <div aria-label="Loading issues" className="overflow-hidden">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="flex gap-3 border-b border-border/70 px-4 py-3 last:border-b-0">
          <Skeleton className="mt-0.5 size-4.5 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailGhost() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex h-11 items-center gap-2 border-b border-border/60 px-4">
        <Skeleton className="size-6 rounded-md" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="ml-auto size-6 rounded-md" />
      </div>
      <div className="space-y-2 px-4 pt-3 pb-4">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-3.5 w-52" />
      </div>
      <div className="flex gap-2 border-y border-border/60 px-4 py-2">
        <Skeleton className="h-7 w-20 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>
      <div className="space-y-3 px-4 py-4">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
      <div className="space-y-3 border-t border-border/60 px-4 py-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}

function IssuesRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { environments } = useEnvironments();
  const allProjects = useProjects();
  const projectsKnown = useAllEnvironmentShellsBootstrapped();
  const [rememberedProjectScope, setRememberedProjectScope] = useLocalStorage(
    ISSUES_PROJECT_SCOPE_STORAGE_KEY,
    null,
    IssuesProjectScope,
  );
  const capableEnvironments = useMemo(
    () =>
      environments
        .filter((environment) => environment.serverConfig?.environment.capabilities.issues === true)
        .toSorted((left, right) => left.environmentId.localeCompare(right.environmentId)),
    [environments],
  );
  const capabilityKnown = environments.some((environment) => environment.serverConfig !== null);
  const capableIds = useMemo(
    () => capableEnvironments.map((environment) => environment.environmentId),
    [capableEnvironments],
  );
  const projects = useMemo(
    () => allProjects.filter((project) => capableIds.includes(project.environmentId)),
    [allProjects, capableIds],
  );
  const environmentLabels = useMemo(
    () =>
      new Map(
        capableEnvironments.map((environment) => [environment.environmentId, environment.label]),
      ),
    [capableEnvironments],
  );
  const requestedProjectId = search.projectId ?? rememberedProjectScope?.projectId;
  const requestedEnvironmentId =
    search.projectId === undefined ? rememberedProjectScope?.environmentId : search.environmentId;
  const scopedProject = projects.find(
    (project) =>
      project.id === requestedProjectId &&
      (requestedEnvironmentId === undefined || project.environmentId === requestedEnvironmentId),
  );
  const queryEnvironmentIds = useMemo(
    () =>
      capableIds.filter(
        (environmentId) =>
          scopedProject === undefined || environmentId === scopedProject.environmentId,
      ),
    [capableIds, scopedProject],
  );
  const typedQuery = search.q?.trim() ?? "";
  const sentQuery = useDebouncedValue(typedQuery, SEARCH_DEBOUNCE_MS);

  const updateSearch = useCallback(
    (patch: IssuesSearchPatch) =>
      void navigate({
        replace: true,
        search: (previous) => withSearchPatch(previous, patch),
      }),
    [navigate],
  );

  const baseTargets = useMemo<ReadonlyArray<IssueEnvironmentQueryTarget>>(() => {
    if (scopedProject !== undefined) {
      return [
        {
          environmentId: scopedProject.environmentId,
          input: {
            state: search.state,
            limit: ISSUE_PAGE_SIZE,
            projectId: scopedProject.id,
            ...(search.host === undefined ? {} : { host: search.host }),
            ...(sentQuery ? { query: sentQuery } : {}),
          },
        },
      ];
    }
    const assignment = assignProjectsToEnvironments(
      projects,
      queryEnvironmentIds,
      queryEnvironmentIds[0],
    );
    const totals = new Map<EnvironmentId, number>();
    for (const project of projects) {
      totals.set(project.environmentId, (totals.get(project.environmentId) ?? 0) + 1);
    }
    return queryEnvironmentIds.flatMap((environmentId) => {
      const projectIds = assignment.get(environmentId);
      if (projectsKnown && projectIds === undefined) return [];
      const includeIds =
        projectIds !== undefined && projectIds.length !== (totals.get(environmentId) ?? 0);
      const input: IssueListInput = {
        state: search.state,
        limit: ISSUE_PAGE_SIZE,
        ...(includeIds ? { projectIds } : {}),
        ...(search.host === undefined ? {} : { host: search.host }),
        ...(sentQuery ? { query: sentQuery } : {}),
      };
      return [{ environmentId, input }];
    });
  }, [
    projects,
    projectsKnown,
    queryEnvironmentIds,
    scopedProject,
    search.host,
    search.state,
    sentQuery,
  ]);

  const filterKey = useMemo(() => JSON.stringify(baseTargets), [baseTargets]);
  const [page, setPage] = useState<{
    readonly key: string;
    readonly cursors: Readonly<Record<string, IssueListCursors>> | null;
  }>({ key: "", cursors: null });
  const sentCursors = page.key === filterKey ? page.cursors : null;
  useEffect(() => {
    setPage({ key: filterKey, cursors: null });
  }, [filterKey]);

  const targets = useMemo<ReadonlyArray<IssueEnvironmentQueryTarget>>(() => {
    if (sentCursors === null) return baseTargets;
    return baseTargets.flatMap((target) => {
      const cursors = sentCursors[target.environmentId];
      return cursors === undefined ? [] : [{ ...target, input: { ...target.input, cursors } }];
    });
  }, [baseTargets, sentCursors]);

  const baselineQuery = useIssueList(baseTargets);
  const listQuery = useIssueList(targets);
  const pageHasErrors =
    listQuery.error !== null ||
    listQuery.data?.errors.some((error) => error.retryable === true) === true;
  const [loaded, setLoaded] = useState<{
    readonly key: string;
    readonly data: MergedIssueList;
  } | null>(null);
  useEffect(() => {
    const arrived = listQuery.data;
    // A failed continuation keeps its cursors and rows intact so Retry asks for that exact page
    // again. The initial page may still show healthy environments as partial results.
    if (arrived === null || (sentCursors !== null && pageHasErrors)) return;
    setLoaded((previous) => ({
      key: filterKey,
      data: mergeIssueListPage(
        previous?.key === filterKey ? previous.data : null,
        arrived,
        sentCursors !== null,
      ),
    }));
  }, [filterKey, listQuery.data, pageHasErrors, sentCursors]);
  const listData =
    (loaded?.key === filterKey ? loaded.data : null) ??
    (sentCursors === null ? listQuery.data : null);
  const nextCursors = listQuery.data?.nextCursors ?? EMPTY_ENVIRONMENT_CURSORS;
  const canContinue = Object.keys(nextCursors).length > 0;
  const loadingMore = sentCursors !== null && listQuery.isPending;
  const selectedRef = useMemo(() => {
    if (
      search.selectedEnvironmentId === undefined ||
      search.selectedProjectId === undefined ||
      search.repository === undefined ||
      search.number === undefined ||
      !capableIds.includes(search.selectedEnvironmentId)
    ) {
      return null;
    }
    return {
      environmentId: search.selectedEnvironmentId,
      input: {
        projectId: search.selectedProjectId,
        repository: search.repository,
        number: search.number,
      } satisfies IssueRef,
    };
  }, [
    capableIds,
    search.number,
    search.repository,
    search.selectedEnvironmentId,
    search.selectedProjectId,
  ]);
  const detailAtom = useMemo(
    () => (selectedRef === null ? null : issueEnvironment.detail(selectedRef)),
    [selectedRef],
  );
  const activityAtom = useMemo(
    () => (selectedRef === null ? null : issueEnvironment.activity(selectedRef)),
    [selectedRef],
  );
  const detailQuery = useEnvironmentQuery(detailAtom);
  const activityQuery = useEnvironmentQuery(activityAtom);
  const invalidate = useAtomCommand(issueEnvironment.invalidate, { reportFailure: false });
  const [invalidating, setInvalidating] = useState(false);

  const refreshFromHost = async () => {
    setPage({ key: filterKey, cursors: null });
    setInvalidating(true);
    try {
      await Promise.all(
        baseTargets.map((target) => invalidate({ environmentId: target.environmentId, input: {} })),
      );
      if (selectedRef !== null) {
        await invalidate({
          environmentId: selectedRef.environmentId,
          input: { reference: selectedRef.input },
        });
      }
    } finally {
      setInvalidating(false);
    }
    baselineQuery.refresh();
    if (selectedRef !== null) {
      detailQuery.refresh();
      activityQuery.refresh();
    }
  };

  const retryCurrentPage = async () => {
    setInvalidating(true);
    try {
      await Promise.all(
        targets.map((target) => invalidate({ environmentId: target.environmentId, input: {} })),
      );
    } finally {
      setInvalidating(false);
      // Partial repository failures are successful RPC answers and therefore cached. Invalidate
      // first so Retry reaches the host instead of replaying the same partial page.
      listQuery.refresh();
    }
  };

  const selectIssue = useCallback(
    (entry: EnvironmentIssueEntry) =>
      updateSearch({
        selectedEnvironmentId: entry.environmentId,
        selectedProjectId: entry.projectId,
        repository: entry.repository,
        number: entry.number,
      }),
    [updateSearch],
  );
  const clearSelection = useCallback(
    () =>
      updateSearch({
        selectedEnvironmentId: undefined,
        selectedProjectId: undefined,
        repository: undefined,
        number: undefined,
      }),
    [updateSearch],
  );
  const openExternal = (raw: string) => {
    const url = normalizeIssueExternalUrl(raw);
    if (url !== null)
      void readLocalApi()
        ?.shell.openExternal(url)
        .catch(() => undefined);
  };
  const repositories = listData?.repositories ?? [];
  const issues = listData?.entries ?? EMPTY_ISSUE_ENTRIES;
  const unavailableProviders = (listData?.providers ?? []).filter(
    (provider) => !provider.configured,
  );
  const firstLoad = listData === null && listQuery.isPending;
  const searching = typedQuery !== sentQuery || (sentCursors === null && listQuery.isPending);

  const newIssueControl =
    repositories.length === 1 ? (
      <Button onClick={() => openExternal(repositories[0]!.newIssueUrl)}>
        New issue
        <ExternalLinkIcon aria-hidden />
      </Button>
    ) : (
      <Menu>
        <MenuTrigger render={<Button disabled={repositories.length === 0} />}>
          New issue
          <ChevronDownIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end" className="w-72">
          <MenuGroupLabel>Choose a repository</MenuGroupLabel>
          {repositories.map((repository) => (
            <MenuItem
              key={`${repository.environmentId}:${repository.host}:${repository.repository}`}
              onClick={() => openExternal(repository.newIssueUrl)}
            >
              <span className="min-w-0">
                <span className="block truncate">{repository.repository}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {repository.projectTitle}
                </span>
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    );

  const sentinelRef = useRef<HTMLDivElement>(null);
  const issueCount = issues.length;
  const showingDetail = selectedRef !== null;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    // Retained rows leave the boundary visible after a failed page, so failures deliberately
    // disarm loading until Retry. Empty results do not walk every host page on their own.
    if (
      sentinel === null ||
      showingDetail ||
      issueCount === 0 ||
      !canContinue ||
      listQuery.isPending ||
      pageHasErrors
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setPage({ key: filterKey, cursors: nextCursors });
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    canContinue,
    filterKey,
    issueCount,
    listQuery.isPending,
    nextCursors,
    pageHasErrors,
    showingDetail,
  ]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header
          className={cn(
            "drag-region flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 px-3 sm:px-5 wco:pr-[var(--workspace-native-controls-inset)]",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <WorkspaceBreadcrumb ariaLabel="Issues breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Issues</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {showingDetail ? null : (
            <Button
              aria-label="Refresh issues"
              size="icon-sm"
              variant="ghost"
              onClick={() => void refreshFromHost()}
            >
              <RefreshCwIcon
                className={cn("size-4", (invalidating || listQuery.isPending) && "animate-spin")}
              />
            </Button>
          )}
        </header>

        <main className="topbar-scroll-fade min-h-0 flex-1 overflow-y-auto">
          {selectedRef !== null ? (
            detailQuery.data !== null ? (
              <IssueDetail
                detail={detailQuery.data}
                environmentId={selectedRef.environmentId}
                activity={activityQuery.data}
                activityPending={activityQuery.isPending && activityQuery.data === null}
                activityError={activityQuery.data === null ? activityQuery.error : null}
                refreshing={invalidating}
                onBack={clearSelection}
                onRefresh={() => void refreshFromHost()}
                onRetryActivity={activityQuery.refresh}
              />
            ) : detailQuery.error !== null ? (
              <Empty className="min-h-96">
                <EmptyMedia variant="icon">
                  <CircleDotIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>Issue unavailable</EmptyTitle>
                  <EmptyDescription>{detailQuery.error}</EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={clearSelection}>
                  Back to issues
                </Button>
              </Empty>
            ) : (
              <DetailGhost />
            )
          ) : (
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 pb-12 sm:px-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-heading text-xl font-semibold">All issues</h2>
                {newIssueControl}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label="Search issues"
                    className="[&_input]:pl-9"
                    placeholder="Search issues"
                    type="search"
                    value={search.q ?? ""}
                    onChange={(event) => updateSearch({ q: event.target.value || undefined })}
                  />
                </div>
                <Menu>
                  <MenuTrigger render={<Button variant="outline" />}>
                    <ListFilterIcon aria-hidden />
                    {scopedProject ? (
                      <ProjectFavicon
                        environmentId={scopedProject.environmentId}
                        cwd={scopedProject.workspaceRoot}
                        faviconPath={scopedProject.faviconPath}
                        className="size-4"
                      />
                    ) : null}
                    {scopedProject?.title ?? "All projects"}
                    <ChevronDownIcon aria-hidden />
                  </MenuTrigger>
                  <MenuPopup align="end" className="w-72">
                    <MenuRadioGroup
                      value={
                        scopedProject
                          ? JSON.stringify([scopedProject.environmentId, scopedProject.id])
                          : "*"
                      }
                      onValueChange={(value) => {
                        if (value === "*") {
                          setRememberedProjectScope(null);
                          updateSearch({ projectId: undefined, environmentId: undefined });
                          return;
                        }
                        const [environmentId, projectId] = JSON.parse(value) as [
                          EnvironmentId,
                          ProjectId,
                        ];
                        setRememberedProjectScope({ environmentId, projectId });
                        updateSearch({ projectId, environmentId });
                      }}
                    >
                      <MenuRadioItem value="*">All projects</MenuRadioItem>
                      <MenuSeparator />
                      {projects.map((project) => (
                        <MenuRadioItem
                          key={`${project.environmentId}:${project.id}`}
                          value={JSON.stringify([project.environmentId, project.id])}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <ProjectFavicon
                              environmentId={project.environmentId}
                              cwd={project.workspaceRoot}
                              faviconPath={project.faviconPath}
                              className="size-4"
                            />
                            <span className="min-w-0">
                              <span className="block truncate">{project.title}</span>
                              {capableEnvironments.length > 1 ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {environmentLabels.get(project.environmentId)}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuPopup>
                </Menu>
              </div>

              <section
                aria-label="Issue list"
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
                  {(
                    [
                      ["open", "Open", CircleDotIcon],
                      ["closed", "Closed", CheckCircle2Icon],
                      ["all", "All", LayersIcon],
                    ] as const
                  ).map(([state, label, Icon]) => (
                    <Button
                      key={state}
                      aria-pressed={search.state === state}
                      size="sm"
                      variant={search.state === state ? "secondary" : "ghost-muted"}
                      onClick={() => updateSearch({ state })}
                    >
                      <Icon
                        aria-hidden
                        className={
                          state === "open"
                            ? "text-success"
                            : state === "closed"
                              ? "text-violet-600 dark:text-violet-300/90"
                              : undefined
                        }
                      />
                      {label}
                    </Button>
                  ))}
                  <div className="min-w-0 flex-1" />
                  {searching && typedQuery ? (
                    <span className="px-2 text-xs text-muted-foreground">Searching…</span>
                  ) : null}
                </div>

                {!capabilityKnown ? (
                  <IssueListGhost />
                ) : capableEnvironments.length === 0 ? (
                  <Empty className="min-h-80">
                    <EmptyMedia variant="icon">
                      <CircleDotIcon />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>Issues unavailable</EmptyTitle>
                      <EmptyDescription>
                        Update your Vetra Code servers to browse issues.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : firstLoad ? (
                  <IssueListGhost />
                ) : listQuery.error !== null && listData === null ? (
                  <Empty className="min-h-80">
                    <EmptyMedia variant="icon">
                      <CircleDotIcon />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>Issues could not be loaded</EmptyTitle>
                      <EmptyDescription>{listQuery.error}</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={() => void retryCurrentPage()}>
                      Retry
                    </Button>
                  </Empty>
                ) : issues.length === 0 ? (
                  <Empty className="min-h-80">
                    <EmptyMedia variant="icon">
                      <CircleDotIcon />
                    </EmptyMedia>
                    <EmptyHeader>
                      <EmptyTitle>
                        {typedQuery ? "No matching issues" : "No issues found"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {unavailableProviders[0]?.detail ??
                          listQuery.error ??
                          (projectsKnown && projects.length === 0
                            ? "Add a project with a source-control remote to browse its issues."
                            : "Try another state, project, or search phrase.")}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  issues.map((entry) => (
                    <IssueRow
                      key={issueEntryKey(entry)}
                      entry={entry}
                      {...(environmentLabels.get(entry.environmentId) === undefined
                        ? {}
                        : { environmentLabel: environmentLabels.get(entry.environmentId)! })}
                      onSelect={selectIssue}
                      selected={false}
                      showEnvironment={capableEnvironments.length > 1}
                    />
                  ))
                )}
              </section>

              {unavailableProviders.length > 0 ||
              (listData?.errors.length ?? 0) > 0 ||
              pageHasErrors ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <Badge variant="warning">Partial results</Badge>
                  <span className="min-w-0 flex-1">
                    {unavailableProviders[0]?.detail ??
                      listQuery.error ??
                      listQuery.data?.errors[0]?.message ??
                      "Some repositories could not be read."}
                  </span>
                  {pageHasErrors ? (
                    <Button
                      disabled={invalidating || listQuery.isPending}
                      size="xs"
                      variant="outline"
                      onClick={() => void retryCurrentPage()}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {issueCount > 0 && (canContinue || loadingMore) ? (
                <div
                  ref={sentinelRef}
                  aria-live="polite"
                  className="flex min-h-7 items-center justify-center py-2 text-xs text-muted-foreground"
                >
                  {loadingMore ? (
                    <span className="flex items-center gap-2">
                      <LoaderIcon aria-hidden className="size-3.5 animate-spin" />
                      Loading more issues
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </SidebarInset>
  );
}
