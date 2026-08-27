import type { EnvironmentId, ProjectId } from "@vetra-code/contracts";
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
  return import("./listFilterMemory");
}

const environmentId = "env-1" as EnvironmentId;
const projectId = "project-1" as ProjectId;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("remembered issue filters", () => {
  it("opens on the page's own defaults before anything has been narrowed", async () => {
    const { rememberedIssueFilters } = await loadWithStorage(createStorage());

    expect(rememberedIssueFilters()).toEqual({ state: "open" });
  });

  it("keeps the filter menu's groups and drops the rest of the search", async () => {
    const { rememberIssueFilters, rememberedIssueFilters } = await loadWithStorage(createStorage());

    // The whole search the page holds, not just its filter groups: the search text and the
    // open row travel with it and must not come back on the next visit.
    const search = {
      state: "closed",
      assignee: "@me",
      host: "github.com",
      environmentId,
      projectId,
      q: "rotated",
      repository: "acme/portal",
      number: 12,
    } as const;
    rememberIssueFilters(search);

    expect(rememberedIssueFilters()).toEqual({
      state: "closed",
      assignee: "@me",
      host: "github.com",
      environmentId,
      projectId,
    });
  });

  it("forgets a group once it is cleared back to unfiltered", async () => {
    const { rememberIssueFilters, rememberedIssueFilters } = await loadWithStorage(createStorage());

    rememberIssueFilters({ state: "all", assignee: "@none", projectId });
    rememberIssueFilters({ state: "all" });

    expect(rememberedIssueFilters()).toEqual({ state: "all" });
  });

  it("falls back to the defaults when the stored record cannot be read", async () => {
    const storage = createStorage();
    const { ISSUE_LIST_FILTERS_STORAGE_KEY, rememberedIssueFilters } =
      await loadWithStorage(storage);
    storage.setItem(ISSUE_LIST_FILTERS_STORAGE_KEY, '{"state":"sideways"}');
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(rememberedIssueFilters()).toEqual({ state: "open" });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("remembered pull request filters", () => {
  it("opens on the page's own defaults before anything has been narrowed", async () => {
    const { rememberedPullRequestFilters } = await loadWithStorage(createStorage());

    expect(rememberedPullRequestFilters()).toEqual({ state: "open", involvement: "all" });
  });

  it("keeps every group the filter menu narrows by", async () => {
    const { rememberPullRequestFilters, rememberedPullRequestFilters } =
      await loadWithStorage(createStorage());

    rememberPullRequestFilters({
      state: "merged",
      involvement: "reviewing",
      draft: "hide",
      review: "approved",
      checks: "passing",
      host: "github.com",
      environmentId,
      projectId,
    });

    expect(rememberedPullRequestFilters()).toEqual({
      state: "merged",
      involvement: "reviewing",
      draft: "hide",
      review: "approved",
      checks: "passing",
      host: "github.com",
      environmentId,
      projectId,
    });
  });

  it("keeps the two required groups apart from the ones that can be cleared", async () => {
    const { rememberPullRequestFilters, rememberedPullRequestFilters } =
      await loadWithStorage(createStorage());

    rememberPullRequestFilters({ state: "all", involvement: "authored", draft: "only" });
    rememberPullRequestFilters({ state: "all", involvement: "authored" });

    expect(rememberedPullRequestFilters()).toEqual({ state: "all", involvement: "authored" });
  });

  it("survives storage that refuses to be written", async () => {
    const storage = createStorage();
    const { rememberPullRequestFilters, rememberedPullRequestFilters } =
      await loadWithStorage(storage);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };

    expect(() => rememberPullRequestFilters({ state: "closed", involvement: "all" })).not.toThrow();
    expect(rememberedPullRequestFilters()).toEqual({ state: "open", involvement: "all" });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
