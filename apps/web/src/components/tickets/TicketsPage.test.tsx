// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TicketsPage } from "./TicketsPage";
import {
  TICKET_BOARD_SEARCH_SETTLED,
  ticketBoardRestoreRedirect,
  validateTicketBoardSearch,
} from "./ticketBoard.logic";
import { readTicketBoardPreferences, rememberTicketBoardSearch } from "./ticketBoardPreferences";
import type { TicketFilterSection } from "./ticketPresentation";

const { board, environments, projects, sources, searchBodies } = vi.hoisted(() => {
  const projects: Array<{ environmentId: string; id: string; title: string }> = [];
  const environmentIds: string[] = [];
  return {
    board: { tickets: [], loaded: true, environmentIds, statusSets: new Map() },
    environments: { environments: [], isReady: true },
    projects,
    sources: [],
    searchBodies: vi.fn(),
  };
});

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../../connection/catalog", () => ({ environmentCatalog: {} }));
vi.mock("../../state/shell", () => ({ environmentShell: {} }));
vi.mock("../../state/tickets", () => ({
  ticketEnvironment: { search: {} },
  useTickets: () => board,
  useTicketGitHubSources: () => sources,
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => projects,
  useThreadShells: () => [],
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => environments,
  usePrimaryEnvironmentId: () => null,
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => searchBodies }));
vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => ({}) }));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../hostedPairing", () => ({ isHostedStaticApp: () => false }));
vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  return { cn: cx };
});
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: ({ children }: { children: ReactNode }) => children,
  WorkspaceBreadcrumbItem: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("../EnvironmentMachineIcon", () => ({ EnvironmentMachineIcon: () => null }));
vi.mock("../SourceControlActorAvatar", () => ({ SourceControlActorAvatar: () => null }));
vi.mock("./TicketKanban", () => ({ TicketKanban: () => null }));
vi.mock("./TicketListRow", () => ({ TicketRow: () => null, TICKET_LIST_ROW_HEIGHT: 40 }));
vi.mock("@legendapp/list/react", () => ({ LegendList: () => null }));
vi.mock("./ticketPresentation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ticketPresentation")>()),
  TicketStatusIcon: () => null,
  TicketFilterChip: () => null,
  TicketFilterButton: ({ sections }: { sections: ReadonlyArray<TicketFilterSection> }) => (
    <div>
      {sections
        .flatMap((section) => section.fields)
        .map((field) =>
          field.options.map((option) => (
            <button
              key={`${field.key}:${option.value}`}
              onClick={() =>
                field.selection === "multiple"
                  ? field.onToggle(option.value, !field.value.includes(option.value))
                  : field.onChange(option.value)
              }
            >
              {field.label}: {option.label}
            </button>
          )),
        )}
    </div>
  ),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", vi.fn());
  localStorage.clear();
  projects.length = 0;
  board.environmentIds.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openBoard(initialEntry: string) {
  const rootRoute = createRootRoute();
  const ticketsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tickets/",
    component: TicketsPage,
    validateSearch: validateTicketBoardSearch,
    beforeLoad: ({ location }) => {
      const search = ticketBoardRestoreRedirect({
        urlSearch: location.search,
        historyState: location.state,
        rememberedSearch: readTicketBoardPreferences(),
      });
      if (search !== null) throw redirect({ to: "/tickets", search, replace: true });
    },
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([ticketsRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}

function button(label: string) {
  const control = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent === label,
  );
  if (control === undefined) throw new Error(`Missing control: ${label}`);
  return control;
}

describe("Tickets board search navigation", () => {
  it("keeps rapid project selections, removes individual projects and remembers the remaining filter", async () => {
    board.environmentIds.push("env-local", "env-remote");
    projects.push(
      { environmentId: "env-local", id: "web", title: "Web" },
      { environmentId: "env-remote", id: "api", title: "API" },
    );
    const router = await openBoard("/tickets?view=board&kind=local");
    await act(async () => {
      button("Project: Web").click();
      button("Project: API").click();
      button("Project: Web").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({
      view: "board",
      kind: "local",
      project: ["env-local:web", "env-remote:api"],
    });
    expect(readTicketBoardPreferences()).toEqual({
      view: "board",
      kind: "local",
      project: ["env-local:web", "env-remote:api"],
    });
    await act(async () => {
      button("Project: Web").click();
      button("List view").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({
      view: "list",
      kind: "local",
      project: ["env-remote:api"],
    });
    expect(readTicketBoardPreferences()).toEqual({
      view: "list",
      kind: "local",
      project: ["env-remote:api"],
    });
    await act(async () => {
      button("Project: API").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({ view: "list", kind: "local" });
    expect(readTicketBoardPreferences()).toEqual({ view: "list", kind: "local" });
  });

  it("keeps filters cleared when switching view before the route rerenders", async () => {
    rememberTicketBoardSearch({ view: "board", kind: "github" });
    const router = await openBoard("/tickets?view=board&kind=github");
    await act(async () => {
      button("Clear").click();
      button("List view").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({ view: "list" });
    expect(readTicketBoardPreferences()).toEqual({ view: "list" });
  });

  it("keeps both independently changed filters before the route rerenders", async () => {
    const router = await openBoard("/tickets?view=board");
    await act(async () => {
      button("Kind: GitHub").click();
      button("Thread: Has a linked thread").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({
      view: "board",
      kind: "github",
      thread: "linked",
    });
    expect(readTicketBoardPreferences()).toEqual({
      view: "board",
      kind: "github",
      thread: "linked",
    });
  });

  it("preserves a just-selected view when clearing filters before the route rerenders", async () => {
    const router = await openBoard("/tickets?view=board&kind=github");
    await act(async () => {
      button("List view").click();
      button("Clear").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({ view: "list" });
    expect(readTicketBoardPreferences()).toEqual({ view: "list" });
  });

  it("keeps a cleared history entry empty when remembered filters later change", async () => {
    rememberTicketBoardSearch({ kind: "github" });
    const router = await openBoard("/tickets?kind=github");
    await act(async () => {
      button("Clear").click();
      await router.load();
    });
    expect(router.state.location.search).toEqual({});
    expect(router.state.location.state[TICKET_BOARD_SEARCH_SETTLED]).toBe(true);
    expect(readTicketBoardPreferences()).toEqual({});
    rememberTicketBoardSearch({ kind: "local" });
    await act(async () => router.load());
    expect(router.state.location.search).toEqual({});
    expect(readTicketBoardPreferences()).toEqual({ kind: "local" });
  });
});
