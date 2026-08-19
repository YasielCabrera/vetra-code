import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PREFERENCES,
  EMPTY_EXPLORER_SELECTION,
  migratePersistedPowerhousePanelState,
  powerhouseProjectKey,
  powerhouseWorkspaceKey,
  selectPowerhousePreferences,
  usePowerhousePanelStore,
} from "./powerhousePanelStore";

// Two Powerhouse projects inside one monorepo workspace.
const workspace = powerhouseWorkspaceKey("env-1", "/work/mono");
const keyA = powerhouseProjectKey("env-1", "/work/mono", "apps/connect");
const keyB = powerhouseProjectKey("env-1", "/work/mono", "apps/studio");

beforeEach(() => {
  usePowerhousePanelStore.setState({
    byProjectKey: {},
    selectedProjectByWorkspaceKey: {},
    modelSelectionByProjectKey: {},
    explorerSelectionByProjectKey: {},
  });
});

describe("project selection", () => {
  it("remembers which project of a workspace the panel shows", () => {
    usePowerhousePanelStore.getState().selectProject(workspace, "apps/studio");
    expect(usePowerhousePanelStore.getState().selectedProjectByWorkspaceKey[workspace]).toBe(
      "apps/studio",
    );
  });

  it("keeps reactor overrides apart for two projects in one workspace", () => {
    const store = usePowerhousePanelStore.getState();
    store.setReactorUrlOverride(keyA, "http://127.0.0.1:4001");
    store.setReactorUrlOverride(keyB, "http://127.0.0.1:4002");
    const { byProjectKey } = usePowerhousePanelStore.getState();
    expect(byProjectKey[keyA]?.reactorUrlOverride).toBe("http://127.0.0.1:4001");
    expect(byProjectKey[keyB]?.reactorUrlOverride).toBe("http://127.0.0.1:4002");
  });
});

describe("preferences", () => {
  it("defaults to the mode that works without a reactor", () => {
    expect(selectPowerhousePreferences({}, keyA)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.mode).toBe("models");
  });

  it("keeps mode and reactor override separate per project", () => {
    const store = usePowerhousePanelStore.getState();
    store.setMode(keyA, "explorer");
    store.setReactorUrlOverride(keyA, "http://10.0.0.5:4001");
    store.setMode(keyB, "models");

    const { byProjectKey } = usePowerhousePanelStore.getState();
    expect(byProjectKey[keyA]).toEqual({
      mode: "explorer",
      reactorUrlOverride: "http://10.0.0.5:4001",
    });
    expect(byProjectKey[keyB]).toEqual({ mode: "models", reactorUrlOverride: null });
  });

  it("clears the override back to autodetection", () => {
    const store = usePowerhousePanelStore.getState();
    store.setReactorUrlOverride(keyA, "http://10.0.0.5:4001");
    usePowerhousePanelStore.getState().setReactorUrlOverride(keyA, null);
    expect(usePowerhousePanelStore.getState().byProjectKey[keyA]?.reactorUrlOverride).toBeNull();
  });

  it("resets explorer navigation when the reactor address changes", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(keyA, { id: "drive-1", name: "Drive" });
    store.selectDocument(keyA, "doc-1");

    usePowerhousePanelStore.getState().setReactorUrlOverride(keyA, "http://127.0.0.1:5001");

    expect(usePowerhousePanelStore.getState().explorerSelectionByProjectKey[keyA]).toEqual(
      EMPTY_EXPLORER_SELECTION,
    );
  });

  it("keeps navigation when the same normalized address is submitted again", () => {
    const store = usePowerhousePanelStore.getState();
    store.setReactorUrlOverride(keyA, "http://127.0.0.1:5001");
    usePowerhousePanelStore.getState().selectDrive(keyA, { id: "drive-1", name: "Drive" });

    usePowerhousePanelStore
      .getState()
      .setReactorUrlOverride(keyA, "http://user:secret@127.0.0.1:5001/?token=nope");

    expect(usePowerhousePanelStore.getState().byProjectKey[keyA]?.reactorUrlOverride).toBe(
      "http://127.0.0.1:5001",
    );
    expect(usePowerhousePanelStore.getState().explorerSelectionByProjectKey[keyA]?.driveId).toBe(
      "drive-1",
    );
  });
});

describe("migratePersistedPowerhousePanelState", () => {
  it("keeps well-formed entries", () => {
    expect(
      migratePersistedPowerhousePanelState({
        byProjectKey: { [keyA]: { mode: "explorer", reactorUrlOverride: "http://x:4001" } },
      }),
    ).toEqual({
      byProjectKey: { [keyA]: { mode: "explorer", reactorUrlOverride: "http://x:4001" } },
      selectedProjectByWorkspaceKey: {},
    });
  });

  it("sanitizes a persisted reactor address", () => {
    expect(
      migratePersistedPowerhousePanelState({
        byProjectKey: {
          [keyA]: {
            mode: "explorer",
            reactorUrlOverride: "http://user:secret@x:4001/?token=nope#fragment",
          },
        },
      }).byProjectKey[keyA]?.reactorUrlOverride,
    ).toBe("http://x:4001");
  });

  it("repairs an entry rather than dropping the whole store", () => {
    expect(
      migratePersistedPowerhousePanelState({
        byProjectKey: {
          [keyA]: { mode: "nonsense", reactorUrlOverride: "   " },
          [keyB]: { mode: "explorer" },
        },
      }),
    ).toEqual({
      byProjectKey: {
        [keyA]: { mode: "models", reactorUrlOverride: null },
        [keyB]: { mode: "explorer", reactorUrlOverride: null },
      },
      selectedProjectByWorkspaceKey: {},
    });
  });

  it("carries the chosen project of each workspace across a reload", () => {
    expect(
      migratePersistedPowerhousePanelState({
        byProjectKey: {},
        selectedProjectByWorkspaceKey: { [workspace]: "apps/connect", bogus: 7 },
      }),
    ).toEqual({
      byProjectKey: {},
      selectedProjectByWorkspaceKey: { [workspace]: "apps/connect" },
    });
  });

  it.each([null, undefined, "nope", 3, { byProjectKey: 7 }, {}])(
    "returns an empty store for %s",
    (persisted) => {
      expect(migratePersistedPowerhousePanelState(persisted)).toEqual({
        byProjectKey: {},
        selectedProjectByWorkspaceKey: {},
      });
    },
  );
});

describe("selection", () => {
  it("resets the version picker when a different model is selected", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectModel(keyA, "todo");
    store.selectSpec(keyA, 2);
    expect(usePowerhousePanelStore.getState().modelSelectionByProjectKey[keyA]).toEqual({
      directoryName: "todo",
      specIndex: 2,
    });

    usePowerhousePanelStore.getState().selectModel(keyA, "invoice");
    expect(usePowerhousePanelStore.getState().modelSelectionByProjectKey[keyA]).toEqual({
      directoryName: "invoice",
      specIndex: null,
    });
  });

  it("walks into folders and back out again", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(keyA, { id: "drive-1", name: "Main" });
    usePowerhousePanelStore.getState().enterFolder(keyA, { id: "folder-1", name: "Invoices" });
    usePowerhousePanelStore.getState().selectDocument(keyA, "doc-1");

    expect(usePowerhousePanelStore.getState().explorerSelectionByProjectKey[keyA]).toEqual({
      driveId: "drive-1",
      path: [
        { id: "drive-1", name: "Main" },
        { id: "folder-1", name: "Invoices" },
      ],
      documentId: "doc-1",
    });

    usePowerhousePanelStore.getState().popToDepth(keyA, 1);
    const selection = usePowerhousePanelStore.getState().explorerSelectionByProjectKey[keyA];
    expect(selection?.path).toEqual([{ id: "drive-1", name: "Main" }]);
    // Going up closes the document that was open below.
    expect(selection?.documentId).toBeNull();
  });

  it("starts a new drive from an empty path", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(keyA, { id: "drive-1", name: "Main" });
    usePowerhousePanelStore.getState().enterFolder(keyA, { id: "folder-1", name: "Invoices" });
    usePowerhousePanelStore.getState().selectDrive(keyA, { id: "drive-2", name: "Other" });

    expect(usePowerhousePanelStore.getState().explorerSelectionByProjectKey[keyA]).toEqual({
      driveId: "drive-2",
      path: [{ id: "drive-2", name: "Other" }],
      documentId: null,
    });
  });

  it("leaves other projects' selections alone", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(keyA, { id: "drive-1", name: "Main" });
    expect(usePowerhousePanelStore.getState().explorerSelectionByProjectKey[keyB]).toBeUndefined();
  });
});
