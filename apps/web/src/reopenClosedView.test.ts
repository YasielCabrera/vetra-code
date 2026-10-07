import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";
import { __setClientSettingsForTests } from "./hooks/useSettings";
import {
  powerhousePanelProjectKey,
  powerhousePanelWorkspaceKey,
  usePowerhousePanelStore,
} from "./components/powerhouse/powerhousePanelStore";
import { readThreadPreviewState, resetPreviewStateForTests } from "./previewStateStore";
import {
  planNextReopen,
  pullRequestsSearchForRestore,
  type ReopenOwnerState,
  reopenClosedView,
} from "./reopenClosedView";
import {
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};
const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "old-tab",
  navStatus: { _tag: "Success", url: "https://example.com", title: "Example" },
  canGoBack: false,
  canGoForward: false,
  viewport: { _tag: "freeform", width: 1200, height: 800 },
  profileId: "work",
  updatedAt: "2026-09-22T12:00:00.000Z",
};

beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  resetPreviewStateForTests();
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("reopenClosedView", () => {
  it("restores a file tab at its line without creating a browser session", async () => {
    const openPreview = vi.fn();
    const reopened = await reopenClosedView(
      {
        kind: "panel-tab",
        threadRef,
        surface: {
          kind: "file",
          id: "file:src/app.ts",
          relativePath: "src/app.ts",
          revealLine: 18,
          revealRequestId: 1,
        },
      },
      { openPreview, workspaceAvailable: true },
    );
    expect(reopened).toBe(true);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
    expect(state.isOpen).toBe(true);
    expect(state.surfaces).toMatchObject([{ id: "file:src/app.ts", revealLine: 18 }]);
    expect(openPreview).not.toHaveBeenCalled();
  });

  it("does not reopen workspace tabs without an available project", async () => {
    const options = {
      openPreview: vi.fn(),
      workspaceAvailable: false,
    };
    for (const surface of [
      { kind: "files", id: "files" },
      {
        kind: "file",
        id: "file:src/app.ts",
        relativePath: "src/app.ts",
        revealLine: null,
        revealRequestId: 0,
      },
    ] as const) {
      expect(await reopenClosedView({ kind: "panel-tab", threadRef, surface }, options)).toBe(
        false,
      );
    }
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
    ).toEqual([]);
  });

  it.each([true, false])("restores a closed file's preview status (%s)", async (preview) => {
    const store = useRightPanelStore.getState();
    store.openFile(threadRef, "src/app.ts", 18, { preview });
    store.closeSurface(threadRef, "file:src/app.ts");
    const closed = useClosedViewStore.getState().entries[0]!;
    // A restored preview replaces another preview, while a pinned tab keeps it.
    store.openFile(threadRef, "src/other.ts", undefined, { preview: true });
    expect(await reopenClosedView(closed, { openPreview: vi.fn(), workspaceAvailable: true })).toBe(
      true,
    );
    const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
    expect(panel.activeSurfaceId).toBe("file:src/app.ts");
    expect(panel.surfaces.find((surface) => surface.id === "file:src/app.ts")).toEqual(
      closed.kind === "panel-tab" ? closed.surface : null,
    );
    expect(panel.surfaces).toHaveLength(preview ? 1 : 2);
  });

  it("restores a Powerhouse tab with its original project, path, and document", async () => {
    const store = useRightPanelStore.getState();
    store.openPowerhouse(threadRef, "powerhouse-explorer");
    const surface = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    ).surfaces[0]!;
    const workspaceKey = powerhousePanelWorkspaceKey(
      surface.id,
      threadRef.environmentId,
      "/workspace",
    );
    const projectKey = powerhousePanelProjectKey(
      surface.id,
      threadRef.environmentId,
      "/workspace",
      "apps/connect",
    );
    const powerhouse = usePowerhousePanelStore.getState();
    powerhouse.selectProject(workspaceKey, "apps/connect");
    powerhouse.selectDrive(projectKey, { id: "drive", name: "Drive" });
    powerhouse.enterFolder(projectKey, { id: "folder", name: "Folder" });
    powerhouse.selectDocument(projectKey, "document");
    const selection =
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[projectKey];
    store.closeSurface(threadRef, surface.id);
    const closed = useClosedViewStore.getState().entries[0]!;
    expect(await reopenClosedView(closed, { openPreview: vi.fn(), workspaceAvailable: true })).toBe(
      true,
    );
    useClosedViewStore.getState().remove(closed.id);
    const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
    expect(panel.activeSurfaceId).toBe(surface.id);
    expect(panel.surfaces).toEqual([surface]);
    expect(usePowerhousePanelStore.getState().selectedProjectByPanelKey[workspaceKey]).toBe(
      "apps/connect",
    );
    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[projectKey],
    ).toEqual(selection);
  });

  it("discards a closed Powerhouse tab's selection when it leaves the history limit", () => {
    const store = useRightPanelStore.getState();
    store.openPowerhouse(threadRef, "powerhouse-explorer");
    const surface = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    ).surfaces[0]!;
    const projectKey = powerhousePanelProjectKey(
      surface.id,
      threadRef.environmentId,
      "/workspace",
      "apps/connect",
    );
    usePowerhousePanelStore.getState().selectDocument(projectKey, "document");
    store.closeSurface(threadRef, surface.id);
    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[projectKey]?.documentId,
    ).toBe("document");
    for (let index = 0; index < 20; index++) {
      store.openFile(threadRef, `file-${index}.ts`);
      store.closeSurface(threadRef, `file:file-${index}.ts`);
    }
    expect(useClosedViewStore.getState().entries).toHaveLength(20);
    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[projectKey],
    ).toBeUndefined();
  });

  it("recreates a browser tab with saved URL, viewport and profile, then selects its new ID", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "new-tab" }));
    const result = await reopenClosedView(
      { kind: "browser", threadRef, snapshot },
      { openPreview, workspaceAvailable: false },
    );
    expect(result).toBe(true);
    expect(openPreview).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        url: "https://example.com",
        viewport: snapshot.viewport,
        profileId: "work",
      },
    });
    expect(readThreadPreviewState(threadRef).snapshot?.tabId).toBe("new-tab");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef)
        .activeSurfaceId,
    ).toBe("browser:new-tab");
  });

  it("leaves the panel unchanged when a browser resource fails to reopen", async () => {
    const result = await reopenClosedView(
      { kind: "browser", threadRef, snapshot },
      {
        openPreview: async () => AsyncResult.failure(Cause.fail(new Error("offline"))),
        workspaceAvailable: false,
      },
    );
    expect(result).toBe(false);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
    ).toEqual([]);
  });
});

describe("planNextReopen", () => {
  const entries: ClosedViewEntry[] = [
    { id: "a", kind: "panel-tab", threadRef, surface: { kind: "diff", id: "diff" } },
    { id: "b", kind: "panel-tab", threadRef, surface: { kind: "files", id: "files" } },
  ];
  const known: ReopenOwnerState = {
    environmentKnown: true,
    catalogReady: true,
    ownerExists: true,
    shellLive: true,
    panel: { isOpen: false, activeSurfaceId: null, surfaces: [] },
  };
  const openDiff: ThreadRightPanelState = {
    isOpen: true,
    activeSurfaceId: "diff",
    surfaces: [{ kind: "diff", id: "diff" }],
  };

  it.each([
    ["restores the newest entry", [known, known], [], "a"],
    [
      "drops a removed environment once the catalog is ready",
      [{ ...known, environmentKnown: false }, known],
      ["a"],
      "b",
    ],
    [
      "waits for the catalog before dropping",
      [{ ...known, environmentKnown: false, catalogReady: false }, known],
      [],
      null,
    ],
    [
      "skips but keeps a thread deleted from a live shell",
      [{ ...known, ownerExists: false }, known],
      [],
      "b",
    ],
    [
      "waits when a cached shell lacks the thread",
      [{ ...known, ownerExists: false, shellLive: false }, known],
      [],
      null,
    ],
    ["drops a tab that is already open", [{ ...known, panel: openDiff }, known], ["a"], "b"],
    [
      "restores a tab whose panel is hidden",
      [{ ...known, panel: { ...openDiff, isOpen: false } }],
      [],
      "a",
    ],
  ] as const)("%s", (_name, owners, dropped, restored) => {
    const plan = planNextReopen(
      entries.slice(0, owners.length),
      (e) => owners[entries.indexOf(e)]!,
    );
    expect(plan.drop.map((e) => e.id)).toEqual(dropped);
    expect(plan.restore?.id ?? null).toBe(restored);
  });
});

describe("pullRequestsSearchForRestore", () => {
  it("replaces the selection and keeps list filters", () => {
    const search = pullRequestsSearchForRestore(
      {
        involvement: "reviewing",
        state: "open",
        q: "mine",
        host: "filter.example.com",
        selectedHost: "old",
        number: 1,
      },
      {
        kind: "pull-request",
        id: "pull-request:example",
        repository: "owner/repo",
        number: 42,
        projectId: "project-1",
        environmentId: "remote",
        host: "github.example.com",
      },
    );
    expect(search).toEqual({
      involvement: "reviewing",
      state: "open",
      q: "mine",
      host: "filter.example.com",
      repository: "owner/repo",
      number: 42,
      selectedProjectId: "project-1",
      selectedHost: "github.example.com",
      selectedEnvironmentId: "remote",
    });
  });

  it("clears a stale selection and fills default filters when nothing is selected", () => {
    expect(pullRequestsSearchForRestore({ repository: "old/repo", number: 7 }, null)).toEqual({
      involvement: "all",
      state: "open",
    });
  });
});
