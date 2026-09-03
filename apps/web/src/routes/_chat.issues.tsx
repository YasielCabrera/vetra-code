import { scopeThreadRef } from "@vetra-code/client-runtime/environment";
import {
  ISSUE_ASSIGNEE_NOBODY,
  ISSUE_ASSIGNEE_VIEWER,
  isIssueAssigneeFilter,
  ThreadId,
  type EnvironmentId,
  type IssueActor,
  type IssueListCursors,
  type IssueListInput,
  type IssueListState,
  type ProjectId,
  type SourceControlProviderKind,
} from "@vetra-code/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  LayersIcon,
  LoaderIcon,
  MonitorIcon,
  RefreshCwIcon,
  ServerIcon,
  UserRoundIcon,
  UserRoundXIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PanelLayoutControls } from "../components/chat/PanelLayoutControls";
import { IssueDetailPanel } from "../components/issue/IssueDetailPanel";
import { normalizeIssueExternalUrl } from "../components/issue/issueExternalUrl";
import {
  mergeKnownIssueAssignees,
  NO_KNOWN_ISSUE_ASSIGNEES,
  type KnownIssueAssignees,
} from "../components/issue/issueAssignees.logic";
import { IssueListGhost } from "../components/issue/IssueGhosts";
import {
  IssueFiltersMenu,
  IssueSearchInput,
  issueProjectKey,
} from "../components/issue/IssueListFilters";
import {
  IssueListEmptyState,
  IssuesUnavailableState,
} from "../components/issue/IssueListEmptyState";
import { mergeIssueListPage } from "../components/issue/issueListPagination";
import { IssueRow } from "../components/issue/IssueRow";
import { assignProjectsToEnvironments } from "../components/pullRequest/pullRequestProjectAssignment.logic";
import { SourceControlActorAvatar } from "../components/SourceControlActorAvatar";
import { RightPanelTabs, type IssueTabStatus } from "../components/RightPanelTabs";
import { CompactFilterMenu, ExpandableSearch } from "../components/sourceControl/ListPageChrome";
import {
  sourceControlHostLabel,
  type ListFilterOption,
} from "../components/sourceControl/ListFilterMenu";
import { rememberIssueFilters } from "../components/sourceControl/listFilterMemory";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import { Menu, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { SidebarInset } from "../components/ui/sidebar";
import { isElectron } from "../env";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { readLocalApi } from "../localApi";
import {
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  updateIssueTabStatus,
  useRightPanelStore,
  type IssueSurface,
} from "../rightPanelStore";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";
import {
  issueEntryKey,
  useIssueList,
  type EnvironmentIssueEntry,
  type IssueEnvironmentQueryTarget,
  type MergedIssueList,
} from "../state/issues";
import { issueEnvironment } from "../state/issues";
import { useDebouncedValue } from "../state/queries";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";

export interface IssuesSearch {
  readonly state: IssueListState;
  readonly q?: string;
  /**
   * Narrows the list to one host, named as the host itself: two GitHub installs are two
   * accounts, and their shared provider kind cannot tell them apart. Absent means every host.
   */
  readonly host?: string;
  /**
   * Narrows to one person's issues, as `IssueAssigneeFilter` spells it: `@me` for whoever the
   * server is signed in as, `@none` for the unassigned, or one account name.
   */
  readonly assignee?: string;
  /** Narrows the list to one server. Absent means every connected one. */
  readonly environmentId?: EnvironmentId;
  /** Scopes the list. Separate from the selection so one cannot silently change the other. */
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

/** The narrowings the selection is not part of, cleared together when a tab closes. */
const CLEARED_SELECTION = {
  selectedEnvironmentId: undefined,
  selectedProjectId: undefined,
  repository: undefined,
  number: undefined,
} satisfies IssuesSearchPatch;

const SEARCH_DEBOUNCE_MS = 250;
const ISSUE_PAGE_SIZE = 99;
const EMPTY_ENVIRONMENT_CURSORS: Readonly<Record<string, IssueListCursors>> = {};
const EMPTY_ISSUE_ENTRIES: ReadonlyArray<EnvironmentIssueEntry> = [];

/** The list owns one workspace-level right panel rather than borrowing a real thread's. */
const ISSUES_PANEL_ID = ThreadId.make("issues-panel");
/**
 * A fixed sentinel, not a real server: the panel is one workspace-level surface list (each
 * surface already carries the server it was read from), so its store key must not move when a
 * capable server disconnects or reconnects. Real environment ids are server-generated UUIDs, so
 * this string can never collide with one.
 */
const ISSUES_PANEL_ENVIRONMENT_ID = "issues-panel" as EnvironmentId;
const EMPTY_PREVIEW_SESSIONS = {};
const EMPTY_PREVIEW_DESKTOP_STATE = {};
const EMPTY_TERMINAL_LABELS = new Map<string, string>();
const EMPTY_PENDING_SURFACES = new Set<string>();

const STATE_TABS = [
  { value: "open", label: "Open", Icon: CircleDotIcon },
  { value: "closed", label: "Closed", Icon: CheckCircle2Icon },
  { value: "all", label: "All", Icon: LayersIcon },
] as const satisfies ReadonlyArray<ListFilterOption<IssueListState>>;

/**
 * A person's face in the shape a filter option's icon takes. Built here rather than inline, so
 * one identity per actor survives the render the options are memoized across.
 */
function actorFilterIcon(actor: IssueActor) {
  return function ActorFilterIcon({ className }: { className?: string }) {
    return <SourceControlActorAvatar actor={actor} className={className} />;
  };
}

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): IssuesSearch => ({
    state: raw.state === "all" || raw.state === "closed" ? raw.state : "open",
    ...(typeof raw.q === "string" && raw.q.trim() ? { q: raw.q.slice(0, 200) } : {}),
    ...(typeof raw.host === "string" && raw.host.trim() ? { host: raw.host.slice(0, 200) } : {}),
    // Dropped rather than carried when it is not a value the listing would accept: a hand-edited
    // query string reaches the page before it reaches the schema that refuses it.
    ...(typeof raw.assignee === "string" && isIssueAssigneeFilter(raw.assignee)
      ? { assignee: raw.assignee.trim() }
      : {}),
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

function IssuesRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { environments } = useEnvironments();
  const allProjects = useProjects();
  const projectsKnown = useAllEnvironmentShellsBootstrapped();
  const capableEnvironments = useMemo(
    () =>
      environments
        .filter((environment) => environment.serverConfig?.environment.capabilities.issues === true)
        .toSorted((left, right) => left.environmentId.localeCompare(right.environmentId)),
    [environments],
  );
  const capabilityKnown = environments.some((environment) => environment.serverConfig !== null);
  // The server the URL asks for, kept only while it is one the page could read: a link naming a
  // server this workspace no longer has falls back to all of them rather than to nothing.
  const scopedEnvironmentId =
    capableEnvironments.find((environment) => environment.environmentId === search.environmentId)
      ?.environmentId ?? null;
  // Every server that could answer, before the URL's server scope narrows them. A selection is
  // resolved against these: a link that scopes the list to one server and selects an issue on
  // another still opens the issue it names rather than nothing at all.
  const allCapableIds = useMemo(
    () => capableEnvironments.map((environment) => environment.environmentId),
    [capableEnvironments],
  );
  const capableIds = useMemo(
    () =>
      allCapableIds.filter(
        (environmentId) => scopedEnvironmentId === null || environmentId === scopedEnvironmentId,
      ),
    [allCapableIds, scopedEnvironmentId],
  );
  const issuesSupported = capableIds.length > 0;
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
  const scopedProject = projects.find(
    (project) =>
      project.id === search.projectId &&
      (search.environmentId === undefined || project.environmentId === search.environmentId),
  );
  const queryEnvironmentIds = useMemo(
    () =>
      capableIds.filter(
        (environmentId) =>
          scopedProject === undefined || environmentId === scopedProject.environmentId,
      ),
    [capableIds, scopedProject],
  );
  // Two machines can hold the same repository, so a title the workspace carries twice is told
  // apart by the environment it lives on rather than left as two identical rows.
  const scopedProjects = useMemo(() => {
    const titleCounts = new Map<string, number>();
    for (const project of projects) {
      titleCounts.set(project.title, (titleCounts.get(project.title) ?? 0) + 1);
    }
    return projects
      .map((project) => ({
        id: project.id,
        environmentId: project.environmentId,
        title:
          (titleCounts.get(project.title) ?? 0) > 1
            ? `${project.title} · ${environmentLabels.get(project.environmentId) ?? project.environmentId}`
            : project.title,
        workspaceRoot: project.workspaceRoot,
      }))
      .toSorted((left, right) => left.title.localeCompare(right.title));
  }, [environmentLabels, projects]);
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
            ...(search.assignee === undefined ? {} : { assignee: search.assignee }),
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
        ...(search.assignee === undefined ? {} : { assignee: search.assignee }),
        ...(sentQuery ? { query: sentQuery } : {}),
      };
      return [{ environmentId, input }];
    });
  }, [
    projects,
    projectsKnown,
    queryEnvironmentIds,
    scopedProject,
    search.assignee,
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

  // One panel for the page rather than one per server: the surfaces carry the server they were
  // read from, so tabs from two of them sit side by side instead of replacing each other.
  const rightPanelRef = useMemo(
    () =>
      capableEnvironments.length === 0
        ? null
        : scopeThreadRef(ISSUES_PANEL_ENVIRONMENT_ID, ISSUES_PANEL_ID),
    [capableEnvironments.length],
  );
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, rightPanelRef),
  );
  const selectedRightPanelSurface = useRightPanelStore((state) =>
    selectSelectedRightPanelSurface(state.byThreadKey, rightPanelRef),
  );
  const selectedIssueSurface =
    selectedRightPanelSurface?.kind === "issue" ? selectedRightPanelSurface : null;
  const activeIssueSurface = rightPanelState.isOpen ? selectedIssueSurface : null;
  const [issueTabStatuses, setIssueTabStatuses] = useState<Record<string, IssueTabStatus>>({});
  // Keyed by the surface the panel is showing rather than by a key rebuilt from the status: a
  // surface opened from this page carries the environment its row was listed under, and a key
  // assembled from the issue alone would never name that surface back.
  const activeIssueSurfaceId = activeIssueSurface?.id;
  const handleIssueTabStatusChange = useCallback(
    (status: IssueTabStatus) => {
      const id = activeIssueSurfaceId;
      if (id === undefined) return;
      setIssueTabStatuses((current) => updateIssueTabStatus(current, id, status));
    },
    [activeIssueSurfaceId],
  );

  const invalidate = useAtomCommand(issueEnvironment.invalidate, { reportFailure: false });
  const [invalidating, setInvalidating] = useState(false);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const refreshing = invalidating || listQuery.isPending;

  const refreshFromHost = async () => {
    setPage({ key: filterKey, cursors: null });
    setInvalidating(true);
    try {
      // Every environment the page is reading, since what the reader pressed refresh for is the
      // list in front of them rather than whichever machine happens to be first.
      await Promise.all(
        queryEnvironmentIds.map((environmentId) => invalidate({ environmentId, input: {} })),
      );
    } finally {
      setInvalidating(false);
    }
    baselineQuery.refresh();
    listQuery.refresh();
    setDetailRefreshToken((token) => token + 1);
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

  // The list goes stale the same way the panel does: somebody opens an issue, closes one, adds a
  // label. So it reads again on the way back to the window, and periodically while somebody is
  // reading it. Those reads go through the server's cache and stop when the reader stops.
  //
  // Only while the reader is on the first page. Continuations are cursored, so the only way to
  // re-read everything on screen is to go back to page one — and doing that on a timer would
  // take the rows out from under somebody who has scrolled through five of them. Pressing
  // Refresh still does it, because that is somebody asking.
  useLiveRefresh(() => baselineQuery.refresh(), {
    enabled: issuesSupported && sentCursors === null,
  });

  const selectSurfaceInUrl = (surface: IssueSurface | null) =>
    updateSearch(
      surface === null
        ? CLEARED_SELECTION
        : {
            repository: surface.repository,
            number: surface.number,
            selectedProjectId: surface.projectId as ProjectId,
            ...(surface.environmentId === undefined
              ? {}
              : { selectedEnvironmentId: surface.environmentId as EnvironmentId }),
          },
    );

  // Stable so the memoized rows can skip re-rendering when the list around them changes.
  const selectIssue = useCallback(
    (entry: EnvironmentIssueEntry) => {
      // The surface carries the row's own server, which is what its detail reads and acts on.
      if (rightPanelRef === null) return;
      useRightPanelStore.getState().openIssue(rightPanelRef, entry);
      updateSearch({
        repository: entry.repository,
        number: entry.number,
        selectedProjectId: entry.projectId,
        selectedEnvironmentId: entry.environmentId,
      });
    },
    [rightPanelRef, updateSearch],
  );

  // A link that arrived already naming an issue opens it as a tab, the same as a row press.
  const linkedSelection = useMemo(() => {
    if (
      search.selectedEnvironmentId === undefined ||
      search.selectedProjectId === undefined ||
      search.repository === undefined ||
      search.number === undefined ||
      !allCapableIds.includes(search.selectedEnvironmentId)
    ) {
      return null;
    }
    return {
      environmentId: search.selectedEnvironmentId as string,
      projectId: search.selectedProjectId as string,
      repository: search.repository,
      number: search.number,
    };
  }, [
    allCapableIds,
    search.number,
    search.repository,
    search.selectedEnvironmentId,
    search.selectedProjectId,
  ]);
  useEffect(() => {
    if (!issuesSupported || rightPanelRef === null || linkedSelection === null) return;
    useRightPanelStore.getState().openIssue(rightPanelRef, linkedSelection);
  }, [issuesSupported, linkedSelection, rightPanelRef]);

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

  // The provider list is the workspace's hosts, not the filtered ones, so switching to a host
  // cannot make the switcher that got you there disappear.
  const [hosts, setHosts] = useState<MergedIssueList["providers"]>([]);
  useEffect(() => {
    const answered = listData;
    if (answered === null) return;
    setHosts((previous) =>
      search.host === undefined || previous.length === 0 ? answered.providers : previous,
    );
  }, [listData, search.host]);
  const hostMenuOptions: ReadonlyArray<ListFilterOption<string>> = useMemo(() => {
    const byHost = new Map<string, { host: string; kind: SourceControlProviderKind }>();
    for (const provider of hosts) {
      if (!byHost.has(provider.host)) byHost.set(provider.host, provider);
    }
    const entries = [...byHost.values()];
    return [
      { value: "", label: "All hosts", Icon: LayersIcon },
      ...entries.map((entry) => {
        // Once the summaries have arrived they carry whether each host could be read.
        const summary = hosts.find((provider) => provider.host === entry.host);
        return {
          value: entry.host,
          label: sourceControlHostLabel(entries, entry),
          Icon: getSourceControlPresentationForKind(entry.kind).Icon,
          ...(summary === undefined || summary.configured
            ? {}
            : { unavailable: summary.detail ?? "This host could not be read." }),
        };
      }),
    ];
  }, [hosts]);
  // The people the assignee group offers come from the issues on screen: every row names who it
  // is assigned to, so the workspace's own rows are the only list of them that costs nothing to
  // read. Keyed by every narrowing except the assignee itself, so filtering to one person does
  // not take everyone else out of the menu that got you there — while switching project, state
  // or host does, since those people may have nothing to do with what is being looked at now.
  const assigneeScopeKey = useMemo(
    () =>
      JSON.stringify(
        baseTargets.map((target) => {
          // Dropped rather than overwritten: the input is built key by key, so setting this one
          // to a placeholder would move it in the object and change the string for two scopes
          // that are the same scope.
          const { assignee: _assignee, ...rest } = target.input;
          return { environmentId: target.environmentId, input: rest };
        }),
      ),
    [baseTargets],
  );
  const [knownAssignees, setKnownAssignees] =
    useState<KnownIssueAssignees>(NO_KNOWN_ISSUE_ASSIGNEES);
  useEffect(() => {
    if (listData === null) return;
    setKnownAssignees((held) => mergeKnownIssueAssignees(held, assigneeScopeKey, listData.entries));
  }, [assigneeScopeKey, listData]);
  const assigneeMenuOptions: ReadonlyArray<ListFilterOption<string>> = useMemo(() => {
    const people = knownAssignees.actors;
    // A link can name somebody none of the loaded rows do. Without them the group would show
    // nothing checked while the list is plainly narrowed to their issues.
    const linked =
      search.assignee === undefined ||
      search.assignee.startsWith("@") ||
      people.some((actor) => actor.login.toLowerCase() === search.assignee?.toLowerCase())
        ? null
        : ({ login: search.assignee, name: null, avatarUrl: null } satisfies IssueActor);
    return [
      { value: "", label: "Anyone", Icon: LayersIcon },
      { value: ISSUE_ASSIGNEE_VIEWER, label: "Me", Icon: UserRoundIcon },
      { value: ISSUE_ASSIGNEE_NOBODY, label: "Unassigned", Icon: UserRoundXIcon },
      ...[...(linked === null ? [] : [linked]), ...people].map((actor) => ({
        value: actor.login,
        label: actor.login,
        Icon: actorFilterIcon(actor),
      })),
    ];
  }, [knownAssignees.actors, search.assignee]);
  // The same shape the host group takes, so the two read as one control. A local connection
  // wears the screen it is on; every other server wears a server.
  const serverMenuOptions: ReadonlyArray<ListFilterOption<string>> = [
    { value: "", label: "All servers", Icon: LayersIcon },
    ...capableEnvironments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
      Icon: environment.displayUrl === null ? MonitorIcon : ServerIcon,
    })),
  ];
  /** Reported per project rather than as a count, so the reader can see which one it was. */
  const unavailableProjects = useMemo(
    () =>
      new Map(
        (listData?.errors ?? []).map(
          (error) =>
            [
              issueProjectKey({ id: error.projectId, environmentId: error.environmentId }),
              error.message,
            ] as const,
        ),
      ),
    [listData?.errors],
  );

  const newIssueControl =
    repositories.length === 1 ? (
      <Button
        className="shrink-0"
        variant="outline"
        onClick={() => openExternal(repositories[0]!.newIssueUrl)}
      >
        New issue
        <ExternalLinkIcon aria-hidden />
      </Button>
    ) : (
      <Menu>
        <MenuTrigger
          render={
            <Button className="shrink-0" variant="outline" disabled={repositories.length === 0} />
          }
        >
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
  useEffect(() => {
    const sentinel = sentinelRef.current;
    // Retained rows leave the boundary visible after a failed page, so failures deliberately
    // disarm loading until Retry. Empty results do not walk every host page on their own.
    if (
      sentinel === null ||
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
  }, [canContinue, filterKey, issueCount, listQuery.isPending, nextCursors, pageHasErrors]);

  const updateListScope = (patch: IssuesSearchPatch) => {
    if (rightPanelRef !== null) {
      // Hide the old selection while retaining peer issue tabs, the same as the pull-request
      // list: narrowing the list is not a reason to throw away what is open beside it.
      useRightPanelStore.getState().close(rightPanelRef);
    }
    // Deliberate narrowings only, which is why this sits here rather than on the search itself:
    // a link that opens one issue names its own filters, and following it should not rewrite
    // what the reader last chose to see.
    rememberIssueFilters(withSearchPatch(search, patch));
    updateSearch({ ...patch, ...CLEARED_SELECTION });
  };

  const searchInput = (
    <IssueSearchInput
      value={search.q ?? ""}
      busy={typedQuery.length > 0 && searching}
      onChange={(query) => updateSearch({ q: query || undefined })}
    />
  );
  const filtersMenu = (
    <IssueFiltersMenu
      state={search.state}
      stateOptions={STATE_TABS}
      onState={(state) => updateListScope({ state })}
      assignee={search.assignee}
      assigneeOptions={assigneeMenuOptions}
      onAssignee={(assignee) => updateListScope({ assignee })}
      host={search.host}
      hostOptions={hostMenuOptions}
      onHost={(host) => updateListScope({ host })}
      server={scopedEnvironmentId ?? undefined}
      serverOptions={serverMenuOptions}
      // Narrowing to one server drops a project scope belonging to another, which would
      // otherwise narrow the list to nothing with no visible filter to explain it.
      onServer={(server) => updateListScope({ environmentId: server, projectId: undefined })}
      projects={scopedProjects}
      projectId={scopedProject?.id}
      projectEnvironmentId={scopedProject?.environmentId}
      unavailable={unavailableProjects}
      onProject={(projectId, environmentId) =>
        updateListScope(
          projectId === undefined
            ? { projectId: undefined, environmentId: scopedEnvironmentId ?? undefined }
            : { projectId, environmentId },
        )
      }
    />
  );

  const selected = activeIssueSurface;
  const listBody = (
    <>
      {!capabilityKnown ? (
        <IssueListGhost rows={7} />
      ) : !issuesSupported ? (
        <IssuesUnavailableState
          title="Issues unavailable"
          error="Update your Vetra Code servers to browse issues."
        />
      ) : firstLoad ? (
        <IssueListGhost rows={7} />
      ) : listQuery.error !== null && listData === null ? (
        <IssuesUnavailableState error={listQuery.error} onRetry={() => void retryCurrentPage()} />
      ) : issues.length === 0 ? (
        <IssueListEmptyState
          hasProjects={!projectsKnown || projects.length > 0}
          refreshing={refreshing}
          onRefresh={() => void refreshFromHost()}
          query={typedQuery}
          filtered={
            search.state !== "open" ||
            search.assignee !== undefined ||
            scopedProject !== undefined ||
            search.host !== undefined ||
            scopedEnvironmentId !== null
          }
          searching={typedQuery.length > 0 && searching}
          onClearQuery={() => updateSearch({ q: undefined })}
        />
      ) : (
        <div className="space-y-0.5">
          {issues.map((entry) => (
            <IssueRow
              key={issueEntryKey(entry)}
              entry={entry}
              {...(capableEnvironments.length > 1 &&
              environmentLabels.get(entry.environmentId) !== undefined
                ? { environmentLabel: environmentLabels.get(entry.environmentId)! }
                : {})}
              onSelect={selectIssue}
              selected={
                selected?.environmentId === entry.environmentId &&
                selected.repository === entry.repository &&
                selected.number === entry.number
              }
              showEnvironment={capableEnvironments.length > 1}
            />
          ))}
        </div>
      )}

      {unavailableProviders.length > 0 || (listData?.errors.length ?? 0) > 0 || pageHasErrors ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {unavailableProviders[0]?.detail ??
              listQuery.error ??
              listData?.errors[0]?.message ??
              "Some repositories could not be read."}
          </span>
          {pageHasErrors ? (
            <Button
              disabled={refreshing}
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
    </>
  );

  const toggleRightPanel = () => {
    if (rightPanelRef === null) return;
    if (rightPanelState.isOpen) {
      useRightPanelStore.getState().close(rightPanelRef);
      updateSearch(CLEARED_SELECTION);
      return;
    }
    if (selectedIssueSurface === null) return;
    useRightPanelStore.getState().show(rightPanelRef);
    selectSurfaceInUrl(selectedIssueSurface);
  };
  const openPanelControls = (
    <div
      // The bare workspace-titlebar-controls inset plus mr-px: the same anchor the thread view's
      // controls and the sidebar trigger use, so every titlebar cluster sits one shared inset
      // from its edge.
      className="absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]"
      data-workspace-titlebar-controls
    >
      <PanelLayoutControls
        showTerminalControl={false}
        terminalAvailable={false}
        terminalOpen={false}
        terminalShortcutLabel={null}
        rightPanelAvailable={selectedIssueSurface !== null}
        rightPanelOpen={rightPanelState.isOpen}
        rightPanelShortcutLabel={null}
        rightPanelUnavailableLabel="Select an issue first"
        liveAgentCount={0}
        onToggleTerminal={() => undefined}
        onToggleRightPanel={toggleRightPanel}
      />
    </div>
  );

  const activateSurface = (surface: IssueSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().activateSurface(rightPanelRef, surface.id);
    selectSurfaceInUrl(surface);
  };
  const closeSurface = (surface: IssueSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeSurface(rightPanelRef, surface.id);
    const next = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      rightPanelRef,
    );
    selectSurfaceInUrl(next?.kind === "issue" ? next : null);
  };
  const closeOtherSurfaces = (surface: IssueSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeOtherSurfaces(rightPanelRef, surface.id);
    selectSurfaceInUrl(surface);
  };
  const closeSurfacesToRight = (surface: IssueSurface) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeSurfacesToRight(rightPanelRef, surface.id);
    const next = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      rightPanelRef,
    );
    selectSurfaceInUrl(next?.kind === "issue" ? next : null);
  };
  const closeAllSurfaces = () => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().closeAllSurfaces(rightPanelRef);
    selectSurfaceInUrl(null);
  };
  const moveSurface = (surfaceId: string, targetSurfaceId: string) => {
    if (rightPanelRef === null) return;
    useRightPanelStore.getState().moveSurface(rightPanelRef, surfaceId, targetSurfaceId);
  };

  // The open tab names its own server; nothing else can, since the list spans every connected one.
  const panelEnvironmentId = (activeIssueSurface?.environmentId ?? null) as EnvironmentId | null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="relative flex min-h-0 flex-1">
        {issuesSupported && rightPanelState.isOpen ? openPanelControls : null}
        <IssuesColumn
          refreshing={refreshing}
          onRefresh={() => void refreshFromHost()}
          searchValue={search.q ?? ""}
          state={search.state}
          assignee={search.assignee}
          assigneeMenuOptions={assigneeMenuOptions}
          host={search.host}
          hostMenuOptions={hostMenuOptions}
          onState={(state) => updateListScope({ state })}
          onAssignee={(assignee) => updateListScope({ assignee })}
          onHost={(host) => updateListScope({ host })}
          searchInput={searchInput}
          filtersMenu={filtersMenu}
          newIssueControl={newIssueControl}
          // Footprint reserve while the panel is closed: the toggle itself stays mounted at the
          // fixed titlebar inset in both states so it cannot move on toggle, and this spacer
          // keeps the header's own content from sliding underneath it.
          rightPanelControl={
            !issuesSupported || rightPanelState.isOpen ? null : (
              <span aria-hidden className="w-7 shrink-0 sm:w-5" />
            )
          }
          // While the panel is closed the strip lives inside the header: a no-drag descendant
          // beats the header's desktop drag-region, where a floating sibling loses (app-region
          // hit-testing ignores z-index). Open, it moves back out to the route container, which
          // spans the panel too, so the toggle keeps one fixed top-right anchor.
          titlebarControls={issuesSupported && !rightPanelState.isOpen ? openPanelControls : null}
          rightPanelOpen={rightPanelState.isOpen}
          listBody={listBody}
        />

        {rightPanelState.isOpen && activeIssueSurface && panelEnvironmentId !== null ? (
          <RightPanelTabs
            mode="inline"
            environmentId={panelEnvironmentId}
            widthStorageKey="vetra:issue-panel-width"
            // Default to roughly half the viewport: the issue list needs more room than a chat,
            // so the 540px chat-preview default squashes it. SSR has no window, so fall back to
            // a reasonable width.
            defaultWidth={typeof window === "undefined" ? 640 : Math.floor(window.innerWidth / 2)}
            surfaces={rightPanelState.surfaces}
            activeSurfaceId={activeIssueSurface.id}
            pendingSurfaceIds={EMPTY_PENDING_SURFACES}
            previewSessions={EMPTY_PREVIEW_SESSIONS}
            desktopByTabId={EMPTY_PREVIEW_DESKTOP_STATE}
            terminalLabelsById={EMPTY_TERMINAL_LABELS}
            onActivate={(surface) => {
              if (surface.kind === "issue") activateSurface(surface);
            }}
            onReorder={moveSurface}
            onCloseSurface={(surface) => {
              if (surface.kind === "issue") closeSurface(surface);
            }}
            onCloseOtherSurfaces={(surface) => {
              if (surface.kind === "issue") closeOtherSurfaces(surface);
            }}
            onCloseSurfacesToRight={(surface) => {
              if (surface.kind === "issue") closeSurfacesToRight(surface);
            }}
            onCloseAllSurfaces={closeAllSurfaces}
            onCopyFilePath={() => undefined}
            onAddBrowser={() => undefined}
            onAddBrowserInProfile={() => undefined}
            onAddTerminal={() => undefined}
            onAddDiff={() => undefined}
            onAddFiles={() => undefined}
            onAddPullRequest={() => undefined}
            onAddAgents={() => undefined}
            onAddPowerhouse={() => undefined}
            browserAvailable={false}
            terminalAvailable={false}
            diffAvailable={false}
            filesAvailable={false}
            pullRequestAvailable={false}
            agentsAvailable={false}
            powerhouseAvailable={false}
            liveAgentCount={0}
            issueStatuses={issueTabStatuses}
          >
            <IssueDetailPanel
              key={activeIssueSurface.id}
              environmentId={panelEnvironmentId}
              reference={{
                projectId: activeIssueSurface.projectId as ProjectId,
                repository: activeIssueSurface.repository,
                number: activeIssueSurface.number,
              }}
              refreshToken={detailRefreshToken}
              // Assigning somebody changes the row this panel was opened from, so the list
              // behind it is out of date the moment the host takes the action.
              onActed={() => {
                setPage({ key: filterKey, cursors: null });
                baselineQuery.refresh();
              }}
              onStateChange={handleIssueTabStatusChange}
            />
          </RightPanelTabs>
        ) : null}
      </div>
    </SidebarInset>
  );
}

/**
 * The issue list column. The full controls live at the top of the scroll flow; once they scroll
 * away, the title transforms into the scope itself — "Issues / Open ▾" — where each segment is
 * the menu for that filter, and a folded search sits on the right. Scrolled back up, the topbar
 * returns to the plain title. The topbar is the window drag region throughout; its interactive
 * children opt out through the `.drag-region` descendant rules.
 */
function IssuesColumn({
  refreshing,
  onRefresh,
  searchValue,
  state,
  assignee,
  assigneeMenuOptions,
  host,
  hostMenuOptions,
  onState,
  onAssignee,
  onHost,
  searchInput,
  filtersMenu,
  newIssueControl,
  rightPanelControl,
  titlebarControls,
  rightPanelOpen,
  listBody,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  searchValue: string;
  state: IssueListState;
  assignee: string | undefined;
  assigneeMenuOptions: ReadonlyArray<ListFilterOption<string>>;
  host: string | undefined;
  hostMenuOptions: ReadonlyArray<ListFilterOption<string>>;
  onState: (state: IssueListState) => void;
  onAssignee: (assignee: string | undefined) => void;
  onHost: (host: string | undefined) => void;
  searchInput: ReactNode;
  filtersMenu: ReactNode;
  newIssueControl: ReactNode;
  rightPanelControl: ReactNode;
  titlebarControls: ReactNode;
  rightPanelOpen: boolean;
  listBody: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(entry ? !entry.isIntersecting : false),
      { root: scrollRef.current },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  // Typing into the topbar search narrows the list, and a short enough list un-scrolls the
  // page — which dissolves the condensed topbar and unmounts the very input being typed in.
  // The two inputs are one search to the reader, so the focus follows the value into the
  // in-flow bar, caret at the end, and the sentence continues.
  const topbarSearchFocusedRef = useRef(false);
  const inFlowSearchRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  // Mod+F belongs to this page's own search: the desktop shell binds no find-in-page, so the
  // shortcut would otherwise do nothing. Condensed, it unfolds the topbar search; at the top,
  // it focuses the in-flow bar and selects the query the way a find field would.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() !== "f" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (condensed) {
        setSearchOpen(true);
        setSearchFocusToken((token) => token + 1);
        return;
      }
      const input = inFlowSearchRef.current?.querySelector("input");
      input?.focus();
      input?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [condensed]);
  useEffect(() => {
    if (condensed) return;
    // The fold-out is gone from the chrome; forgetting it open keeps the next condensing from
    // starting with an empty expanded search nobody asked for.
    setSearchOpen(false);
    if (!topbarSearchFocusedRef.current) return;
    topbarSearchFocusedRef.current = false;
    const input = inFlowSearchRef.current?.querySelector("input");
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [condensed]);

  return (
    // Painted flat like the chat column: the inset underneath carries the chrome grain, and a
    // content surface that lets it show reads as a different background than every thread.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader
        electron={isElectron}
        reserveNativeControls={!rightPanelOpen}
        className="relative bg-background"
      >
        {titlebarControls}
        {condensed ? (
          <WorkspaceBreadcrumb ariaLabel="Issue scope">
            {/* The page name remains the foreground anchor in both states; the live filters are
                its compact scope, grouped as the second crumb rather than pretending each menu
                is a separate page in the hierarchy. */}
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Issues</h1>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem className="gap-1.5 overflow-hidden">
              <CompactFilterMenu
                label="Filter by state"
                value={state}
                options={STATE_TABS}
                onChange={onState}
              />
              <CompactFilterMenu
                label="Filter by assignee"
                value={assignee ?? ""}
                options={assigneeMenuOptions}
                onChange={(next) => onAssignee(next === "" ? undefined : next)}
              />
              {hostMenuOptions.length > 2 ? (
                <CompactFilterMenu
                  label="Filter by host"
                  value={host ?? ""}
                  options={hostMenuOptions}
                  onChange={(next) => onHost(next === "" ? undefined : next)}
                />
              ) : null}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        ) : (
          <WorkspaceBreadcrumb ariaLabel="Issues breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Issues</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        )}
        <div className="min-w-0 flex-1" />
        {condensed ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <ExpandableSearch
              label="Search issues"
              searchInput={searchInput}
              searchValue={searchValue}
              open={searchOpen}
              onOpenChange={setSearchOpen}
              focusToken={searchFocusToken}
              onFocusWithin={(focused) => {
                topbarSearchFocusedRef.current = focused;
              }}
            />
            <IssueRefreshControl compact refreshing={refreshing} onRefresh={onRefresh} />
          </div>
        ) : null}
        {rightPanelControl}
      </WorkspacePageHeader>

      <div
        ref={scrollRef}
        className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto [--topbar-scroll-fade-height:1.5rem] sm:[--topbar-scroll-fade-height:1.5rem]"
      >
        {/* The top padding is the fade band's own height (1.5rem here), the same pairing the
            settings page makes: at rest the controls sit fully below the mask, and only content
            actually passing under the chrome fades. */}
        <WorkspacePageContainer className="gap-4">
          <div className="flex flex-col gap-3">
            <div ref={inFlowSearchRef} className="flex items-center gap-2">
              {searchInput}
              {filtersMenu}
              {!condensed ? (
                <IssueRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              ) : null}
              {newIssueControl}
            </div>
            {/* Scrolled past this marker, the controls are gone and the title takes over. */}
            <div ref={markerRef} aria-hidden className="-mt-3 h-px w-full" />
          </div>

          {listBody}
        </WorkspacePageContainer>
      </div>
    </div>
  );
}

function IssueRefreshControl({
  compact = false,
  refreshing,
  onRefresh,
}: {
  compact?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant={compact ? "ghost" : "outline"}
      aria-label="Refresh issues"
      onClick={onRefresh}
      disabled={refreshing}
    >
      <RefreshCwIcon className={cn("size-4", refreshing && "animate-spin")} />
    </Button>
  );
}
