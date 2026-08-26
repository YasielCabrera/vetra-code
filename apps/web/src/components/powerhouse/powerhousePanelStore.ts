/**
 * Powerhouse panel state, split by how long it should live.
 *
 * Persisted per project: an explicit reactor URL when autodetection is not what
 * the user wants. Persisted per panel: which project that panel shows.
 *
 * Session-only: what each panel instance currently has selected. Restoring a
 * document selection across a reload would re-fetch data from a reactor that
 * may no longer be running, so selection resets instead.
 */
import type { PowerhouseDatabaseRowLimit, PowerhouseDatabaseTargetId } from "@vetra-code/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as Predicate from "effect/Predicate";

import { resolveStorage } from "~/lib/storage";

import { normalizeReactorUrl } from "./PowerhousePanel.logic";
import { clearSwitchboardPanelStorage } from "./switchboard/switchboardStorage";

export interface PowerhouseProjectPreferences {
  /** `null` means autodetect. */
  readonly reactorUrlOverride: string | null;
}

/** One step of the explorer's drive → folder → document path. */
export interface PowerhouseExplorerCrumb {
  readonly id: string;
  readonly name: string;
}

export interface PowerhouseExplorerSelection {
  readonly driveId: string | null;
  readonly path: ReadonlyArray<PowerhouseExplorerCrumb>;
  readonly documentId: string | null;
}

export interface PowerhouseModelSelection {
  readonly directoryName: string | null;
  readonly specIndex: number | null;
}

export interface PowerhouseDatabaseSession {
  readonly target: PowerhouseDatabaseTargetId;
  readonly schema: string | null;
  readonly relation: string | null;
  readonly draft: string;
  readonly history: ReadonlyArray<string>;
  readonly rowLimit: PowerhouseDatabaseRowLimit;
  readonly includeSystemSchemas: boolean;
}

export const DEFAULT_PREFERENCES: PowerhouseProjectPreferences = {
  reactorUrlOverride: null,
};

export const EMPTY_EXPLORER_SELECTION: PowerhouseExplorerSelection = {
  driveId: null,
  path: [],
  documentId: null,
};

const EMPTY_MODEL_SELECTION: PowerhouseModelSelection = { directoryName: null, specIndex: null };

export const EMPTY_DATABASE_SESSION: PowerhouseDatabaseSession = {
  target: "read_models",
  schema: null,
  relation: null,
  draft: "",
  history: [],
  rowLimit: 100,
  includeSystemSchemas: false,
};

interface PowerhousePanelStoreState {
  /** Persisted, keyed by `powerhouseProjectKey`. */
  byProjectKey: Record<string, PowerhouseProjectPreferences>;
  /** Legacy/default project choice, keyed by `powerhouseWorkspaceKey`. */
  selectedProjectByWorkspaceKey: Record<string, string>;
  /** Persisted, keyed by `powerhousePanelWorkspaceKey`. */
  selectedProjectByPanelKey: Record<string, string>;
  /** Session-only, keyed by `powerhousePanelProjectKey`. */
  modelSelectionByPanelProjectKey: Record<string, PowerhouseModelSelection>;
  explorerSelectionByPanelProjectKey: Record<string, PowerhouseExplorerSelection>;
  databaseSessionByPanelProjectKey: Record<string, PowerhouseDatabaseSession>;
  selectProject: (panelWorkspaceKey: string, projectPath: string) => void;
  setReactorUrlOverride: (projectKey: string, url: string | null) => void;
  selectModel: (panelProjectKey: string, directoryName: string | null) => void;
  selectSpec: (panelProjectKey: string, specIndex: number | null) => void;
  selectDrive: (panelProjectKey: string, drive: PowerhouseExplorerCrumb | null) => void;
  enterFolder: (panelProjectKey: string, folder: PowerhouseExplorerCrumb) => void;
  /** Truncate the path to `depth` crumbs — how a breadcrumb click navigates back. */
  popToDepth: (panelProjectKey: string, depth: number) => void;
  selectDocument: (panelProjectKey: string, documentId: string | null) => void;
  setDatabaseTarget: (panelProjectKey: string, target: PowerhouseDatabaseTargetId) => void;
  selectDatabaseRelation: (panelProjectKey: string, schema: string, relation: string) => void;
  setDatabaseDraft: (panelProjectKey: string, draft: string) => void;
  recordDatabaseQuery: (panelProjectKey: string, sql: string) => void;
  setDatabaseRowLimit: (panelProjectKey: string, rowLimit: PowerhouseDatabaseRowLimit) => void;
  setDatabaseIncludeSystemSchemas: (panelProjectKey: string, include: boolean) => void;
  removePanel: (surfaceId: string) => void;
}

/** One workspace. A monorepo can hold several Powerhouse projects under it. */
export const powerhouseWorkspaceKey = (environmentId: string, cwd: string) =>
  `${environmentId}:${cwd}`;

/**
 * One Powerhouse project. The reactor address belongs here, not to the
 * workspace: two projects in a monorepo run two different reactors.
 */
export const powerhouseProjectKey = (environmentId: string, cwd: string, projectPath: string) =>
  `${environmentId}:${cwd}:${projectPath}`;

const powerhousePanelScopedKey = (surfaceId: string, scopeKey: string) =>
  JSON.stringify([surfaceId, scopeKey]);

export const powerhousePanelWorkspaceKey = (
  surfaceId: string,
  environmentId: string,
  cwd: string,
) => powerhousePanelScopedKey(surfaceId, powerhouseWorkspaceKey(environmentId, cwd));

export const powerhousePanelProjectKey = (
  surfaceId: string,
  environmentId: string,
  cwd: string,
  projectPath: string,
) => powerhousePanelScopedKey(surfaceId, powerhouseProjectKey(environmentId, cwd, projectPath));

const POWERHOUSE_PANEL_STORAGE_KEY = "vetra:powerhouse-panel:v1";
// v2 keys preferences by project rather than by workspace, so a monorepo's
// projects stop sharing one reactor address.
// v4 removes the inner mode and gives each repeatable panel its own project choice.
const POWERHOUSE_PANEL_STORAGE_VERSION = 4;

/**
 * Drop anything that does not read back as a preference rather than failing the
 * whole store: a bad entry costs the user one project's reactor preference,
 * not the panel.
 */
export function migratePersistedPowerhousePanelState(persisted: unknown): {
  byProjectKey: Record<string, PowerhouseProjectPreferences>;
  selectedProjectByWorkspaceKey: Record<string, string>;
  selectedProjectByPanelKey: Record<string, string>;
} {
  const empty = {
    byProjectKey: {},
    selectedProjectByWorkspaceKey: {},
    selectedProjectByPanelKey: {},
  };
  if (!Predicate.isObject(persisted)) return empty;
  const rawSelected = persisted.selectedProjectByWorkspaceKey;
  const selectedProjectByWorkspaceKey: Record<string, string> = {};
  if (Predicate.isObject(rawSelected)) {
    for (const [key, value] of Object.entries(rawSelected)) {
      if (typeof value === "string") selectedProjectByWorkspaceKey[key] = value;
    }
  }
  const rawPanelSelected = persisted.selectedProjectByPanelKey;
  const selectedProjectByPanelKey: Record<string, string> = {};
  if (Predicate.isObject(rawPanelSelected)) {
    for (const [key, value] of Object.entries(rawPanelSelected)) {
      if (typeof value === "string") selectedProjectByPanelKey[key] = value;
    }
  }
  const raw = persisted.byProjectKey;
  if (!Predicate.isObject(raw)) {
    return { byProjectKey: {}, selectedProjectByWorkspaceKey, selectedProjectByPanelKey };
  }
  const byProjectKey: Record<string, PowerhouseProjectPreferences> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!Predicate.isObject(entry)) continue;
    const override =
      typeof entry.reactorUrlOverride === "string"
        ? normalizeReactorUrl(entry.reactorUrlOverride)
        : null;
    byProjectKey[key] = {
      reactorUrlOverride: override,
    };
  }
  return { byProjectKey, selectedProjectByWorkspaceKey, selectedProjectByPanelKey };
}

const updatePreferences = (
  state: PowerhousePanelStoreState,
  projectKey: string,
  patch: Partial<PowerhouseProjectPreferences>,
) => ({
  byProjectKey: {
    ...state.byProjectKey,
    [projectKey]: { ...(state.byProjectKey[projectKey] ?? DEFAULT_PREFERENCES), ...patch },
  },
});

const updateExplorer = (
  state: PowerhousePanelStoreState,
  panelProjectKey: string,
  next: (previous: PowerhouseExplorerSelection) => PowerhouseExplorerSelection,
) => ({
  explorerSelectionByPanelProjectKey: {
    ...state.explorerSelectionByPanelProjectKey,
    [panelProjectKey]: next(
      state.explorerSelectionByPanelProjectKey[panelProjectKey] ?? EMPTY_EXPLORER_SELECTION,
    ),
  },
});

const updateDatabase = (
  state: PowerhousePanelStoreState,
  panelProjectKey: string,
  next: (previous: PowerhouseDatabaseSession) => PowerhouseDatabaseSession,
) => ({
  databaseSessionByPanelProjectKey: {
    ...state.databaseSessionByPanelProjectKey,
    [panelProjectKey]: next(
      state.databaseSessionByPanelProjectKey[panelProjectKey] ?? EMPTY_DATABASE_SESSION,
    ),
  },
});

function panelScopedKeyBelongsToSurface(key: string, surfaceId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && parsed[0] === surfaceId;
  } catch {
    return false;
  }
}

function removePanelEntries<Value>(
  entries: Record<string, Value>,
  surfaceId: string,
): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(entries).filter(([key]) => !panelScopedKeyBelongsToSurface(key, surfaceId)),
  );
}

export const usePowerhousePanelStore = create<PowerhousePanelStoreState>()(
  persist(
    (set) => ({
      byProjectKey: {},
      selectedProjectByWorkspaceKey: {},
      selectedProjectByPanelKey: {},
      modelSelectionByPanelProjectKey: {},
      explorerSelectionByPanelProjectKey: {},
      databaseSessionByPanelProjectKey: {},
      selectProject: (panelWorkspaceKey, projectPath) =>
        set((state) => ({
          selectedProjectByPanelKey: {
            ...state.selectedProjectByPanelKey,
            [panelWorkspaceKey]: projectPath,
          },
        })),
      setReactorUrlOverride: (projectKey, url) =>
        set((state) => {
          const normalized = url === null ? null : normalizeReactorUrl(url);
          if (url !== null && normalized === null) return state;
          const previous = selectPowerhousePreferences(state.byProjectKey, projectKey);
          if (previous.reactorUrlOverride === normalized) return state;
          return {
            ...updatePreferences(state, projectKey, { reactorUrlOverride: normalized }),
            // A path belongs to one reactor. Carrying it to another address can
            // silently open an unrelated document with the same identifier.
            explorerSelectionByPanelProjectKey: Object.fromEntries(
              Object.entries(state.explorerSelectionByPanelProjectKey).map(([key, selection]) => {
                try {
                  const parsed: unknown = JSON.parse(key);
                  return [
                    key,
                    Array.isArray(parsed) && parsed[1] === projectKey
                      ? EMPTY_EXPLORER_SELECTION
                      : selection,
                  ];
                } catch {
                  return [key, selection];
                }
              }),
            ),
          };
        }),
      selectModel: (panelProjectKey, directoryName) =>
        set((state) => ({
          modelSelectionByPanelProjectKey: {
            ...state.modelSelectionByPanelProjectKey,
            // A different model resets the version picker; the old index means
            // nothing against a different specification list.
            [panelProjectKey]: { directoryName, specIndex: null },
          },
        })),
      selectSpec: (panelProjectKey, specIndex) =>
        set((state) => ({
          modelSelectionByPanelProjectKey: {
            ...state.modelSelectionByPanelProjectKey,
            [panelProjectKey]: {
              ...(state.modelSelectionByPanelProjectKey[panelProjectKey] ?? EMPTY_MODEL_SELECTION),
              specIndex,
            },
          },
        })),
      selectDrive: (panelProjectKey, drive) =>
        set((state) =>
          updateExplorer(state, panelProjectKey, () =>
            drive === null
              ? EMPTY_EXPLORER_SELECTION
              : { driveId: drive.id, path: [drive], documentId: null },
          ),
        ),
      enterFolder: (panelProjectKey, folder) =>
        set((state) =>
          updateExplorer(state, panelProjectKey, (previous) => ({
            ...previous,
            path: [...previous.path, folder],
            documentId: null,
          })),
        ),
      popToDepth: (panelProjectKey, depth) =>
        set((state) =>
          updateExplorer(state, panelProjectKey, (previous) => ({
            ...previous,
            path: previous.path.slice(0, Math.max(0, depth)),
            documentId: null,
          })),
        ),
      selectDocument: (panelProjectKey, documentId) =>
        set((state) =>
          updateExplorer(state, panelProjectKey, (previous) => ({ ...previous, documentId })),
        ),
      setDatabaseTarget: (panelProjectKey, target) =>
        set((state) =>
          updateDatabase(state, panelProjectKey, (previous) => ({
            ...previous,
            target,
            schema: null,
            relation: null,
          })),
        ),
      selectDatabaseRelation: (panelProjectKey, schema, relation) =>
        set((state) =>
          updateDatabase(state, panelProjectKey, (previous) => ({ ...previous, schema, relation })),
        ),
      setDatabaseDraft: (panelProjectKey, draft) =>
        set((state) =>
          updateDatabase(state, panelProjectKey, (previous) => ({ ...previous, draft })),
        ),
      recordDatabaseQuery: (panelProjectKey, sql) =>
        set((state) =>
          updateDatabase(state, panelProjectKey, (previous) => ({
            ...previous,
            history: [sql, ...previous.history.filter((entry) => entry !== sql)].slice(0, 20),
          })),
        ),
      setDatabaseRowLimit: (panelProjectKey, rowLimit) =>
        set((state) =>
          updateDatabase(state, panelProjectKey, (previous) => ({ ...previous, rowLimit })),
        ),
      setDatabaseIncludeSystemSchemas: (panelProjectKey, includeSystemSchemas) =>
        set((state) =>
          updateDatabase(state, panelProjectKey, (previous) => ({
            ...previous,
            includeSystemSchemas,
            schema: null,
            relation: null,
          })),
        ),
      removePanel: (surfaceId) => {
        clearSwitchboardPanelStorage(surfaceId);
        set((state) => ({
          selectedProjectByPanelKey: removePanelEntries(state.selectedProjectByPanelKey, surfaceId),
          modelSelectionByPanelProjectKey: removePanelEntries(
            state.modelSelectionByPanelProjectKey,
            surfaceId,
          ),
          explorerSelectionByPanelProjectKey: removePanelEntries(
            state.explorerSelectionByPanelProjectKey,
            surfaceId,
          ),
          databaseSessionByPanelProjectKey: removePanelEntries(
            state.databaseSessionByPanelProjectKey,
            surfaceId,
          ),
        }));
      },
    }),
    {
      name: POWERHOUSE_PANEL_STORAGE_KEY,
      version: POWERHOUSE_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      // Selection is session state: restoring it would re-fetch from a reactor
      // that may not be running anymore.
      partialize: (state) => ({
        byProjectKey: state.byProjectKey,
        selectedProjectByWorkspaceKey: state.selectedProjectByWorkspaceKey,
        selectedProjectByPanelKey: state.selectedProjectByPanelKey,
      }),
      migrate: migratePersistedPowerhousePanelState,
    },
  ),
);

export function selectPowerhousePreferences(
  byProjectKey: Record<string, PowerhouseProjectPreferences>,
  projectKey: string | null,
): PowerhouseProjectPreferences {
  if (projectKey === null) return DEFAULT_PREFERENCES;
  return byProjectKey[projectKey] ?? DEFAULT_PREFERENCES;
}
