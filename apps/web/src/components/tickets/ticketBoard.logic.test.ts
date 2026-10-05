import { type EnvironmentTicket, ticketKey } from "@t3tools/client-runtime/state/tickets";
import {
  EnvironmentId,
  TicketId,
  ThreadId,
  TicketStatusId,
  type TicketStatusDefinition,
  type TicketStatusSet,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterTickets,
  flattenTicketGroups,
  groupTicketsByStatus,
  hasTicketBoardSearchParams,
  isDefaultTicketBoardFilters,
  reconcileTicketBoardSearch,
  resetTicketBoardFilters,
  resolveTicketBoardCatalogs,
  TICKET_NO_ASSIGNEE,
  ticketBoardQueryUrlUpdate,
  resolveTicketBoardEntrySearch,
  ticketBoardEnvironmentPhase,
  ticketBoardHistoryMarksSettledSearch,
  ticketBoardPreferencesFromSearch,
  ticketBoardRestoreRedirect,
  ticketStatusGroupKey,
  validateTicketBoardSearch,
} from "./ticketBoard.logic";

const LOCAL = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-remote");

function status(
  id: string,
  name: string,
  category: "open" | "active",
  position: number,
  collapsedByDefault = false,
): TicketStatusDefinition {
  return {
    id: TicketStatusId.make(id),
    name,
    color: "gray",
    category,
    position,
    collapsedByDefault,
    isDefault: position === 0,
  };
}

function closedStatus(id: string, name: string, position: number): TicketStatusDefinition {
  return {
    id: TicketStatusId.make(id),
    name,
    color: "green",
    category: "closed",
    closeReason: "completed",
    position,
    collapsedByDefault: true,
    isDefault: true,
  };
}

const STATUS_SETS: ReadonlyMap<EnvironmentId, TicketStatusSet> = new Map([
  [
    LOCAL,
    {
      statuses: [
        closedStatus("local-done", "Done", 0),
        status("local-todo", "Todo", "open", 1),
        status("local-doing", "In progress", "active", 2),
      ],
    },
  ],
  [
    REMOTE,
    {
      statuses: [status("remote-todo", "todo ", "open", 0), status("remote-qa", "QA", "active", 1)],
    },
  ],
]);

function ticket(
  overrides: Omit<Partial<Extract<EnvironmentTicket, { kind: "local" }>>, "id" | "statusId"> & {
    readonly id: string;
    readonly statusId: string;
  },
): EnvironmentTicket {
  return {
    kind: "local",
    environmentId: LOCAL,
    number: 1,
    title: "Untitled",
    labels: [],
    sortKey: "a0",
    revision: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    createdBy: { type: "user" },
    linkRefs: [],
    attachmentCount: 0,
    plans: [],
    ...overrides,
    id: TicketId.make(overrides.id),
    statusId: TicketStatusId.make(overrides.statusId),
  };
}

const LOGIN = ticket({
  id: "login",
  number: 7,
  title: "Login button misaligned",
  labels: ["bug", "ui"],
  statusId: "local-todo",
  sortKey: "a1",
  linkRefs: [
    { kind: "project", targetKey: "project-web" },
    { kind: "thread", targetKey: "thread-1" },
  ],
});
const CACHE = ticket({
  id: "cache",
  number: 8,
  title: "Cache invalidation",
  labels: ["perf"],
  statusId: "local-todo",
  sortKey: "a0",
});
const SHIPPED = ticket({ id: "shipped", number: 3, title: "Ship it", statusId: "local-done" });
const REMOTE_TODO = ticket({
  id: "remote",
  environmentId: REMOTE,
  number: 1,
  title: "Remote work",
  statusId: "remote-todo",
  sortKey: "a2",
});
const ORPHAN = ticket({ id: "orphan", number: 9, title: "Orphan", statusId: "deleted-status" });

const ALL = [LOGIN, CACHE, SHIPPED, REMOTE_TODO, ORPHAN];
const ids = (tickets: ReadonlyArray<EnvironmentTicket>) => tickets.map((entry) => entry.id);

describe("filterTickets", () => {
  it("matches any selected project while keeping environment identity and other filters", () => {
    const remote = ticket({
      id: "remote",
      environmentId: REMOTE,
      statusId: "remote-todo",
      linkRefs: [{ kind: "project", targetKey: "project-web" }],
    });
    const api = ticket({
      id: "api",
      statusId: "local-todo",
      linkRefs: [{ kind: "project", targetKey: "project-api" }],
    });
    const tickets = [LOGIN, remote, api, CACHE];
    expect(ids(filterTickets(tickets, { project: [`${LOCAL}:project-web`] }, STATUS_SETS))).toEqual(
      ["login"],
    );
    expect(
      ids(
        filterTickets(
          tickets,
          {
            project: [`${LOCAL}:project-web`, `${REMOTE}:project-web`, `${LOCAL}:project-api`],
          },
          STATUS_SETS,
        ),
      ),
    ).toEqual(["login", "remote", "api"]);
    expect(
      ids(
        filterTickets(
          tickets,
          {
            project: [`${LOCAL}:project-web`, `${REMOTE}:project-web`],
            environment: REMOTE,
          },
          STATUS_SETS,
        ),
      ),
    ).toEqual(["remote"]);
    expect(
      ids(
        filterTickets(
          tickets,
          {
            project: [`${LOCAL}:project-web`, `${REMOTE}:project-web`],
            label: "bug",
          },
          STATUS_SETS,
        ),
      ),
    ).toEqual(["login"]);
    expect(ids(filterTickets(tickets, { project: [] }, STATUS_SETS))).toEqual([
      "login",
      "remote",
      "api",
      "cache",
    ]);
  });

  it("combines filters with AND", () => {
    expect(ids(filterTickets(ALL, { label: "bug" }, STATUS_SETS))).toEqual(["login"]);
    expect(ids(filterTickets(ALL, { environment: REMOTE }, STATUS_SETS))).toEqual(["remote"]);
    expect(
      ids(filterTickets(ALL, { project: [`${LOCAL}:project-web`], thread: "linked" }, STATUS_SETS)),
    ).toEqual(["login"]);
    expect(ids(filterTickets(ALL, { thread: "unlinked", label: "bug" }, STATUS_SETS))).toEqual([]);
  });

  it("matches a status filter across environments by category and name", () => {
    expect(ids(filterTickets(ALL, { status: "open:todo" }, STATUS_SETS))).toEqual([
      "login",
      "cache",
      "remote",
    ]);
  });

  it("matches a query against title, ref and labels, plus server body matches", () => {
    expect(ids(filterTickets(ALL, { query: "LOGIN" }, STATUS_SETS))).toEqual(["login"]);
    expect(ids(filterTickets(ALL, { query: "t-8" }, STATUS_SETS))).toEqual(["cache"]);
    expect(ids(filterTickets(ALL, { query: "perf" }, STATUS_SETS))).toEqual(["cache"]);
    expect(
      ids(
        filterTickets(
          ALL,
          { query: "stack trace" },
          STATUS_SETS,
          new Set([ticketKey({ environmentId: LOCAL, ticketId: TicketId.make("shipped") })]),
        ),
      ),
    ).toEqual(["shipped"]);
  });
});

describe("GitHub, link and creator filters", () => {
  const issue = (
    id: string,
    github: { readonly repository: string; readonly author: string | null },
    assignees: ReadonlyArray<string>,
  ): EnvironmentTicket => ({
    ...ticket({ id, title: `Issue ${id}`, statusId: "local-todo", createdBy: { type: "sync" } }),
    kind: "github",
    github: {
      host: "github.com",
      number: 12,
      state: "open",
      stateReason: null,
      assignees,
      updatedAt: "2026-10-01T00:00:00.000Z",
      syncedAt: "2026-10-01T00:00:00.000Z",
      url: `https://github.com/${github.repository}/issues/12`,
      ...github,
    },
    hiddenAt: null,
  });
  const web = issue("web", { repository: "acme/web", author: "octocat" }, ["hubot"]);
  const api = issue("api", { repository: "acme/api", author: "hubot" }, []);
  const ghost = issue("ghost", { repository: "acme/api", author: null }, ["octocat", "hubot"]);
  const agentMade = ticket({
    id: "agent-made",
    statusId: "local-todo",
    createdBy: { type: "agent", threadId: ThreadId.make("thread-9") },
    linkRefs: [{ kind: "pull_request", targetKey: "github.com/acme/web#3" }],
  });
  const BOARD = [LOGIN, web, api, ghost, agentMade];
  const matching = (filters: Parameters<typeof filterTickets>[1]) =>
    ids(filterTickets(BOARD, filters, STATUS_SETS));

  it("narrows GitHub issues by author, assignee and repository, never matching local tickets", () => {
    expect(matching({ author: "octocat" })).toEqual(["web"]);
    expect(matching({ assignee: "hubot" })).toEqual(["web", "ghost"]);
    expect(matching({ assignee: TICKET_NO_ASSIGNEE })).toEqual(["api"]);
    expect(matching({ repository: "acme/api" })).toEqual(["api", "ghost"]);
    expect(matching({ repository: "acme/api", assignee: "octocat" })).toEqual(["ghost"]);
  });

  it("narrows by linked pull request and by who created the ticket", () => {
    expect(matching({ pullRequest: "linked" })).toEqual(["agent-made"]);
    expect(matching({ pullRequest: "unlinked", kind: "local" })).toEqual(["login"]);
    expect(matching({ creator: "agent" })).toEqual(["agent-made"]);
    expect(matching({ creator: "sync" })).toEqual(["web", "api", "ghost"]);
  });
});

describe("hidden GitHub tickets", () => {
  const github = (id: string, hiddenAt: string | null): EnvironmentTicket => ({
    ...ticket({ id, title: `Issue ${id}`, statusId: "local-todo" }),
    kind: "github",
    github: {
      host: "github.com",
      repository: "acme/web",
      number: 12,
      state: "open",
      stateReason: null,
      author: "octocat",
      assignees: [],
      updatedAt: "2026-10-01T00:00:00.000Z",
      syncedAt: "2026-10-01T00:00:00.000Z",
      url: "https://github.com/acme/web/issues/12",
    },
    hiddenAt,
  });
  const tracked = github("tracked", null);
  const untracked = github("untracked", "2026-10-02T00:00:00.000Z");

  it("leaves untracked issues out unless the Hidden filter asks for only them", () => {
    expect(ids(filterTickets([LOGIN, tracked, untracked], {}, STATUS_SETS))).toEqual([
      "login",
      "tracked",
    ]);
    expect(ids(filterTickets([LOGIN, tracked, untracked], { hidden: true }, STATUS_SETS))).toEqual([
      "untracked",
    ]);
  });
});

describe("groupTicketsByStatus", () => {
  it("merges same-named statuses, orders by category, keeps empty ones, and sorts by sort key", () => {
    const groups = groupTicketsByStatus(ALL, STATUS_SETS);
    expect(groups.map((group) => [group.key, group.name, ids(group.tickets)])).toEqual([
      ["open:todo", "Todo", ["cache", "login", "remote"]],
      ["active:in progress", "In progress", []],
      ["active:qa", "QA", []],
      ["closed:done", "Done", ["shipped"]],
      ["unknown", "No status", ["orphan"]],
    ]);
    expect(ticketStatusGroupKey({ category: "open", name: " Todo " })).toBe("open:todo");
  });
});

describe("flattenTicketGroups", () => {
  it("hides empty groups and collapsed groups' tickets, honouring defaults until toggled", () => {
    const groups = groupTicketsByStatus([LOGIN, SHIPPED], STATUS_SETS);
    const describeRows = (overrides: ReadonlyMap<string, boolean>) =>
      flattenTicketGroups(groups, overrides).map((row) =>
        row.type === "group"
          ? `${row.group.name}${row.collapsed ? " (collapsed)" : ""}`
          : row.ticket.id,
      );

    expect(describeRows(new Map())).toEqual(["Todo", "login", "Done (collapsed)"]);
    expect(
      describeRows(
        new Map([
          ["open:todo", true],
          ["closed:done", false],
        ]),
      ),
    ).toEqual(["Todo (collapsed)", "Done", "shipped"]);
  });
});

describe("validateTicketBoardSearch", () => {
  it("normalizes legacy project links and malformed lists without changing canonical lists", () => {
    expect(validateTicketBoardSearch({ project: "env-local:project-web" })).toEqual({
      project: ["env-local:project-web"],
    });
    expect(
      validateTicketBoardSearch({
        project: [
          "env-local:project-web",
          "",
          null,
          42,
          {},
          "   ",
          "env-local:project-web",
          "env-remote:project-web",
        ],
        kind: "github",
      }),
    ).toEqual({
      project: ["env-local:project-web", "env-remote:project-web"],
      kind: "github",
    });
    expect(validateTicketBoardSearch({ project: [] })).toEqual({});
    expect(validateTicketBoardSearch({ project: { key: "env-local:project-web" } })).toEqual({});
    const projects = ["env-local:project-web", "env-remote:project-web"];
    expect(validateTicketBoardSearch({ project: projects }).project).toBe(projects);
  });

  it("keeps known values and drops malformed ones", () => {
    expect(
      validateTicketBoardSearch({
        view: "board",
        kind: "github",
        thread: "sometimes",
        status: "open:todo",
        label: "   ",
        q: 42,
        env: "env-local",
        hidden: true,
        pr: "linked",
        creator: "robot",
        author: "octocat",
        assignee: TICKET_NO_ASSIGNEE,
        repo: "",
      }),
    ).toEqual({
      view: "board",
      kind: "github",
      status: "open:todo",
      env: "env-local",
      hidden: true,
      pr: "linked",
      author: "octocat",
      assignee: TICKET_NO_ASSIGNEE,
    });
    expect(validateTicketBoardSearch({ hidden: "yes" })).toEqual({});
    expect(validateTicketBoardSearch({ view: "list" })).toEqual({ view: "list" });
  });
});

describe("Ticket board preferences", () => {
  it("remembers multiple projects without transient text and prunes only settled missing members", () => {
    const preferences = ticketBoardPreferencesFromSearch({
      view: "board",
      project: ["env-local:project-web", "env-local:project-deleted", "env-remote:project-web"],
      q: "temporary",
    });
    const pruned = reconcileTicketBoardSearch(preferences, {
      projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: ["env-remote"] },
    });
    expect(pruned).toEqual({
      view: "board",
      project: ["env-local:project-web", "env-remote:project-web"],
    });
    expect(
      reconcileTicketBoardSearch(pruned, {
        projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: ["env-remote"] },
      }),
    ).toBe(pruned);
    const settled = reconcileTicketBoardSearch(pruned, {
      projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: [] },
    });
    expect(settled).toEqual({ view: "board", project: ["env-local:project-web"] });
    expect(
      reconcileTicketBoardSearch(settled, {
        projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: [] },
      }),
    ).toBe(settled);
  });

  it("restores all selections on plain entry, without restoring search text", () => {
    expect(
      resolveTicketBoardEntrySearch({
        urlSearch: {},
        rememberedSearch: {
          view: "board",
          status: "open:todo",
          kind: "github",
          project: ["env-local:project-web"],
          label: "bug",
          thread: "linked",
          env: "env-local",
          hidden: true,
          q: "old search",
        },
      }),
    ).toEqual({
      view: "board",
      status: "open:todo",
      kind: "github",
      project: ["env-local:project-web"],
      label: "bug",
      thread: "linked",
      env: "env-local",
      hidden: true,
    });
  });

  it.each([
    [{ view: "list" }, { view: "list" }],
    [{ kind: "local" }, { kind: "local" }],
    [{ q: "current search" }, { q: "current search" }],
    [{ hidden: false }, {}],
    [{ view: "invalid" }, {}],
    [{ status: "" }, {}],
  ])(
    "obeys the entire explicit URL %j without merging remembered fields",
    (urlSearch, expected) => {
      expect(
        resolveTicketBoardEntrySearch({
          urlSearch,
          rememberedSearch: { view: "board", kind: "github", label: "bug", hidden: true },
        }),
      ).toEqual(expected);
    },
  );

  it("only treats board params as an explicit selection", () => {
    expect(hasTicketBoardSearchParams({ unrelated: "value" })).toBe(false);
    expect(hasTicketBoardSearchParams({ q: "" })).toBe(true);
    expect(
      resolveTicketBoardEntrySearch({
        urlSearch: { unrelated: "value" },
        rememberedSearch: { view: "board" },
      }),
    ).toEqual({ view: "board" });
  });

  it("validates remembered input just like URL input and excludes transient text", () => {
    expect(
      ticketBoardPreferencesFromSearch({
        view: "board",
        kind: "invalid",
        thread: 42,
        status: " ",
        label: "bug",
        env: {},
        q: "temporary",
        extra: "ignored",
      }),
    ).toEqual({ view: "board", label: "bug" });
    for (const raw of [null, [], "corrupted", 42]) {
      expect(ticketBoardPreferencesFromSearch(raw)).toEqual({});
    }
  });

  it("clears every filter and query while preserving the view preference", () => {
    expect(
      resetTicketBoardFilters({
        view: "board",
        status: "open:todo",
        kind: "github",
        project: ["env-local:project-web"],
        label: "bug",
        thread: "linked",
        pr: "unlinked",
        creator: "user",
        author: "octocat",
        assignee: "hubot",
        repo: "acme/web",
        env: "env-local",
        hidden: true,
        q: "search",
      }),
    ).toEqual({ view: "board" });
    expect(resetTicketBoardFilters({ view: "list", hidden: true })).toEqual({ view: "list" });
    expect(resetTicketBoardFilters({ kind: "local" })).toEqual({});
  });

  it.each([{}, { view: "board" }, { view: "list" }, { q: "   " }])(
    "hides Clear when filters are at defaults: %j",
    (search) => expect(isDefaultTicketBoardFilters(validateTicketBoardSearch(search))).toBe(true),
  );

  it.each([
    { status: "open:todo" },
    { kind: "local" },
    { project: ["env-local:project-web"] },
    { label: "bug" },
    { thread: "unlinked" },
    { pr: "linked" },
    { creator: "agent" },
    { author: "octocat" },
    { assignee: "hubot" },
    { repo: "acme/web" },
    { env: "env-remote" },
    { hidden: true },
    { q: "search" },
  ])("shows Clear for each active filter: %j", (search) => {
    expect(isDefaultTicketBoardFilters(validateTicketBoardSearch(search))).toBe(false);
  });

  it("drops stale catalog selections while keeping valid and catalog-independent choices", () => {
    expect(
      reconcileTicketBoardSearch(
        {
          view: "board",
          status: "open:deleted",
          project: ["env-deleted:project-deleted"],
          env: "env-deleted",
          kind: "github",
          label: "bug",
          thread: "linked",
          hidden: true,
          q: "current search",
        },
        {
          statuses: ["open:todo"],
          projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: [] },
          environments: ["env-local"],
        },
      ),
    ).toEqual({
      view: "board",
      kind: "github",
      label: "bug",
      thread: "linked",
      hidden: true,
      q: "current search",
    });
  });

  it("keeps selections while their catalogs load and when the selections are still valid", () => {
    const search = { status: "open:todo", project: ["env-local:project-web"], env: "env-local" };
    expect(reconcileTicketBoardSearch(search, {})).toBe(search);
    expect(
      reconcileTicketBoardSearch(search, {
        statuses: ["open:todo"],
        projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: [] },
        environments: ["env-local"],
      }),
    ).toBe(search);
    expect(
      reconcileTicketBoardSearch(search, {
        projects: { keys: [], pendingEnvironmentIds: [] },
      }),
    ).toEqual({
      status: "open:todo",
      env: "env-local",
    });
    expect(
      reconcileTicketBoardSearch(search, {
        projects: { keys: [], pendingEnvironmentIds: ["env-local"] },
      }),
    ).toBe(search);
  });
});

describe("ticketBoardQueryUrlUpdate", () => {
  it("writes settled text and ignores a debounce the box has already left", () => {
    expect(
      ticketBoardQueryUrlUpdate({ query: "login", debouncedQuery: "login", syncedQuery: "" }),
    ).toBe("login");
    expect(
      ticketBoardQueryUrlUpdate({
        query: "login",
        debouncedQuery: "login",
        syncedQuery: "login",
      }),
    ).toBeNull();
    expect(
      ticketBoardQueryUrlUpdate({ query: "", debouncedQuery: "login", syncedQuery: "" }),
    ).toBeNull();
    expect(
      ticketBoardQueryUrlUpdate({ query: "login ", debouncedQuery: "login", syncedQuery: "" }),
    ).toBeNull();
    expect(ticketBoardQueryUrlUpdate({ query: "", debouncedQuery: "", syncedQuery: "login" })).toBe(
      "",
    );
    expect(
      ticketBoardQueryUrlUpdate({ query: "   ", debouncedQuery: "   ", syncedQuery: "" }),
    ).toBeNull();
  });
});

describe("ticket board catalogs", () => {
  const remembered = {
    view: "board" as const,
    status: "open:todo",
    project: ["env-local:project-web"],
    env: "env-remote",
    label: "bug",
    kind: "github" as const,
  };

  it("keeps selections while environments are still starting or not ready", () => {
    expect(ticketBoardEnvironmentPhase({ enabled: true, connectionPhase: "connected" })).toBe(
      "connected",
    );
    expect(ticketBoardEnvironmentPhase({ enabled: true, connectionPhase: "reconnecting" })).toBe(
      "starting",
    );
    expect(ticketBoardEnvironmentPhase({ enabled: true, connectionPhase: "available" })).toBe(
      "starting",
    );
    expect(ticketBoardEnvironmentPhase({ enabled: false, connectionPhase: "connected" })).toBe(
      "offline",
    );
    expect(ticketBoardEnvironmentPhase({ enabled: true, connectionPhase: "offline" })).toBe(
      "offline",
    );
    expect(ticketBoardEnvironmentPhase({ enabled: true, connectionPhase: "error" })).toBe(
      "offline",
    );

    expect(
      resolveTicketBoardCatalogs({
        environmentsReady: false,
        ticketsLoaded: true,
        ticketEnvironmentIds: ["env-local"],
        environments: [{ id: "env-local", phase: "connected", projectIds: [], statusGroups: [] }],
      }),
    ).toEqual({});
    expect(reconcileTicketBoardSearch(remembered, {})).toBe(remembered);

    const starting = resolveTicketBoardCatalogs({
      environmentsReady: true,
      ticketsLoaded: true,
      ticketEnvironmentIds: ["env-local"],
      environments: [{ id: "env-local", phase: "starting" }],
    });
    expect(starting.statuses).toBeUndefined();
    expect(starting.environments).toEqual(["env-local"]);
    expect(reconcileTicketBoardSearch(remembered, starting)).toEqual({
      view: "board",
      status: "open:todo",
      project: ["env-local:project-web"],
      label: "bug",
      kind: "github",
    });
  });

  it("drops filters aimed at an offline environment without waiting for its catalogs", () => {
    const catalogs = resolveTicketBoardCatalogs({
      environmentsReady: true,
      ticketsLoaded: true,
      ticketEnvironmentIds: ["env-local", "env-remote"],
      environments: [
        {
          id: "env-local",
          phase: "connected",
          projectIds: ["project-web"],
          ticketsSupported: true,
          statusGroups: ["open:todo"],
        },
        { id: "env-remote", phase: "offline" },
      ],
    });

    expect(
      reconcileTicketBoardSearch(
        {
          ...remembered,
          status: "open:deleted",
          project: ["env-remote:project-old"],
        },
        catalogs,
      ),
    ).toEqual({ view: "board", label: "bug", kind: "github" });
    expect(
      reconcileTicketBoardSearch(
        { ...remembered, project: ["env-local:project-deleted"], env: "env-local" },
        catalogs,
      ),
    ).toEqual({
      view: "board",
      status: "open:todo",
      env: "env-local",
      label: "bug",
      kind: "github",
    });
    expect(catalogs.statuses).toEqual(["open:todo"]);
  });

  it("keeps the status filter until a connected environment says whether it keeps tickets", () => {
    // On reload the socket connects before the server config, so the board briefly loads
    // with no ticket environments at all.
    const beforeConfig = resolveTicketBoardCatalogs({
      environmentsReady: true,
      ticketsLoaded: true,
      ticketEnvironmentIds: [],
      environments: [{ id: "env-local", phase: "connected", projectIds: ["project-web"] }],
    });
    expect(beforeConfig.statuses).toBeUndefined();
    expect(reconcileTicketBoardSearch({ status: "open:todo" }, beforeConfig)).toEqual({
      status: "open:todo",
    });

    expect(
      resolveTicketBoardCatalogs({
        environmentsReady: true,
        ticketsLoaded: true,
        ticketEnvironmentIds: [],
        environments: [{ id: "env-local", phase: "connected", ticketsSupported: false }],
      }).statuses,
    ).toEqual([]);
  });

  it("prunes nothing while a ticket environment is missing from the presentation", () => {
    expect(
      resolveTicketBoardCatalogs({
        environmentsReady: true,
        ticketsLoaded: true,
        ticketEnvironmentIds: ["env-local"],
        environments: [],
      }),
    ).toEqual({});
  });
});

describe("ticket board restore redirect", () => {
  it("restores a plain visit and leaves an explicit or settled visit alone", () => {
    expect(
      ticketBoardRestoreRedirect({
        urlSearch: {},
        historyState: {},
        rememberedSearch: { view: "board", status: "open:todo", q: "old search" },
      }),
    ).toEqual({ view: "board", status: "open:todo" });
    expect(
      ticketBoardRestoreRedirect({
        urlSearch: { view: "list" },
        historyState: {},
        rememberedSearch: { view: "board", label: "bug" },
      }),
    ).toBeNull();
    expect(
      ticketBoardRestoreRedirect({
        urlSearch: { view: "nope" },
        historyState: {},
        rememberedSearch: { view: "board" },
      }),
    ).toBeNull();
    expect(
      ticketBoardRestoreRedirect({
        urlSearch: {},
        historyState: { ticketBoardSearchSettled: true },
        rememberedSearch: { view: "board", label: "bug" },
      }),
    ).toBeNull();
    expect(ticketBoardHistoryMarksSettledSearch(null)).toBe(false);
    expect(
      ticketBoardRestoreRedirect({
        urlSearch: {},
        historyState: {},
        rememberedSearch: null,
      }),
    ).toBeNull();
  });
});
