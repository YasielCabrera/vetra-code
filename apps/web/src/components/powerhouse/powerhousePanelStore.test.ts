import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PREFERENCES,
  EMPTY_DATABASE_SESSION,
  EMPTY_EXPLORER_SELECTION,
  migratePersistedPowerhousePanelState,
  powerhousePanelProjectKey,
  powerhousePanelWorkspaceKey,
  powerhouseProjectKey,
  powerhouseWorkspaceKey,
  selectPowerhousePreferences,
  usePowerhousePanelStore,
} from "./powerhousePanelStore";

// Two Powerhouse projects inside one monorepo workspace.
const workspace = powerhouseWorkspaceKey("env-1", "/work/mono");
const keyA = powerhouseProjectKey("env-1", "/work/mono", "apps/connect");
const keyB = powerhouseProjectKey("env-1", "/work/mono", "apps/studio");
const surfaceA = "powerhouse-models:panel-a";
const surfaceB = "powerhouse-models:panel-b";
const panelWorkspaceA = powerhousePanelWorkspaceKey(surfaceA, "env-1", "/work/mono");
const panelWorkspaceB = powerhousePanelWorkspaceKey(surfaceB, "env-1", "/work/mono");
const panelKeyA = powerhousePanelProjectKey(surfaceA, "env-1", "/work/mono", "apps/connect");
const panelKeyASecond = powerhousePanelProjectKey(surfaceB, "env-1", "/work/mono", "apps/connect");
const panelKeyB = powerhousePanelProjectKey(surfaceA, "env-1", "/work/mono", "apps/studio");

beforeEach(() => {
  usePowerhousePanelStore.setState({
    byProjectKey: {},
    selectedProjectByWorkspaceKey: {},
    selectedProjectByPanelKey: {},
    modelSelectionByPanelProjectKey: {},
    explorerSelectionByPanelProjectKey: {},
    databaseSessionByPanelProjectKey: {},
  });
});

describe("project selection", () => {
  it("keeps the selected project separate for each panel instance", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectProject(panelWorkspaceA, "apps/connect");
    store.selectProject(panelWorkspaceB, "apps/studio");

    expect(usePowerhousePanelStore.getState().selectedProjectByPanelKey).toMatchObject({
      [panelWorkspaceA]: "apps/connect",
      [panelWorkspaceB]: "apps/studio",
    });
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
  it("defaults to reactor autodetection", () => {
    expect(selectPowerhousePreferences({}, keyA)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.reactorUrlOverride).toBeNull();
  });

  it("keeps the reactor override separate per project", () => {
    const store = usePowerhousePanelStore.getState();
    store.setReactorUrlOverride(keyA, "http://10.0.0.5:4001");
    store.setReactorUrlOverride(keyB, "http://10.0.0.5:4002");

    const { byProjectKey } = usePowerhousePanelStore.getState();
    expect(byProjectKey[keyA]).toEqual({ reactorUrlOverride: "http://10.0.0.5:4001" });
    expect(byProjectKey[keyB]).toEqual({ reactorUrlOverride: "http://10.0.0.5:4002" });
  });

  it("clears the override back to autodetection", () => {
    const store = usePowerhousePanelStore.getState();
    store.setReactorUrlOverride(keyA, "http://10.0.0.5:4001");
    usePowerhousePanelStore.getState().setReactorUrlOverride(keyA, null);
    expect(usePowerhousePanelStore.getState().byProjectKey[keyA]?.reactorUrlOverride).toBeNull();
  });

  it("resets explorer navigation when the reactor address changes", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(panelKeyA, { id: "drive-1", name: "Drive" });
    store.selectDocument(panelKeyA, "doc-1");

    usePowerhousePanelStore.getState().setReactorUrlOverride(keyA, "http://127.0.0.1:5001");

    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[panelKeyA],
    ).toEqual(EMPTY_EXPLORER_SELECTION);
  });

  it("keeps navigation when the same normalized address is submitted again", () => {
    const store = usePowerhousePanelStore.getState();
    store.setReactorUrlOverride(keyA, "http://127.0.0.1:5001");
    usePowerhousePanelStore.getState().selectDrive(panelKeyA, { id: "drive-1", name: "Drive" });

    usePowerhousePanelStore
      .getState()
      .setReactorUrlOverride(keyA, "http://user:secret@127.0.0.1:5001/?token=nope");

    expect(usePowerhousePanelStore.getState().byProjectKey[keyA]?.reactorUrlOverride).toBe(
      "http://127.0.0.1:5001",
    );
    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[panelKeyA]?.driveId,
    ).toBe("drive-1");
  });
});

describe("migratePersistedPowerhousePanelState", () => {
  it("keeps well-formed entries", () => {
    expect(
      migratePersistedPowerhousePanelState({
        byProjectKey: { [keyA]: { mode: "explorer", reactorUrlOverride: "http://x:4001" } },
      }),
    ).toEqual({
      byProjectKey: { [keyA]: { reactorUrlOverride: "http://x:4001" } },
      selectedProjectByWorkspaceKey: {},
      selectedProjectByPanelKey: {},
    });
  });

  it("drops the old inner mode and session-only SQL", () => {
    expect(
      migratePersistedPowerhousePanelState({
        byProjectKey: { [keyA]: { mode: "database", reactorUrlOverride: null } },
        databaseSessionByPanelProjectKey: {
          [keyA]: { ...EMPTY_DATABASE_SESSION, draft: "SELECT secret FROM credentials" },
        },
      }),
    ).toEqual({
      byProjectKey: { [keyA]: { reactorUrlOverride: null } },
      selectedProjectByWorkspaceKey: {},
      selectedProjectByPanelKey: {},
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
        [keyA]: { reactorUrlOverride: null },
        [keyB]: { reactorUrlOverride: null },
      },
      selectedProjectByWorkspaceKey: {},
      selectedProjectByPanelKey: {},
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
      selectedProjectByPanelKey: {},
    });
  });

  it("keeps project choices for repeatable panel instances", () => {
    expect(
      migratePersistedPowerhousePanelState({
        selectedProjectByPanelKey: {
          [panelWorkspaceA]: "apps/connect",
          [panelWorkspaceB]: "apps/studio",
          bogus: 7,
        },
      }).selectedProjectByPanelKey,
    ).toEqual({
      [panelWorkspaceA]: "apps/connect",
      [panelWorkspaceB]: "apps/studio",
    });
  });

  it.each([null, undefined, "nope", 3, { byProjectKey: 7 }, {}])(
    "returns an empty store for %s",
    (persisted) => {
      expect(migratePersistedPowerhousePanelState(persisted)).toEqual({
        byProjectKey: {},
        selectedProjectByWorkspaceKey: {},
        selectedProjectByPanelKey: {},
      });
    },
  );
});

describe("selection", () => {
  it("keeps database target, draft, and bounded history in session state", () => {
    const store = usePowerhousePanelStore.getState();
    store.setDatabaseTarget(panelKeyA, "reactor");
    store.selectDatabaseRelation(panelKeyA, "public", "documents");
    store.setDatabaseDraft(panelKeyA, "SELECT * FROM public.documents");
    store.recordDatabaseQuery(panelKeyA, "SELECT * FROM public.documents");
    store.recordDatabaseQuery(panelKeyA, "SELECT count(*) FROM public.documents");

    expect(
      usePowerhousePanelStore.getState().databaseSessionByPanelProjectKey[panelKeyA],
    ).toMatchObject({
      target: "reactor",
      schema: "public",
      relation: "documents",
      draft: "SELECT * FROM public.documents",
      history: ["SELECT count(*) FROM public.documents", "SELECT * FROM public.documents"],
    });
  });

  it("resets relation selection when the database target changes", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDatabaseRelation(panelKeyA, "public", "documents");
    usePowerhousePanelStore.getState().setDatabaseTarget(panelKeyA, "reactor");
    expect(
      usePowerhousePanelStore.getState().databaseSessionByPanelProjectKey[panelKeyA],
    ).toMatchObject({
      target: "reactor",
      schema: null,
      relation: null,
    });
  });

  it("resets the version picker when a different model is selected", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectModel(panelKeyA, "todo");
    store.selectSpec(panelKeyA, 2);
    expect(usePowerhousePanelStore.getState().modelSelectionByPanelProjectKey[panelKeyA]).toEqual({
      directoryName: "todo",
      specIndex: 2,
    });

    usePowerhousePanelStore.getState().selectModel(panelKeyA, "invoice");
    expect(usePowerhousePanelStore.getState().modelSelectionByPanelProjectKey[panelKeyA]).toEqual({
      directoryName: "invoice",
      specIndex: null,
    });
  });

  it("keeps two model panels on different document models", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectModel(panelKeyA, "invoice");
    store.selectModel(panelKeyASecond, "todo");

    expect(usePowerhousePanelStore.getState().modelSelectionByPanelProjectKey).toMatchObject({
      [panelKeyA]: { directoryName: "invoice", specIndex: null },
      [panelKeyASecond]: { directoryName: "todo", specIndex: null },
    });
  });

  it("walks into folders and back out again", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(panelKeyA, { id: "drive-1", name: "Main" });
    usePowerhousePanelStore.getState().enterFolder(panelKeyA, { id: "folder-1", name: "Invoices" });
    usePowerhousePanelStore.getState().selectDocument(panelKeyA, "doc-1");

    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[panelKeyA],
    ).toEqual({
      driveId: "drive-1",
      path: [
        { id: "drive-1", name: "Main" },
        { id: "folder-1", name: "Invoices" },
      ],
      documentId: "doc-1",
    });

    usePowerhousePanelStore.getState().popToDepth(panelKeyA, 1);
    const selection =
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[panelKeyA];
    expect(selection?.path).toEqual([{ id: "drive-1", name: "Main" }]);
    // Going up closes the document that was open below.
    expect(selection?.documentId).toBeNull();
  });

  it("starts a new drive from an empty path", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(panelKeyA, { id: "drive-1", name: "Main" });
    usePowerhousePanelStore.getState().enterFolder(panelKeyA, { id: "folder-1", name: "Invoices" });
    usePowerhousePanelStore.getState().selectDrive(panelKeyA, { id: "drive-2", name: "Other" });

    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[panelKeyA],
    ).toEqual({
      driveId: "drive-2",
      path: [{ id: "drive-2", name: "Other" }],
      documentId: null,
    });
  });

  it("leaves other projects' selections alone", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectDrive(panelKeyA, { id: "drive-1", name: "Main" });
    expect(
      usePowerhousePanelStore.getState().explorerSelectionByPanelProjectKey[panelKeyB],
    ).toBeUndefined();
  });

  it("removes a closed panel's persisted and session state", () => {
    const store = usePowerhousePanelStore.getState();
    store.selectProject(panelWorkspaceA, "apps/connect");
    store.selectModel(panelKeyA, "invoice");
    store.selectModel(panelKeyASecond, "todo");

    usePowerhousePanelStore.getState().removePanel(surfaceA);

    const state = usePowerhousePanelStore.getState();
    expect(state.selectedProjectByPanelKey[panelWorkspaceA]).toBeUndefined();
    expect(state.modelSelectionByPanelProjectKey[panelKeyA]).toBeUndefined();
    expect(state.modelSelectionByPanelProjectKey[panelKeyASecond]?.directoryName).toBe("todo");
  });
});
