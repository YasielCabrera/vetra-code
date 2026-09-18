/**
 * Powerhouse right-panel surface.
 *
 * Shared shell for the Powerhouse right-panel tools: document models read from
 * the working tree, a live reactor explorer, a database inspector, and the
 * Switchboard GraphQL client.
 *
 * The Powerhouse project is not always the workspace root. In a monorepo it is
 * usually an app directory, and there can be more than one, so the panel picks
 * one and offers a switcher when the workspace holds several.
 *
 * Powerhouse ships an unrelated package of its own called Vetra; nothing here
 * borrows that name.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { FolderCog, Settings2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import type { PowerhousePanelKind } from "~/rightPanelStore";
import { powerhouseEnvironment } from "~/state/powerhouse";

import { describeConnection } from "./PowerhousePanel.logic";
import {
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
  PowerhousePanelState,
} from "./PowerhousePanelPrimitives";
import { ExplorerView } from "./explorer/ExplorerView";
import { ReactorUrlForm } from "./explorer/ReactorUrlForm";
import { ModelsView } from "./models/ModelsView";
import { DatabaseView } from "./database/DatabaseView";
import {
  DEFAULT_PREFERENCES,
  EMPTY_EXPLORER_SELECTION,
  powerhousePanelProjectKey,
  powerhousePanelWorkspaceKey,
  powerhouseProjectKey,
  powerhouseWorkspaceKey,
  selectPowerhousePreferences,
  usePowerhousePanelStore,
} from "./powerhousePanelStore";
import { useReactorQuery } from "./powerhouseQuery";
import { resolveSelectedProject, usePowerhouseProjects } from "./usePowerhouseProject";

const SwitchboardView = lazy(() => import("./switchboard/SwitchboardView"));

interface PowerhousePanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  surfaceId: string;
  kind: PowerhousePanelKind;
}

/**
 * Connection state for the header. Reads the same probe atom the explorer does,
 * so showing it costs no extra request.
 */
function ConnectionChip({
  environmentId,
  cwd,
  projectPath,
  overrideUrl,
  onSetOverride,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  overrideUrl: string | null;
  onSetOverride: (url: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const probe = useReactorQuery(
    powerhouseEnvironment.reactorProbe({
      environmentId,
      input: {
        cwd,
        ...(projectPath.length === 0 ? {} : { projectPath }),
        ...(overrideUrl === null ? {} : { overrideUrl }),
      },
    }),
  );
  const connected = !probe.isFailure && probe.data !== null;
  const label = connected
    ? describeConnection(probe.data)
    : probe.isPending
      ? "Connecting…"
      : "Offline";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Configure reactor connection. ${label}`}
            className="group flex min-w-0 max-w-48 items-center gap-1.5 rounded-md px-1.5 py-1 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            connected
              ? "bg-success"
              : probe.isPending
                ? "bg-muted-foreground/50"
                : "bg-destructive",
          )}
        />
        <span className="min-w-0 truncate font-mono text-[.65rem] text-muted-foreground tabular-nums group-hover:text-foreground">
          {label}
        </span>
        <Settings2 aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      </PopoverTrigger>
      <PopoverPopup
        align="end"
        side="bottom"
        className="w-[min(22rem,calc(100vw-1rem))] max-w-none"
      >
        <PopoverTitle className="text-sm">Reactor connection</PopoverTitle>
        <p className="mt-1 mb-4 text-xs leading-relaxed text-muted-foreground">
          {connected ? `Connected to ${label}.` : "Choose the reactor address for this project."}
        </p>
        <ReactorUrlForm
          overrideUrl={overrideUrl}
          onSetOverride={onSetOverride}
          onRetry={probe.refresh}
          onApplied={() => setOpen(false)}
          submitLabel="Apply"
        />
      </PopoverPopup>
    </Popover>
  );
}

export default function PowerhousePanel({
  environmentId,
  cwd,
  surfaceId,
  kind,
}: PowerhousePanelProps) {
  const workspaceKey = powerhouseWorkspaceKey(environmentId, cwd);
  const panelWorkspaceKey = powerhousePanelWorkspaceKey(surfaceId, environmentId, cwd);
  const {
    projects,
    status,
    error: projectsError,
    refresh,
  } = usePowerhouseProjects(environmentId, cwd);
  const selectedPath = usePowerhousePanelStore(
    (state) =>
      state.selectedProjectByPanelKey[panelWorkspaceKey] ??
      state.selectedProjectByWorkspaceKey[workspaceKey] ??
      null,
  );
  const project = resolveSelectedProject(projects, selectedPath);
  const projectKey = powerhouseProjectKey(environmentId, cwd, project?.path ?? "");
  const panelProjectKey = powerhousePanelProjectKey(
    surfaceId,
    environmentId,
    cwd,
    project?.path ?? "",
  );

  const preferences = usePowerhousePanelStore((state) =>
    kind === "powerhouse-explorer" || kind === "powerhouse-switchboard"
      ? selectPowerhousePreferences(state.byProjectKey, projectKey)
      : DEFAULT_PREFERENCES,
  );
  const modelSelection = usePowerhousePanelStore((state) =>
    kind === "powerhouse-models"
      ? (state.modelSelectionByPanelProjectKey[panelProjectKey] ?? null)
      : null,
  );
  const explorerSelection = usePowerhousePanelStore((state) =>
    kind === "powerhouse-explorer"
      ? (state.explorerSelectionByPanelProjectKey[panelProjectKey] ?? EMPTY_EXPLORER_SELECTION)
      : EMPTY_EXPLORER_SELECTION,
  );
  const selectProject = usePowerhousePanelStore((state) => state.selectProject);
  const setReactorUrlOverride = usePowerhousePanelStore((state) => state.setReactorUrlOverride);
  const selectModel = usePowerhousePanelStore((state) => state.selectModel);
  const selectSpec = usePowerhousePanelStore((state) => state.selectSpec);
  const selectDrive = usePowerhousePanelStore((state) => state.selectDrive);
  const enterFolder = usePowerhousePanelStore((state) => state.enterFolder);
  const popToDepth = usePowerhousePanelStore((state) => state.popToDepth);
  const selectDocument = usePowerhousePanelStore((state) => state.selectDocument);

  if (project === null) {
    if (status === "loading")
      return <PowerhousePanelLoading label="Finding Powerhouse projects…" />;
    return status === "error" ? (
      <PowerhousePanelState
        title="Powerhouse could not be inspected"
        description={projectsError ?? "Project discovery failed before returning any results."}
        tone="error"
        action={{ label: "Try again", onClick: refresh }}
      />
    ) : (
      <PowerhousePanelState
        title="No Powerhouse project found"
        description="Add a powerhouse.config.json to this workspace or one of its immediate app directories."
        action={{ label: "Scan again", onClick: refresh }}
      />
    );
  }

  // The project directory is what every call addresses, so a nested project's
  // data is fetched exactly like a root one's.
  const projectPath = project.path;

  return (
    <div className="@container/powerhouse flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/95">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-3 py-2 @[32rem]:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground">
              <FolderCog aria-hidden className="size-3.5" />
            </span>
            {projects.length > 1 ? (
              <label className="min-w-0">
                <span className="sr-only">Powerhouse project</span>
                <select
                  value={projectPath}
                  onChange={(event) => selectProject(panelWorkspaceKey, event.target.value)}
                  className="h-7 max-w-60 min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 dark:bg-input/32"
                >
                  {projects.map((entry) => (
                    <option key={entry.path} value={entry.path}>
                      {entry.path.length === 0 ? entry.name : entry.path}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="min-w-0 truncate font-mono text-[.7rem] text-muted-foreground">
                {projectPath.length === 0 ? project.name : projectPath}
              </span>
            )}
          </div>

          {kind === "powerhouse-explorer" || kind === "powerhouse-switchboard" ? (
            <ConnectionChip
              environmentId={environmentId}
              cwd={cwd}
              projectPath={projectPath}
              overrideUrl={preferences.reactorUrlOverride}
              onSetOverride={(url) => setReactorUrlOverride(projectKey, url)}
            />
          ) : null}
        </div>
      </header>

      {projectsError === null && project.configValid ? null : (
        <div className="mx-auto w-full max-w-5xl shrink-0 px-3 pt-3 @[32rem]:px-5">
          <PowerhouseInlineNotice>
            {projectsError !== null ? (
              <>The last project scan failed. Showing the most recent result. {projectsError}</>
            ) : (
              <>
                <span className="font-medium">powerhouse.config.json</span> could not be parsed.
                Default paths and ports are in use.
              </>
            )}
          </PowerhouseInlineNotice>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {kind === "powerhouse-models" ? (
          <ModelsView
            environmentId={environmentId}
            cwd={cwd}
            projectPath={projectPath}
            selectedModel={modelSelection?.directoryName ?? null}
            selectedSpecIndex={modelSelection?.specIndex ?? null}
            onSelectModel={(directoryName) => selectModel(panelProjectKey, directoryName)}
            onSelectSpec={(index) => selectSpec(panelProjectKey, index)}
          />
        ) : kind === "powerhouse-explorer" ? (
          <ExplorerView
            key={panelProjectKey}
            environmentId={environmentId}
            cwd={cwd}
            projectPath={projectPath}
            overrideUrl={preferences.reactorUrlOverride}
            selection={explorerSelection}
            onSetOverride={(url) => setReactorUrlOverride(projectKey, url)}
            onSelectDrive={(drive) => selectDrive(panelProjectKey, drive)}
            onEnterFolder={(folder) => enterFolder(panelProjectKey, folder)}
            onPopToDepth={(depth) => popToDepth(panelProjectKey, depth)}
            onSelectDocument={(documentId) => selectDocument(panelProjectKey, documentId)}
          />
        ) : kind === "powerhouse-database" ? (
          <DatabaseView
            key={panelProjectKey}
            environmentId={environmentId}
            cwd={cwd}
            projectPath={projectPath}
            panelProjectKey={panelProjectKey}
          />
        ) : (
          <Suspense fallback={<PowerhousePanelLoading label="Loading Switchboard…" />}>
            <SwitchboardView
              key={panelProjectKey}
              environmentId={environmentId}
              cwd={cwd}
              projectPath={projectPath}
              surfaceId={surfaceId}
              panelProjectKey={panelProjectKey}
              overrideUrl={preferences.reactorUrlOverride}
              onSetOverride={(url) => setReactorUrlOverride(projectKey, url)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
