/**
 * Powerhouse panel state, split by how long it should live.
 *
 * Persisted per project: which mode the panel opens in, and an explicit reactor
 * URL when autodetection is not what the user wants — both are choices, and a
 * choice that evaporates on reload is a bug.
 *
 * Session-only: what is currently selected. Restoring a document selection
 * across a reload would re-fetch data from a reactor that may no longer be
 * running, so selection resets instead.
 */
import type { PowerhouseDatabaseRowLimit, PowerhouseDatabaseTargetId } from "@vetra-code/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as Predicate from "effect/Predicate";

import { resolveStorage } from "~/lib/storage";

import { normalizeReactorUrl } from "./PowerhousePanel.logic";

export type PowerhouseMode = "models" | "explorer" | "database";

export interface PowerhouseProjectPreferences {
  readonly mode: PowerhouseMode;
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
  mode: "models",
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
  /** Persisted, keyed by `powerhouseWorkspaceKey`: which project the panel shows. */
  selectedProjectByWorkspaceKey: Record<string, string>;
  /** Session-only, keyed by `powerhouseProjectKey`. */
  modelSelectionByProjectKey: Record<string, PowerhouseModelSelection>;
  explorerSelectionByProjectKey: Record<string, PowerhouseExplorerSelection>;
  databaseSessionByProjectKey: Record<string, PowerhouseDatabaseSession>;
  selectProject: (workspaceKey: string, projectPath: string) => void;
  setMode: (projectKey: string, mode: PowerhouseMode) => void;
  setReactorUrlOverride: (projectKey: string, url: string | null) => void;
  selectModel: (projectKey: string, directoryName: string | null) => void;
  selectSpec: (projectKey: string, specIndex: number | null) => void;
  selectDrive: (projectKey: string, drive: PowerhouseExplorerCrumb | null) => void;
  enterFolder: (projectKey: string, folder: PowerhouseExplorerCrumb) => void;
  /** Truncate the path to `depth` crumbs — how a breadcrumb click navigates back. */
  popToDepth: (projectKey: string, depth: number) => void;
  selectDocument: (projectKey: string, documentId: string | null) => void;
  setDatabaseTarget: (projectKey: string, target: PowerhouseDatabaseTargetId) => void;
  selectDatabaseRelation: (projectKey: string, schema: string, relation: string) => void;
  setDatabaseDraft: (projectKey: string, draft: string) => void;
  recordDatabaseQuery: (projectKey: string, sql: string) => void;
  setDatabaseRowLimit: (projectKey: string, rowLimit: PowerhouseDatabaseRowLimit) => void;
  setDatabaseIncludeSystemSchemas: (projectKey: string, include: boolean) => void;
}

/** One workspace. A monorepo can hold several Powerhouse projects under it. */
export const powerhouseWorkspaceKey = (environmentId: string, cwd: string) =>
  `${environmentId}:${cwd}`;

/**
 * One Powerhouse project. Mode and reactor address belong here, not to the
 * workspace: two projects in a monorepo run two different reactors.
 */
export const powerhouseProjectKey = (environmentId: string, cwd: string, projectPath: string) =>
  `${environmentId}:${cwd}:${projectPath}`;

const POWERHOUSE_PANEL_STORAGE_KEY = "vetra:powerhouse-panel:v1";
// v2 keys preferences by project rather than by workspace, so a monorepo's
// projects stop sharing one reactor address.
const POWERHOUSE_PANEL_STORAGE_VERSION = 3;

const isMode = (value: unknown): value is PowerhouseMode =>
  value === "models" || value === "explorer" || value === "database";

/**
 * Drop anything that does not read back as a preference rather than failing the
 * whole store: a bad entry costs the user one project's mode, not the panel.
 */
export function migratePersistedPowerhousePanelState(persisted: unknown): {
  byProjectKey: Record<string, PowerhouseProjectPreferences>;
  selectedProjectByWorkspaceKey: Record<string, string>;
} {
  const empty = { byProjectKey: {}, selectedProjectByWorkspaceKey: {} };
  if (!Predicate.isObject(persisted)) return empty;
  const rawSelected = persisted.selectedProjectByWorkspaceKey;
  const selectedProjectByWorkspaceKey: Record<string, string> = {};
  if (Predicate.isObject(rawSelected)) {
    for (const [key, value] of Object.entries(rawSelected)) {
      if (typeof value === "string") selectedProjectByWorkspaceKey[key] = value;
    }
  }
  const raw = persisted.byProjectKey;
  if (!Predicate.isObject(raw)) {
    return { byProjectKey: {}, selectedProjectByWorkspaceKey };
  }
  const byProjectKey: Record<string, PowerhouseProjectPreferences> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!Predicate.isObject(entry)) continue;
    const override =
      typeof entry.reactorUrlOverride === "string"
        ? normalizeReactorUrl(entry.reactorUrlOverride)
        : null;
    byProjectKey[key] = {
      mode: isMode(entry.mode) ? entry.mode : DEFAULT_PREFERENCES.mode,
      reactorUrlOverride: override,
    };
  }
  return { byProjectKey, selectedProjectByWorkspaceKey };
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
  projectKey: string,
  next: (previous: PowerhouseExplorerSelection) => PowerhouseExplorerSelection,
) => ({
  explorerSelectionByProjectKey: {
    ...state.explorerSelectionByProjectKey,
    [projectKey]: next(state.explorerSelectionByProjectKey[projectKey] ?? EMPTY_EXPLORER_SELECTION),
  },
});

const updateDatabase = (
  state: PowerhousePanelStoreState,
  projectKey: string,
  next: (previous: PowerhouseDatabaseSession) => PowerhouseDatabaseSession,
) => ({
  databaseSessionByProjectKey: {
    ...state.databaseSessionByProjectKey,
    [projectKey]: next(state.databaseSessionByProjectKey[projectKey] ?? EMPTY_DATABASE_SESSION),
  },
});

export const usePowerhousePanelStore = create<PowerhousePanelStoreState>()(
  persist(
    (set) => ({
      byProjectKey: {},
      selectedProjectByWorkspaceKey: {},
      modelSelectionByProjectKey: {},
      explorerSelectionByProjectKey: {},
      databaseSessionByProjectKey: {},
      selectProject: (workspaceKey, projectPath) =>
        set((state) => ({
          selectedProjectByWorkspaceKey: {
            ...state.selectedProjectByWorkspaceKey,
            [workspaceKey]: projectPath,
          },
        })),
      setMode: (projectKey, mode) => set((state) => updatePreferences(state, projectKey, { mode })),
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
            explorerSelectionByProjectKey: {
              ...state.explorerSelectionByProjectKey,
              [projectKey]: EMPTY_EXPLORER_SELECTION,
            },
          };
        }),
      selectModel: (projectKey, directoryName) =>
        set((state) => ({
          modelSelectionByProjectKey: {
            ...state.modelSelectionByProjectKey,
            // A different model resets the version picker; the old index means
            // nothing against a different specification list.
            [projectKey]: { directoryName, specIndex: null },
          },
        })),
      selectSpec: (projectKey, specIndex) =>
        set((state) => ({
          modelSelectionByProjectKey: {
            ...state.modelSelectionByProjectKey,
            [projectKey]: {
              ...(state.modelSelectionByProjectKey[projectKey] ?? EMPTY_MODEL_SELECTION),
              specIndex,
            },
          },
        })),
      selectDrive: (projectKey, drive) =>
        set((state) =>
          updateExplorer(state, projectKey, () =>
            drive === null
              ? EMPTY_EXPLORER_SELECTION
              : { driveId: drive.id, path: [drive], documentId: null },
          ),
        ),
      enterFolder: (projectKey, folder) =>
        set((state) =>
          updateExplorer(state, projectKey, (previous) => ({
            ...previous,
            path: [...previous.path, folder],
            documentId: null,
          })),
        ),
      popToDepth: (projectKey, depth) =>
        set((state) =>
          updateExplorer(state, projectKey, (previous) => ({
            ...previous,
            path: previous.path.slice(0, Math.max(0, depth)),
            documentId: null,
          })),
        ),
      selectDocument: (projectKey, documentId) =>
        set((state) =>
          updateExplorer(state, projectKey, (previous) => ({ ...previous, documentId })),
        ),
      setDatabaseTarget: (projectKey, target) =>
        set((state) =>
          updateDatabase(state, projectKey, (previous) => ({
            ...previous,
            target,
            schema: null,
            relation: null,
          })),
        ),
      selectDatabaseRelation: (projectKey, schema, relation) =>
        set((state) =>
          updateDatabase(state, projectKey, (previous) => ({ ...previous, schema, relation })),
        ),
      setDatabaseDraft: (projectKey, draft) =>
        set((state) => updateDatabase(state, projectKey, (previous) => ({ ...previous, draft }))),
      recordDatabaseQuery: (projectKey, sql) =>
        set((state) =>
          updateDatabase(state, projectKey, (previous) => ({
            ...previous,
            history: [sql, ...previous.history.filter((entry) => entry !== sql)].slice(0, 20),
          })),
        ),
      setDatabaseRowLimit: (projectKey, rowLimit) =>
        set((state) =>
          updateDatabase(state, projectKey, (previous) => ({ ...previous, rowLimit })),
        ),
      setDatabaseIncludeSystemSchemas: (projectKey, includeSystemSchemas) =>
        set((state) =>
          updateDatabase(state, projectKey, (previous) => ({
            ...previous,
            includeSystemSchemas,
            schema: null,
            relation: null,
          })),
        ),
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
