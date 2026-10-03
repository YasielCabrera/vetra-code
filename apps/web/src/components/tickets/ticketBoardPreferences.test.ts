import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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
      project: "env-remote:project-old",
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
      project: "env-remote:project-old",
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
