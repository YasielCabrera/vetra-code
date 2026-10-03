import { type EnvironmentTicket, ticketKey } from "@t3tools/client-runtime/state/tickets";
import type {
  EnvironmentId,
  TicketActor,
  TicketStatusCategory,
  TicketStatusColor,
  TicketStatusDefinition,
  TicketStatusSet,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { formatTicketRef } from "./ticketRefs";

export type TicketKindFilter = EnvironmentTicket["kind"];
/** Whether a ticket links at least one thread or pull request. */
export type TicketLinkFilter = "linked" | "unlinked";
export type TicketCreatorFilter = TicketActor["type"];

/** The assignee filter value for GitHub issues nobody is assigned to; no GitHub login has a colon. */
export const TICKET_NO_ASSIGNEE = ":none";

/** What the board's toolbar narrows to; every field is optional and they combine with AND. */
export interface TicketBoardFilters {
  /** A status group key, from `ticketStatusGroupKey`. */
  readonly status?: string | undefined;
  readonly kind?: TicketKindFilter | undefined;
  /** `environmentId:projectId`. */
  readonly project?: string | undefined;
  readonly label?: string | undefined;
  readonly thread?: TicketLinkFilter | undefined;
  readonly pullRequest?: TicketLinkFilter | undefined;
  readonly creator?: TicketCreatorFilter | undefined;
  /** The GitHub login that opened the issue; local tickets never match. */
  readonly author?: string | undefined;
  /** A GitHub login, or `TICKET_NO_ASSIGNEE`; local tickets never match. */
  readonly assignee?: string | undefined;
  /** A GitHub `owner/name`; local tickets never match. */
  readonly repository?: string | undefined;
  readonly environment?: EnvironmentId | undefined;
  readonly query?: string | undefined;
  /** Show only the GitHub tickets the user stopped tracking, which the board otherwise leaves out. */
  readonly hidden?: boolean | undefined;
}

/**
 * One status across environments. Each environment edits its own set, so the board merges
 * statuses that share a category and a name: everyone's Todo is one group.
 */
export interface TicketStatusGroup {
  readonly key: string;
  readonly name: string;
  readonly color: TicketStatusColor;
  readonly category: TicketStatusCategory;
  readonly collapsedByDefault: boolean;
  readonly tickets: ReadonlyArray<EnvironmentTicket>;
}

export type TicketBoardRow =
  | { readonly type: "group"; readonly group: TicketStatusGroup; readonly collapsed: boolean }
  | { readonly type: "ticket"; readonly ticket: EnvironmentTicket };

const CATEGORY_ORDER: Readonly<Record<TicketStatusCategory, number>> = {
  open: 0,
  active: 1,
  closed: 2,
};

const UNKNOWN_STATUS_GROUP_KEY = "unknown";

export function ticketStatusGroupKey(
  status: Pick<TicketStatusDefinition, "category" | "name">,
): string {
  return `${status.category}:${status.name.trim().toLowerCase()}`;
}

export function isHiddenTicket(ticket: EnvironmentTicket): boolean {
  return ticket.kind === "github" && ticket.hiddenAt !== null;
}

function matchesQuery(ticket: EnvironmentTicket, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    ticket.title.toLowerCase().includes(needle) ||
    formatTicketRef(ticket).toLowerCase() === needle ||
    ticket.labels.some((label) => label.toLowerCase().includes(needle)) ||
    (ticket.kind === "github" &&
      `${ticket.github.repository}#${ticket.github.number}`.toLowerCase().includes(needle))
  );
}

function matchesLink(
  ticket: EnvironmentTicket,
  kind: "thread" | "pull_request",
  filter: TicketLinkFilter,
): boolean {
  return ticket.linkRefs.some((ref) => ref.kind === kind) === (filter === "linked");
}

function matchesGitHub(ticket: EnvironmentTicket, filters: TicketBoardFilters): boolean {
  if (
    filters.author === undefined &&
    filters.assignee === undefined &&
    filters.repository === undefined
  ) {
    return true;
  }
  if (ticket.kind !== "github") return false;
  const { author, assignees, repository } = ticket.github;
  if (filters.author !== undefined && author !== filters.author) return false;
  if (filters.repository !== undefined && repository !== filters.repository) return false;
  if (filters.assignee === TICKET_NO_ASSIGNEE) return assignees.length === 0;
  return filters.assignee === undefined || assignees.includes(filters.assignee);
}

/**
 * Narrows the board. A query matches the title, the `T-42` ref, labels and a GitHub ticket's
 * issue ref here; `bodyMatchKeys` adds the tickets server search found by body text.
 */
export function filterTickets(
  tickets: ReadonlyArray<EnvironmentTicket>,
  filters: TicketBoardFilters,
  statusSets: ReadonlyMap<EnvironmentId, TicketStatusSet>,
  bodyMatchKeys: ReadonlySet<string> = new Set(),
): ReadonlyArray<EnvironmentTicket> {
  return tickets.filter((ticket) => {
    if (isHiddenTicket(ticket) !== (filters.hidden === true)) return false;
    if (filters.environment !== undefined && ticket.environmentId !== filters.environment) {
      return false;
    }
    if (filters.kind !== undefined && ticket.kind !== filters.kind) return false;
    if (filters.label !== undefined && !ticket.labels.includes(filters.label)) return false;
    if (filters.status !== undefined) {
      const status = statusSets
        .get(ticket.environmentId)
        ?.statuses.find((candidate) => candidate.id === ticket.statusId);
      if (status === undefined || ticketStatusGroupKey(status) !== filters.status) return false;
    }
    if (filters.project !== undefined) {
      const linked = ticket.linkRefs.some(
        (ref) =>
          ref.kind === "project" && `${ticket.environmentId}:${ref.targetKey}` === filters.project,
      );
      if (!linked) return false;
    }
    if (filters.thread !== undefined && !matchesLink(ticket, "thread", filters.thread)) {
      return false;
    }
    if (
      filters.pullRequest !== undefined &&
      !matchesLink(ticket, "pull_request", filters.pullRequest)
    ) {
      return false;
    }
    if (filters.creator !== undefined && ticket.createdBy.type !== filters.creator) return false;
    if (!matchesGitHub(ticket, filters)) return false;
    if (filters.query !== undefined && filters.query.trim().length > 0) {
      return (
        matchesQuery(ticket, filters.query) ||
        bodyMatchKeys.has(
          ticketKey({
            environmentId: ticket.environmentId,
            ticketId: ticket.id,
          }),
        )
      );
    }
    return true;
  });
}

export function buildTicketStatusGroups(
  statusSets: ReadonlyMap<EnvironmentId, TicketStatusSet>,
): ReadonlyArray<Omit<TicketStatusGroup, "tickets">> {
  const groups = new Map<string, Omit<TicketStatusGroup, "tickets">>();
  for (const set of statusSets.values()) {
    for (const status of set.statuses) {
      const key = ticketStatusGroupKey(status);
      if (groups.has(key)) continue;
      groups.set(key, {
        key,
        name: status.name,
        color: status.color,
        category: status.category,
        collapsedByDefault: status.collapsedByDefault,
      });
    }
  }
  return [...groups.values()].toSorted(
    (left, right) => CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category],
  );
}

function compareTicketsInStatus(left: EnvironmentTicket, right: EnvironmentTicket): number {
  if (left.sortKey !== right.sortKey) return left.sortKey < right.sortKey ? -1 : 1;
  return left.number - right.number;
}

/**
 * Groups tickets by merged status, in board order, each sorted by its fractional `sortKey`.
 * Every status gets a group, empty or not, so the board can show a column to drop into.
 */
export function groupTicketsByStatus(
  tickets: ReadonlyArray<EnvironmentTicket>,
  statusSets: ReadonlyMap<EnvironmentId, TicketStatusSet>,
): ReadonlyArray<TicketStatusGroup> {
  const ticketsByGroup = new Map<string, EnvironmentTicket[]>();
  for (const ticket of tickets) {
    const status = statusSets
      .get(ticket.environmentId)
      ?.statuses.find((candidate) => candidate.id === ticket.statusId);
    const key = status === undefined ? UNKNOWN_STATUS_GROUP_KEY : ticketStatusGroupKey(status);
    const bucket = ticketsByGroup.get(key);
    if (bucket) bucket.push(ticket);
    else ticketsByGroup.set(key, [ticket]);
  }
  const groups: TicketStatusGroup[] = [];
  for (const group of buildTicketStatusGroups(statusSets)) {
    const grouped = ticketsByGroup.get(group.key) ?? [];
    groups.push({ ...group, tickets: grouped.toSorted(compareTicketsInStatus) });
  }
  const unknown = ticketsByGroup.get(UNKNOWN_STATUS_GROUP_KEY);
  if (unknown) {
    groups.push({
      key: UNKNOWN_STATUS_GROUP_KEY,
      name: "No status",
      color: "gray",
      category: "open",
      collapsedByDefault: false,
      tickets: unknown.toSorted(compareTicketsInStatus),
    });
  }
  return groups;
}

/**
 * The list's rows: each non-empty group's header, then its tickets unless the group is collapsed.
 * A group the user never toggled follows its status's `collapsedByDefault`.
 */
export function flattenTicketGroups(
  groups: ReadonlyArray<TicketStatusGroup>,
  collapsedOverrides: ReadonlyMap<string, boolean>,
): ReadonlyArray<TicketBoardRow> {
  const rows: TicketBoardRow[] = [];
  for (const group of groups) {
    if (group.tickets.length === 0) continue;
    const collapsed = collapsedOverrides.get(group.key) ?? group.collapsedByDefault;
    rows.push({ type: "group", group, collapsed });
    if (collapsed) continue;
    for (const ticket of group.tickets) rows.push({ type: "ticket", ticket });
  }
  return rows;
}

/** The board's URL state, so back, forward and copied links keep the view and filters. */
export interface TicketBoardSearch {
  /** Absent means the list. */
  readonly view?: "list" | "board";
  readonly status?: string;
  readonly kind?: TicketKindFilter;
  readonly project?: string;
  readonly label?: string;
  readonly thread?: TicketLinkFilter;
  readonly pr?: TicketLinkFilter;
  readonly creator?: TicketCreatorFilter;
  readonly author?: string;
  readonly assignee?: string;
  readonly repo?: string;
  readonly env?: string;
  readonly q?: string;
  readonly hidden?: true;
}

const SEARCH_KEYS = [
  "view",
  "status",
  "kind",
  "project",
  "label",
  "thread",
  "pr",
  "creator",
  "author",
  "assignee",
  "repo",
  "env",
  "q",
  "hidden",
] as const;
const SearchInput = Schema.Record(Schema.String, Schema.Unknown);
const isSearchInput = Schema.is(SearchInput);

function searchText(value: unknown, maxLength = 200): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.slice(0, maxLength)
    : undefined;
}

function isLinkFilter(value: unknown): value is TicketLinkFilter {
  return value === "linked" || value === "unlinked";
}

function isCreatorFilter(value: unknown): value is TicketCreatorFilter {
  return value === "user" || value === "agent" || value === "sync" || value === "automation";
}

/** Drops anything malformed rather than failing the route; an empty field is no filter. */
export function validateTicketBoardSearch(raw: unknown): TicketBoardSearch {
  if (!isSearchInput(raw)) return {};
  const status = searchText(raw.status);
  const project = searchText(raw.project);
  const label = searchText(raw.label);
  const author = searchText(raw.author);
  const assignee = searchText(raw.assignee);
  const repo = searchText(raw.repo);
  const env = searchText(raw.env);
  const q = searchText(raw.q);
  return {
    ...(raw.view === "board" || raw.view === "list" ? { view: raw.view } : {}),
    ...(status === undefined ? {} : { status }),
    ...(raw.kind === "local" || raw.kind === "github" ? { kind: raw.kind } : {}),
    ...(project === undefined ? {} : { project }),
    ...(label === undefined ? {} : { label }),
    ...(isLinkFilter(raw.thread) ? { thread: raw.thread } : {}),
    ...(isLinkFilter(raw.pr) ? { pr: raw.pr } : {}),
    ...(isCreatorFilter(raw.creator) ? { creator: raw.creator } : {}),
    ...(author === undefined ? {} : { author }),
    ...(assignee === undefined ? {} : { assignee }),
    ...(repo === undefined ? {} : { repo }),
    ...(env === undefined ? {} : { env }),
    ...(q === undefined ? {} : { q }),
    ...(raw.hidden === true || raw.hidden === "true" ? { hidden: true as const } : {}),
  };
}

/** Search text belongs to a visit; the toolbar selections belong to the client. */
export function ticketBoardPreferencesFromSearch(raw: unknown): Omit<TicketBoardSearch, "q"> {
  const { q: _query, ...preferences } = validateTicketBoardSearch(raw);
  return preferences;
}

/** Any explicit board parameter, including a default or malformed value, overrides memory. */
export function hasTicketBoardSearchParams(search: object): boolean {
  if (typeof search !== "object" || search === null) return false;
  return SEARCH_KEYS.some((key) => Object.hasOwn(search, key));
}

/**
 * Set on a history entry when this visit's explicit params pruned down to nothing.
 * A plain `/tickets` visit must still restore memory; this entry must not, or the
 * restore would put remembered filters back over the link the reader opened.
 */
export const TICKET_BOARD_SEARCH_SETTLED = "ticketBoardSearchSettled";

export function ticketBoardHistoryMarksSettledSearch(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    TICKET_BOARD_SEARCH_SETTLED in state &&
    state[TICKET_BOARD_SEARCH_SETTLED] === true
  );
}

/**
 * The search to put on a plain visit, or null when the URL already chose
 * (including a malformed choice) or this history entry was settled empty.
 * Remembered search text is never part of the redirect.
 */
export function ticketBoardRestoreRedirect(input: {
  readonly urlSearch: object;
  readonly historyState: unknown;
  readonly rememberedSearch: unknown;
}): TicketBoardSearch | null {
  if (hasTicketBoardSearchParams(input.urlSearch)) return null;
  if (ticketBoardHistoryMarksSettledSearch(input.historyState)) return null;
  const search = ticketBoardPreferencesFromSearch(input.rememberedSearch);
  return Object.keys(search).length > 0 ? search : null;
}

export function resolveTicketBoardEntrySearch(input: {
  readonly urlSearch: Record<string, unknown>;
  readonly rememberedSearch: unknown;
}): TicketBoardSearch {
  return hasTicketBoardSearchParams(input.urlSearch)
    ? validateTicketBoardSearch(input.urlSearch)
    : ticketBoardPreferencesFromSearch(input.rememberedSearch);
}

export function isDefaultTicketBoardFilters(search: TicketBoardSearch): boolean {
  return (
    (search.q?.trim().length ?? 0) === 0 &&
    SEARCH_KEYS.every((key) => key === "view" || key === "q" || search[key] === undefined)
  );
}

export function resetTicketBoardFilters(search: TicketBoardSearch): TicketBoardSearch {
  return search.view === undefined ? {} : { view: search.view };
}

/**
 * The `?q=` value to write, or null when this debounce is behind the box or already synced.
 * Clear sets the box to empty immediately; the previous debounce must not put the text back.
 */
export function ticketBoardQueryUrlUpdate(input: {
  readonly query: string;
  readonly debouncedQuery: string;
  readonly syncedQuery: string;
}): string | null {
  if (input.query !== input.debouncedQuery) return null;
  const next = input.debouncedQuery.trim() === "" ? "" : input.debouncedQuery;
  return next === input.syncedQuery ? null : next;
}

export type TicketBoardEnvironmentPhase = "starting" | "connected" | "offline";

/** Connection phases that have not settled offline still count as the reader's environment. */
export function ticketBoardEnvironmentPhase(input: {
  readonly enabled: boolean;
  readonly connectionPhase:
    | "available"
    | "offline"
    | "connecting"
    | "reconnecting"
    | "connected"
    | "error"
    | "unsupported";
}): TicketBoardEnvironmentPhase {
  if (!input.enabled) return "offline";
  switch (input.connectionPhase) {
    case "connected":
      return "connected";
    case "available":
    case "connecting":
    case "reconnecting":
      return "starting";
    case "offline":
    case "error":
    case "unsupported":
      return "offline";
  }
}

export interface TicketBoardCatalogEnvironment {
  readonly id: string;
  readonly phase: TicketBoardEnvironmentPhase;
  /** Present once that environment's project snapshot is live. */
  readonly projectIds?: ReadonlyArray<string> | undefined;
  /**
   * Present once that environment's server config says whether it keeps tickets. Until then
   * it is not among the ticket environments, which must not read as having no statuses.
   */
  readonly ticketsSupported?: boolean | undefined;
  /** Present once that environment's status set has arrived. */
  readonly statusGroups?: ReadonlyArray<string> | undefined;
}

export interface TicketBoardCatalog {
  /** Absent until every connected ticket environment has reported statuses. */
  readonly statuses?: ReadonlyArray<string> | undefined;
  /**
   * Absent until environments are ready. A project on a pending environment is kept;
   * one on an offline or finished environment is kept only when its key is listed.
   */
  readonly projects?:
    | {
        readonly keys: ReadonlyArray<string>;
        readonly pendingEnvironmentIds: ReadonlyArray<string>;
      }
    | undefined;
  /** Absent until environments are ready. Offline and removed environments are omitted. */
  readonly environments?: ReadonlyArray<string> | undefined;
}

/**
 * What the board may still filter by. Offline environments are settled: they must not
 * keep a filter that hides everyone else, and a missing status set from one must not
 * block pruning. Starting environments are not settled, so their selections survive
 * startup. An incomplete presentation (a ticket environment missing from the list)
 * prunes nothing.
 */
export function resolveTicketBoardCatalogs(input: {
  readonly environmentsReady: boolean;
  readonly ticketsLoaded: boolean;
  readonly ticketEnvironmentIds: ReadonlyArray<string>;
  readonly environments: ReadonlyArray<TicketBoardCatalogEnvironment>;
}): TicketBoardCatalog {
  if (!input.environmentsReady) return {};
  const byId = new Map(input.environments.map((environment) => [environment.id, environment]));
  if (input.ticketEnvironmentIds.some((id) => !byId.has(id))) return {};

  const environmentIds: string[] = [];
  const projectKeys: string[] = [];
  const pendingEnvironmentIds: string[] = [];
  for (const environment of input.environments) {
    if (environment.phase === "offline") continue;
    environmentIds.push(environment.id);
    if (environment.phase === "starting" || environment.projectIds === undefined) {
      pendingEnvironmentIds.push(environment.id);
      continue;
    }
    for (const projectId of environment.projectIds) {
      projectKeys.push(`${environment.id}:${projectId}`);
    }
  }

  let statuses: ReadonlyArray<string> | undefined;
  if (input.ticketsLoaded) {
    const groups = new Set<string>();
    let settled = true;
    for (const environment of input.environments) {
      if (environment.phase === "offline" || environment.ticketsSupported === false) continue;
      if (
        environment.phase === "starting" ||
        environment.ticketsSupported === undefined ||
        environment.statusGroups === undefined
      ) {
        settled = false;
        continue;
      }
      for (const group of environment.statusGroups) groups.add(group);
    }
    if (settled) statuses = [...groups];
  }

  return {
    ...(statuses === undefined ? {} : { statuses }),
    projects: { keys: projectKeys, pendingEnvironmentIds },
    environments: environmentIds,
  };
}

function projectEnvironmentId(project: string): string {
  const separator = project.indexOf(":");
  return separator === -1 ? project : project.slice(0, separator);
}

/** Only prune against catalogs that have finished loading, so remote selections survive startup. */
export function reconcileTicketBoardSearch(
  search: TicketBoardSearch,
  options: TicketBoardCatalog,
): TicketBoardSearch {
  const project = reconciledProject(search.project, options.projects);
  const next = validateTicketBoardSearch({
    ...search,
    status:
      options.statuses === undefined || options.statuses.includes(search.status ?? "")
        ? search.status
        : undefined,
    project,
    env:
      options.environments === undefined || options.environments.includes(search.env ?? "")
        ? search.env
        : undefined,
  });
  return SEARCH_KEYS.every((key) => next[key] === search[key]) ? search : next;
}

function reconciledProject(
  project: string | undefined,
  catalog: TicketBoardCatalog["projects"],
): string | undefined {
  if (project === undefined || catalog === undefined) return project;
  if (catalog.pendingEnvironmentIds.includes(projectEnvironmentId(project))) return project;
  return catalog.keys.includes(project) ? project : undefined;
}
