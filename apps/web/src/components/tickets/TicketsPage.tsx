import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { useAtomValue } from "@effect/atom-react";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type EnvironmentTicket, ticketKey } from "@t3tools/client-runtime/state/tickets";
import { type EnvironmentId, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import {
  ChevronRightIcon,
  EyeOffIcon,
  LaptopIcon,
  ListIcon,
  MessageSquareIcon,
  MessageSquareOffIcon,
  PlusIcon,
  SearchIcon,
  SquareKanbanIcon,
  TagIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { environmentCatalog } from "../../connection/catalog";
import { isElectron } from "../../env";
import { useTicketActions } from "../../hooks/useTicketActions";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { environmentShell } from "../../state/shell";
import { ticketEnvironment, useTicketGitHubSources, useTickets } from "../../state/tickets";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { GitHubIcon } from "../Icons";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildTicketStatusGroups,
  filterTickets,
  flattenTicketGroups,
  groupTicketsByStatus,
  isDefaultTicketBoardFilters,
  isHiddenTicket,
  reconcileTicketBoardSearch,
  resetTicketBoardFilters,
  resolveTicketBoardCatalogs,
  ticketBoardQueryUrlUpdate,
  TICKET_BOARD_SEARCH_SETTLED,
  ticketBoardEnvironmentPhase,
  ticketStatusGroupKey,
  type TicketBoardRow,
  type TicketBoardSearch,
  type TicketStatusGroup,
  validateTicketBoardSearch,
} from "./ticketBoard.logic";
import {
  persistReconciledTicketBoardPreferences,
  rememberTicketBoardSearch,
} from "./ticketBoardPreferences";
import { TicketKanban } from "./TicketKanban";
import { TicketFilterMenu, TicketStatusIcon } from "./ticketPresentation";
import { useRunning } from "../../hooks/useRunning";
import { summarizeGitHubSync } from "./ticketGitHub.logic";
import { TicketGitHubConnect } from "./TicketGitHubConnect";
import { TicketRow, TICKET_LIST_ROW_HEIGHT } from "./TicketListRow";

const ROW_HEIGHT = TICKET_LIST_ROW_HEIGHT;
const NO_MATCHES: ReadonlySet<string> = new Set();

/**
 * Live project ids per environment. Missing means the snapshot is not live yet, so a
 * saved project filter for that environment is kept until we can tell it is gone.
 */
const liveTicketProjectIdsAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, ReadonlyArray<string>> | null => {
    const catalog = get(environmentCatalog.catalogValueAtom);
    if (!catalog.isReady) return null;
    const next = new Map<EnvironmentId, ReadonlyArray<string>>();
    for (const [environmentId, entry] of catalog.entries) {
      if (!entry.enabled) continue;
      const shell = get(environmentShell.stateValueAtom(environmentId));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) continue;
      next.set(
        environmentId,
        shell.snapshot.value.projects.map((project) => project.id),
      );
    }
    const previous = Option.getOrNull(
      get.self<ReadonlyMap<EnvironmentId, ReadonlyArray<string>> | null>(),
    );
    if (
      previous !== null &&
      previous.size === next.size &&
      [...next].every(([environmentId, projectIds]) => {
        const prior = previous.get(environmentId);
        return (
          prior !== undefined &&
          prior.length === projectIds.length &&
          prior.every((projectId, index) => projectId === projectIds[index])
        );
      })
    ) {
      return previous;
    }
    return next;
  },
).pipe(Atom.withLabel("tickets-live-project-ids"));

function useTicketBodyMatches(
  query: string,
  environmentIds: ReadonlyArray<EnvironmentId>,
): { readonly keys: ReadonlySet<string>; readonly truncated: boolean } {
  const search = useAtomCommand(ticketEnvironment.search, { reportFailure: false });
  const [debouncedQuery] = useDebouncedValue(query.trim(), { wait: 250 });
  const { tickets } = useTickets();
  const searching = query.trim().length > 0;
  const ticketRevisions = useMemo(
    () =>
      searching
        ? tickets
            .map((ticket) => `${ticket.environmentId}:${ticket.id}:${ticket.revision}`)
            .join("|")
        : "",
    [searching, tickets],
  );
  const [debouncedTicketRevisions] = useDebouncedValue(ticketRevisions, { wait: 250 });
  const [matches, setMatches] = useState<{
    readonly query: string;
    readonly keys: ReadonlySet<string>;
    readonly truncated: boolean;
  }>({ query: "", keys: NO_MATCHES, truncated: false });

  useEffect(() => {
    if (debouncedQuery.length === 0 || ticketRevisions !== debouncedTicketRevisions) return;
    let current = true;
    void Promise.all(
      environmentIds.map(async (environmentId) => {
        const result = await search({
          environmentId,
          input: { query: debouncedQuery, limit: 100 },
        });
        return result._tag === "Success"
          ? {
              keys: result.value.hits.map((hit) =>
                ticketKey({ environmentId, ticketId: hit.ticketId }),
              ),
              truncated: result.value.truncated,
            }
          : { keys: [], truncated: false };
      }),
    ).then((keys) => {
      if (current)
        setMatches({
          query: debouncedQuery,
          keys: new Set(keys.flatMap((result) => result.keys)),
          truncated: keys.some((result) => result.truncated),
        });
    });
    return () => {
      current = false;
    };
  }, [debouncedQuery, debouncedTicketRevisions, environmentIds, search, ticketRevisions]);

  return matches.query === query.trim() && query.trim().length > 0
    ? matches
    : { keys: NO_MATCHES, truncated: false };
}

/**
 * Keeps the search box and `?q=` in step: typing writes the URL once it pauses, and a URL change
 * from elsewhere (a link to /tickets, back and forward) replaces what is typed.
 */
function useSearchQueryInUrl(query: string, setQuery: (query: string) => void, urlQuery: string) {
  const navigate = useNavigate();
  const [debouncedQuery] = useDebouncedValue(query, { wait: 300 });
  const syncedQuery = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery === syncedQuery.current) return;
    syncedQuery.current = urlQuery;
    setQuery(urlQuery);
  }, [setQuery, urlQuery]);
  useEffect(() => {
    const next = ticketBoardQueryUrlUpdate({
      query,
      debouncedQuery,
      syncedQuery: syncedQuery.current,
    });
    if (next === null) return;
    syncedQuery.current = next;
    void navigate({
      to: "/tickets",
      search: (current) => validateTicketBoardSearch({ ...current, q: next || undefined }),
      replace: true,
    });
  }, [debouncedQuery, navigate, query]);
}

export function TicketsPage() {
  const search = useSearch({ from: "/tickets/" });
  const navigate = useNavigate();
  const board = useTickets();
  const projects = useProjects();
  const { environments, isReady: environmentsReady } = useEnvironments();
  const liveProjectIds = useAtomValue(liveTicketProjectIdsAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [query, setQuery] = useState(search.q ?? "");
  useSearchQueryInUrl(query, setQuery, search.q ?? "");
  const [collapsedOverrides, setCollapsedOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const listRef = useRef<LegendListRef | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  const catalogs = useMemo(
    () =>
      resolveTicketBoardCatalogs({
        environmentsReady,
        ticketsLoaded: board.loaded,
        ticketEnvironmentIds: board.environmentIds,
        environments: environments.map((environment) => {
          const statusSet = board.statusSets.get(environment.environmentId);
          return {
            id: environment.environmentId,
            phase: ticketBoardEnvironmentPhase({
              enabled: environment.entry.enabled,
              connectionPhase: environment.connection.phase,
            }),
            projectIds: liveProjectIds?.get(environment.environmentId),
            statusGroups:
              statusSet === undefined
                ? undefined
                : statusSet.statuses.map((status) => ticketStatusGroupKey(status)),
          };
        }),
      }),
    [
      board.environmentIds,
      board.loaded,
      board.statusSets,
      environments,
      environmentsReady,
      liveProjectIds,
    ],
  );
  const boardSearch = useMemo(
    () => reconcileTicketBoardSearch(search, catalogs),
    [catalogs, search],
  );
  const setSearch = useCallback(
    (patch: { readonly [Key in keyof TicketBoardSearch]?: TicketBoardSearch[Key] | undefined }) => {
      const next = validateTicketBoardSearch({ ...boardSearch, ...patch });
      rememberTicketBoardSearch(next);
      void navigate({
        to: "/tickets",
        search: next,
        replace: true,
      });
    },
    [boardSearch, navigate],
  );

  const bodyMatches = useTicketBodyMatches(query, board.environmentIds);
  const bodyMatchKeys = bodyMatches.keys;
  const environmentFilter = board.environmentIds.find((id) => id === boardSearch.env);
  const filters = useMemo(
    () => ({
      status: boardSearch.status,
      kind: boardSearch.kind,
      project: boardSearch.project,
      label: boardSearch.label,
      thread: boardSearch.thread,
      environment: environmentFilter,
      query,
      hidden: boardSearch.hidden,
    }),
    [boardSearch, environmentFilter, query],
  );
  const filteredTickets = useMemo(
    () => filterTickets(board.tickets, filters, board.statusSets, bodyMatchKeys),
    [board.statusSets, board.tickets, bodyMatchKeys, filters],
  );
  const groups = useMemo(
    () => groupTicketsByStatus(filteredTickets, board.statusSets),
    [board.statusSets, filteredTickets],
  );
  const rows = useMemo(
    () => flattenTicketGroups(groups, collapsedOverrides),
    [collapsedOverrides, groups],
  );

  const projectTitleByKey = useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );
  const statusOptions = useMemo(
    () =>
      buildTicketStatusGroups(board.statusSets).map((group) => ({
        value: group.key,
        label: group.name,
        icon: <TicketStatusIcon color={group.color} category={group.category} />,
      })),
    [board.statusSets],
  );
  const projectOptions = useMemo(
    () =>
      projects
        .filter((project) => board.environmentIds.includes(project.environmentId))
        .map((project) => ({
          value: `${project.environmentId}:${project.id}`,
          label: project.title,
          icon: <ProjectFavicon project={project} className="size-3.5" />,
        })),
    [board.environmentIds, projects],
  );
  const labelOptions = useMemo(
    () =>
      [...new Set(board.tickets.flatMap((ticket) => ticket.labels))]
        .toSorted((left, right) => left.localeCompare(right))
        .map((label) => ({
          value: label,
          label,
          icon: <TagIcon aria-hidden className="size-3.5" />,
        })),
    [board.tickets],
  );
  const environmentLabels = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const environmentOptions = useMemo(
    () =>
      environments
        .filter((environment) => board.environmentIds.includes(environment.environmentId))
        .map((environment) => ({
          value: environment.environmentId,
          label: environment.label,
          icon: (
            <EnvironmentMachineIcon
              aria-hidden
              kind={resolveEnvironmentMachineKind(environment.serverConfig)}
              className="size-3.5"
            />
          ),
        })),
    [board.environmentIds, environments],
  );

  useEffect(() => {
    // Prune storage before replacing the URL. A replace that lands on no params
    // would otherwise restore the stale selection and fight this visit.
    persistReconciledTicketBoardPreferences(catalogs);
    if (boardSearch === search) return;
    void navigate({
      to: "/tickets",
      search: boardSearch,
      replace: true,
      ...(Object.keys(boardSearch).length === 0
        ? { state: { [TICKET_BOARD_SEARCH_SETTLED]: true } }
        : {}),
    });
  }, [boardSearch, catalogs, navigate, search]);

  const hasFilters = !isDefaultTicketBoardFilters({ ...boardSearch, q: query });
  const clearFilters = () => {
    const next = resetTicketBoardFilters(boardSearch);
    rememberTicketBoardSearch(next);
    setQuery("");
    void navigate({ to: "/tickets", search: next, replace: true });
  };

  const openTicket = useCallback(
    (ticket: EnvironmentTicket) => {
      void navigate({
        to: "/tickets/$ticketKey",
        params: {
          ticketKey: ticketKey({ environmentId: ticket.environmentId, ticketId: ticket.id }),
        },
      });
    },
    [navigate],
  );
  const { setHidden } = useTicketActions();
  const trackAgain = useCallback(
    (ticket: EnvironmentTicket) =>
      void setHidden({ environmentId: ticket.environmentId, ticketId: ticket.id }, false),
    [setHidden],
  );
  const toggleGroup = useCallback((group: TicketStatusGroup, collapsed: boolean) => {
    setCollapsedOverrides((current) => new Map(current).set(group.key, !collapsed));
  }, []);
  const newTicket = () => {
    const environment = environmentFilter ?? primaryEnvironmentId;
    void navigate({
      to: "/tickets/new",
      search: environment === null ? {} : { env: environment },
    });
  };
  const canCreate = board.environmentIds.length > 0;
  const trackedCount = useMemo(
    () => board.tickets.filter((ticket) => !isHiddenTicket(ticket)).length,
    [board.tickets],
  );
  const hasHidden = trackedCount < board.tickets.length;

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    void listRef.current?.scrollIndexIntoView({ index: next, animated: false }).then(() => {
      requestAnimationFrame(() => {
        listContainerRef.current?.querySelector<HTMLElement>(`[data-board-row="${next}"]`)?.focus();
      });
    });
  };
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const active = (event.target as HTMLElement).closest("[data-board-row]");
    if (active === null) return;
    event.preventDefault();
    focusRow(Number(active.getAttribute("data-board-row")) + (event.key === "ArrowDown" ? 1 : -1));
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Tickets breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Tickets</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>

        <div
          className={cn(
            "mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 px-5 pt-4",
            boardSearch.view !== "board" && "max-w-5xl",
          )}
        >
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && rows.length > 0) {
                    event.preventDefault();
                    focusRow(0);
                  }
                }}
                placeholder="Search tickets"
                aria-label="Search tickets"
                className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24 sm:h-8"
              />
            </div>
            <ToggleGroup
              aria-label="Tickets view"
              className="shrink-0"
              variant="segmented"
              value={[boardSearch.view ?? "list"]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "list" || next === "board") {
                  setSearch({ view: next });
                }
              }}
            >
              <Toggle aria-label="List view" value="list">
                <ListIcon className="size-3.5" />
              </Toggle>
              <Toggle aria-label="Board view" value="board">
                <SquareKanbanIcon className="size-3.5" />
              </Toggle>
            </ToggleGroup>
            <TicketsSyncControl />
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={!canCreate}
              onClick={newTicket}
            >
              <PlusIcon />
              New ticket
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <TicketFilterMenu
              label="Status"
              value={boardSearch.status}
              options={statusOptions}
              onChange={(status) => setSearch({ status })}
            />
            <TicketFilterMenu
              label="Kind"
              value={boardSearch.kind}
              options={[
                {
                  value: "local",
                  label: "Local",
                  icon: <LaptopIcon aria-hidden className="size-3.5" />,
                },
                {
                  value: "github",
                  label: "GitHub",
                  icon: <GitHubIcon aria-hidden className="size-3.5" />,
                },
              ]}
              onChange={(kind) =>
                setSearch({ kind: kind === "local" || kind === "github" ? kind : undefined })
              }
            />
            <TicketFilterMenu
              label="Project"
              value={boardSearch.project}
              options={projectOptions}
              onChange={(project) => setSearch({ project })}
            />
            <TicketFilterMenu
              label="Label"
              value={boardSearch.label}
              options={labelOptions}
              onChange={(label) => setSearch({ label })}
            />
            <TicketFilterMenu
              label="Thread"
              value={boardSearch.thread}
              options={[
                {
                  value: "linked",
                  label: "Has a linked thread",
                  icon: <MessageSquareIcon aria-hidden className="size-3.5" />,
                },
                {
                  value: "unlinked",
                  label: "No linked thread",
                  icon: <MessageSquareOffIcon aria-hidden className="size-3.5" />,
                },
              ]}
              onChange={(thread) =>
                setSearch({
                  thread: thread === "linked" || thread === "unlinked" ? thread : undefined,
                })
              }
            />
            {hasHidden || boardSearch.hidden ? (
              <Button
                size="xs"
                variant={boardSearch.hidden ? "outline" : "ghost"}
                aria-pressed={boardSearch.hidden === true}
                onClick={() => setSearch({ hidden: boardSearch.hidden ? undefined : true })}
              >
                <EyeOffIcon aria-hidden />
                Hidden
              </Button>
            ) : null}
            {environmentOptions.length > 1 ? (
              <TicketFilterMenu
                label="Environment"
                value={environmentFilter}
                options={environmentOptions}
                onChange={(env) => setSearch({ env })}
              />
            ) : null}
            {hasFilters ? (
              <Button size="xs" variant="ghost" aria-label="Clear filters" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
          </div>

          {bodyMatches.truncated ? (
            <p role="status" className="px-4 text-xs text-muted-foreground">
              Body search reached its result limit. Some matching tickets may be missing; use a more
              specific search.
            </p>
          ) : null}
          {board.environmentIds.length === 0 ? (
            <TicketsEmptyState
              title="Tickets need a newer server"
              description="Update the Vetra Code server in this environment to keep a ticket board."
              action={null}
            />
          ) : board.tickets.length === 0 && !board.loaded ? (
            <TicketsListGhost rows={4} />
          ) : trackedCount === 0 && !boardSearch.hidden ? (
            <TicketsEmptyState
              title="No tickets yet"
              description="Write down the work you have not started, and link it to projects, threads and pull requests. Or bring in a repository's open GitHub issues."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" disabled={!canCreate} onClick={newTicket}>
                    <PlusIcon />
                    New ticket
                  </Button>
                  <TicketGitHubConnect emptyState />
                </div>
              }
            />
          ) : filteredTickets.length === 0 ? (
            <TicketsEmptyState
              title="No tickets match"
              description="Nothing on the board matches these filters."
              action={
                hasFilters ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : boardSearch.view === "board" ? (
            <TicketKanban
              tickets={filteredTickets}
              statusSets={board.statusSets}
              statusFilter={boardSearch.status}
              collapsedOverrides={collapsedOverrides}
              environmentLabels={environmentLabels}
              projectTitleByKey={projectTitleByKey}
              onToggleColumn={toggleGroup}
              onOpen={openTicket}
            />
          ) : (
            <div ref={listContainerRef} className="min-h-0 flex-1" onKeyDown={handleListKeyDown}>
              <LegendList<TicketBoardRow>
                ref={listRef}
                data={rows}
                keyExtractor={(row) =>
                  row.type === "group"
                    ? `group:${row.group.key}`
                    : ticketKey({
                        environmentId: row.ticket.environmentId,
                        ticketId: row.ticket.id,
                      })
                }
                getItemType={(row) => row.type}
                estimatedItemSize={ROW_HEIGHT}
                getFixedItemSize={(row) => (row.type === "group" ? 40 : ROW_HEIGHT)}
                drawDistance={ROW_HEIGHT * 10}
                extraData={projectTitleByKey}
                recycleItems
                style={{ height: "100%" }}
                contentContainerStyle={{ paddingBottom: 48 }}
                renderItem={({ item, index }) =>
                  item.type === "group" ? (
                    <TicketGroupHeader
                      group={item.group}
                      collapsed={item.collapsed}
                      rowIndex={index}
                      onToggle={toggleGroup}
                    />
                  ) : (
                    <TicketRow
                      ticket={item.ticket}
                      status={board.statusSets
                        .get(item.ticket.environmentId)
                        ?.statuses.find((status) => status.id === item.ticket.statusId)}
                      rowIndex={index}
                      projectTitleByKey={projectTitleByKey}
                      onOpen={openTicket}
                      onTrackAgain={trackAgain}
                    />
                  )
                }
              />
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function TicketsSyncControl() {
  const navigate = useNavigate();
  const actions = useTicketActions();
  const sources = useTicketGitHubSources();
  const [syncing, trackSync] = useRunning();
  const summary = useMemo(() => summarizeGitHubSync(sources), [sources]);
  const syncAll = () =>
    void trackSync(() =>
      Promise.all(
        (summary?.sources ?? []).map((source) =>
          actions.syncGitHubSource(source.environmentId, source),
        ),
      ),
    );
  return (
    <div className="flex shrink-0 items-center">
      <TicketGitHubConnect />
      {summary?.lastError == null ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="GitHub sync failed. Open ticket settings"
                onClick={() => void navigate({ to: "/settings/tickets" })}
              />
            }
          >
            <TriangleAlertIcon aria-hidden className="text-warning" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{summary.lastError}</TooltipPopup>
        </Tooltip>
      )}
      {summary === null ? null : (
        <Button size="sm" variant="ghost" disabled={syncing} onClick={syncAll}>
          <RefreshIcon refreshing={syncing} />
          {syncing
            ? "Syncing"
            : summary.lastSyncedAt === null
              ? "Sync"
              : `Synced ${formatRelativeTimeLabel(summary.lastSyncedAt)}`}
        </Button>
      )}
    </div>
  );
}

const TicketGroupHeader = memo(function TicketGroupHeader(props: {
  group: TicketStatusGroup;
  collapsed: boolean;
  rowIndex: number;
  onToggle: (group: TicketStatusGroup, collapsed: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-board-row={props.rowIndex}
      aria-expanded={!props.collapsed}
      onClick={() => props.onToggle(props.group, props.collapsed)}
      className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
    >
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3.5 shrink-0", !props.collapsed && "rotate-90")}
      />
      <TicketStatusIcon color={props.group.color} category={props.group.category} />
      <span className="text-foreground">{props.group.name}</span>
      <span className="tabular-nums">{props.group.tickets.length}</span>
    </button>
  );
});

function TicketsEmptyState(props: {
  readonly title: string;
  readonly description: string;
  readonly action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
      <SquareKanbanIcon aria-hidden className="size-8 text-muted-foreground/60" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p className="text-xs text-muted-foreground">{props.description}</p>
      </div>
      {props.action}
    </div>
  );
}

function TicketsListGhost(props: { readonly rows: number }) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: props.rows }, (_unused, index) => (
        <div key={index} className="flex h-10 items-center gap-3 px-2">
          <div className="h-3 w-10 rounded bg-muted/60" />
          <div className="h-3.5 w-64 rounded bg-muted/60" />
        </div>
      ))}
    </div>
  );
}
