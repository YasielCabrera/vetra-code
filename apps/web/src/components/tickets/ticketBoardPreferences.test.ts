import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveTicketBoardCatalogs, ticketBoardEnvironmentPhase } from "./ticketBoard.logic";

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

async function loadWithStorage(storage: Storage) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  return import("./ticketBoardPreferences");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("ticket board preferences", () => {
  it.each([
    { enabled: true, connectionPhase: "offline" as const },
    { enabled: true, connectionPhase: "error" as const },
    { enabled: false, connectionPhase: "connected" as const },
  ])("keeps saved remote filters while unavailable (%j)", async (connection) => {
    const storage = createStorage();
    const preferences = await loadWithStorage(storage);
    preferences.rememberTicketBoardSearch({
      env: "env-remote",
      project: ["env-remote:project-web"],
      status: "open:remote",
    });
    const catalogs = resolveTicketBoardCatalogs({
      environmentsReady: true,
      ticketsLoaded: true,
      ticketEnvironmentIds: ["env-local"],
      environments: [
        {
          id: "env-local",
          phase: "connected",
          projectIds: [],
          ticketsSupported: true,
          statusGroups: ["open:todo"],
        },
        { id: "env-remote", phase: ticketBoardEnvironmentPhase(connection) },
      ],
    });
    preferences.persistReconciledTicketBoardPreferences(catalogs);
    expect(preferences.readTicketBoardPreferences()).toEqual({
      env: "env-remote",
      project: ["env-remote:project-web"],
      status: "open:remote",
    });
  });

  it.each([true, false])(
    "prunes invalid filters once the remote is connected or removed (%s)",
    async (connected) => {
      const storage = createStorage();
      const preferences = await loadWithStorage(storage);
      preferences.rememberTicketBoardSearch({
        env: "env-remote",
        project: ["env-remote:project-deleted", "env-local:project-web"],
        status: "open:deleted",
      });
      preferences.persistReconciledTicketBoardPreferences(
        resolveTicketBoardCatalogs({
          environmentsReady: true,
          ticketsLoaded: true,
          ticketEnvironmentIds: connected ? ["env-local", "env-remote"] : ["env-local"],
          environments: [
            {
              id: "env-local",
              phase: "connected",
              projectIds: ["project-web"],
              ticketsSupported: true,
              statusGroups: ["open:todo"],
            },
            ...(connected
              ? [
                  {
                    id: "env-remote",
                    phase: "connected" as const,
                    projectIds: [],
                    ticketsSupported: true,
                    statusGroups: [],
                  },
                ]
              : []),
          ],
        }),
      );
      expect(preferences.readTicketBoardPreferences()).toEqual({
        ...(connected ? { env: "env-remote" } : {}),
        project: ["env-local:project-web"],
      });
    },
  );

  it("prunes removed and connected deleted projects while another environment is offline", async () => {
    const storage = createStorage();
    const preferences = await loadWithStorage(storage);
    preferences.rememberTicketBoardSearch({
      env: "env-removed",
      project: ["env-removed:project-old", "env-local:project-deleted", "env-remote:project-web"],
      status: "open:remote",
    });
    preferences.persistReconciledTicketBoardPreferences(
      resolveTicketBoardCatalogs({
        environmentsReady: true,
        ticketsLoaded: true,
        ticketEnvironmentIds: ["env-local"],
        environments: [
          {
            id: "env-local",
            phase: "connected",
            projectIds: [],
            ticketsSupported: true,
            statusGroups: ["open:todo"],
          },
          { id: "env-remote", phase: "offline" },
        ],
      }),
    );
    expect(preferences.readTicketBoardPreferences()).toEqual({
      project: ["env-remote:project-web"],
      status: "open:remote",
    });
  });

  it("reads legacy project selections and persists multiple projects across visits", async () => {
    const storage = createStorage();
    const preferences = await loadWithStorage(storage);
    storage.setItem(
      "vetra:ticket-board-preferences:v1",
      JSON.stringify({
        project: "env-local:project-web",
        view: "board",
        q: "old search",
      }),
    );
    expect(preferences.readTicketBoardPreferences()).toEqual({
      project: ["env-local:project-web"],
      view: "board",
    });
    preferences.rememberTicketBoardSearch({
      project: ["env-local:project-web", "env-remote:project-web"],
      view: "board",
      q: "current search",
    });
    expect(preferences.readTicketBoardPreferences()).toEqual({
      project: ["env-local:project-web", "env-remote:project-web"],
      view: "board",
    });
    preferences.persistReconciledTicketBoardPreferences({
      projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: [] },
    });
    expect(preferences.readTicketBoardPreferences()).toEqual({
      project: ["env-local:project-web"],
      view: "board",
    });
  });

  it("ignores corrupted and old-format records", async () => {
    const storage = createStorage();
    const preferences = await loadWithStorage(storage);
    preferences.rememberTicketBoardSearch({ view: "board", label: "bug" });
    const key = storage.key(0);
    expect(key).toBe("vetra:ticket-board-preferences:v1");

    storage.setItem(key!, "not-json");
    expect(preferences.readTicketBoardPreferences()).toEqual({});

    storage.setItem(key!, JSON.stringify(["legacy-list"]));
    expect(preferences.readTicketBoardPreferences()).toEqual({});

    storage.setItem(
      key!,
      JSON.stringify({
        view: "board",
        q: "secret",
        kind: "nope",
        filters: { status: "open:todo" },
      }),
    );
    expect(preferences.readTicketBoardPreferences()).toEqual({ view: "board" });
  });

  it("prunes stale remembered selections without copying an explicit visit", async () => {
    const storage = createStorage();
    const preferences = await loadWithStorage(storage);
    preferences.rememberTicketBoardSearch({
      view: "board",
      status: "open:deleted",
      project: ["env-remote:project-old"],
      env: "env-remote",
      label: "bug",
      kind: "github",
      q: "not stored",
    });
    const writes = vi.spyOn(storage, "setItem");

    preferences.persistReconciledTicketBoardPreferences({});
    expect(writes).not.toHaveBeenCalled();
    expect(preferences.readTicketBoardPreferences()).toEqual({
      view: "board",
      status: "open:deleted",
      project: ["env-remote:project-old"],
      env: "env-remote",
      label: "bug",
      kind: "github",
    });

    preferences.persistReconciledTicketBoardPreferences({
      statuses: ["open:todo"],
      projects: { keys: ["env-local:project-web"], pendingEnvironmentIds: [] },
      environments: ["env-local"],
    });
    expect(preferences.readTicketBoardPreferences()).toEqual({
      view: "board",
      label: "bug",
      kind: "github",
    });
    expect(writes).toHaveBeenCalledTimes(1);
  });
});
