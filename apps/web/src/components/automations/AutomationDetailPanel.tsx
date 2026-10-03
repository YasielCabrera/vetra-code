import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProjectId,
  ProviderDriverKind,
  RuntimeMode,
  ScheduledTaskSchedule,
  ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  BotIcon,
  CalendarClockIcon,
  CheckCheckIcon,
  FolderPlusIcon,
  PlayIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { onCommandPaletteProjectSelected, openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useAutomationActions } from "../../hooks/useAutomationActions";
import { useMarkAutomationRunsRead } from "../../hooks/useAutomationRunsRead";
import { useProjectGroups } from "../../hooks/useProjectGroups";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { useViewportWidth } from "../../hooks/useViewportWidth";
import { cn } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
} from "../../providerInstances";
import {
  automationEnvironment,
  isHiddenAutomationRun,
  useAutomation,
  useAutomationRunsByThreadKey,
} from "../../state/automations";
import { useUiStateStore } from "../../uiStateStore";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { vcsEnvironment } from "../../state/vcs";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { WorktreeBaseBranchPicker } from "../WorktreeBaseBranchPicker";
import { useProjects, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { newAutomationId } from "./automationIds";
import {
  automationRunVisitKey,
  isAutomationRunUnread,
  unreadRunCountLabel,
} from "./automationsList.logic";
import {
  DEFAULT_SCHEDULE_PRESET,
  describeAutomationSchedule,
  formatMinutesOfDay,
  parseMinutesOfDay,
  presetFromSchedule,
  scheduleFromPreset,
  WEEKDAY_LABELS,
  type SchedulePreset,
  type SchedulePresetKind,
} from "./automationSchedule.logic";
import { findAutomationTemplate } from "./automationTemplates";

const AUTOMATION_PANEL_WIDTH_STORAGE_KEY = "vetra:automation-panel-width";
const AUTOMATION_PANEL_MIN_WIDTH = 420;
/** Wide enough for the schedule and agent cards to sit side by side. */
const AUTOMATION_PANEL_DEFAULT_WIDTH = 880;
/**
 * Held back from the panel for the workspace sidebar and a list rail that can
 * still be read. The panel is free to take everything else.
 */
const AUTOMATION_PANEL_VIEWPORT_RESERVE = 620;

const RUNTIME_MODE_OPTIONS: ReadonlyArray<{ value: RuntimeMode; label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "approval-required", label: "Ask for approval" },
];

/** Distinct from any project key, which is always `environmentId:projectId`. */
const NEW_PROJECT_VALUE = "__new__";
const ADD_PROJECT_VALUE = "__add__";

type WorkspaceMode = OrchestrationV2ThreadLaunchWorkspaceStrategy["type"];

const WORKSPACE_MODE_OPTIONS: ReadonlyArray<{ value: WorkspaceMode; label: string }> = [
  { value: "root", label: "The project's checkout" },
  { value: "worktree", label: "A fresh worktree each run" },
];
/** Only an agent or the scheduled-tasks API pins a task to one checkout. */
const EXISTING_WORKTREE_OPTION = {
  value: "existing_worktree",
  label: "Its saved checkout",
} as const;

/** A new project's first commit is on whatever branch git defaults to. */
const NEW_PROJECT_BASE_REF = "HEAD";

const WEEKDAY_SELECT_ITEMS: ReadonlyArray<{ value: string; label: string }> = WEEKDAY_LABELS.map(
  (label, index) => ({ value: String(index), label }),
);

const PRESET_OPTIONS: ReadonlyArray<{ value: SchedulePresetKind; label: string }> = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "hourly", label: "Every few hours" },
];
const KEPT_PRESET_OPTION = { value: "kept", label: "As saved" } as const;

interface AutomationDraft {
  readonly title: string;
  readonly prompt: string;
  /** Provider instance, model, and the model's own options (reasoning effort,
      thinking level) — the same selection a composer builds. */
  readonly modelSelection: ModelSelection | null;
  readonly preset: SchedulePreset;
  /** A saved schedule the picker cannot express, kept as it is while `kept` is selected. */
  readonly keptSchedule: ScheduledTaskSchedule | null;
  readonly projectKey: string | null;
  readonly workspaceMode: WorkspaceMode;
  /** Empty until chosen: the project's current branch at save. */
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly runtimeMode: RuntimeMode;
  readonly enabled: boolean;
}

function draftSchedule(draft: AutomationDraft): ScheduledTaskSchedule {
  return draft.preset.kind === "kept" && draft.keptSchedule !== null
    ? draft.keptSchedule
    : scheduleFromPreset(draft.preset);
}

function draftFromAutomation(automation: EnvironmentAutomation): AutomationDraft {
  const preset = presetFromSchedule(automation.schedule);
  const strategy = automation.workspaceStrategy;
  return {
    title: automation.title,
    prompt: automation.prompt,
    preset: preset ?? { ...DEFAULT_SCHEDULE_PRESET, kind: "kept" },
    keptSchedule: preset === null ? automation.schedule : null,
    modelSelection: automation.modelSelection,
    projectKey: `${automation.environmentId}:${automation.projectId}`,
    workspaceMode: strategy.type,
    baseRef: strategy.type === "worktree" ? strategy.baseRef : "",
    startFromOrigin: strategy.type === "worktree" && strategy.startFromOrigin === true,
    runtimeMode: automation.runtimeMode,
    enabled: automation.enabled,
  };
}

/**
 * The draft's workspace as the task stores it. A strategy the form did not
 * change keeps everything it carried, such as a pinned branch.
 */
function draftWorkspaceStrategy(
  draft: AutomationDraft,
  saved: OrchestrationV2ThreadLaunchWorkspaceStrategy | null,
  baseRef: string,
): OrchestrationV2ThreadLaunchWorkspaceStrategy {
  switch (draft.workspaceMode) {
    case "worktree":
      return {
        ...(saved?.type === "worktree" ? saved : {}),
        type: "worktree",
        baseRef,
        startFromOrigin: draft.startFromOrigin,
      };
    case "existing_worktree":
      if (saved?.type === "existing_worktree") return saved;
      return { type: "root" };
    case "root":
      return saved?.type === "root" ? saved : { type: "root" };
  }
}

export function AutomationDetailPanel(props: {
  readonly automationKey?: string;
  readonly templateId?: string;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  const projectGroups = useProjectGroups();
  const threads = useThreadShells();
  const runsByThreadKey = useAutomationRunsByThreadKey();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);

  const automationRef = useMemo(() => {
    if (props.automationKey === undefined) return null;
    const separatorIndex = props.automationKey.indexOf(":");
    if (separatorIndex <= 0) return null;
    return {
      environmentId: props.automationKey.slice(0, separatorIndex) as EnvironmentId,
      automationId: props.automationKey.slice(separatorIndex + 1) as EnvironmentAutomation["id"],
    };
  }, [props.automationKey]);
  const automation = useAutomation(automationRef);
  const isNew = automationRef === null;

  const template = useMemo(() => findAutomationTemplate(props.templateId), [props.templateId]);
  const [draft, setDraft] = useState<AutomationDraft>(() => ({
    title: template?.title ?? "",
    prompt: template?.prompt ?? "",
    preset: template?.preset ?? DEFAULT_SCHEDULE_PRESET,
    keptSchedule: null,
    // Null until the provider list arrives, then the server's default.
    modelSelection: null,
    projectKey: null,
    workspaceMode: "root",
    baseRef: "",
    // Unattended work parks forever on the first approval request.
    runtimeMode: "full-access",
    startFromOrigin: false,
    enabled: true,
  }));
  // An existing automation's saved state is the draft's starting point,
  // captured once so typing is never overwritten by a live update.
  const [hydratedFrom, setHydratedFrom] = useState<string | null>(null);
  if (automation !== null && hydratedFrom !== automation.id) {
    setHydratedFrom(automation.id);
    setDraft(draftFromAutomation(automation));
  }

  const upsertAutomation = useAtomCommand(serverEnvironment.upsertScheduledTask);
  const createProject = useAtomCommand(projectEnvironment.createNew);
  const setRunHidden = useAtomCommand(automationEnvironment.setRunHidden);
  // The same actions the list's row menu offers, so Run now, Pause, and Delete
  // behave identically wherever they are invoked from.
  const { confirmAndDelete, runNow, setEnabled } = useAutomationActions();
  const markRunsRead = useMarkAutomationRunsRead();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);

  const runThreads = useMemo(() => {
    if (automation === null) return [];
    return threads
      .filter(
        (thread) =>
          thread.environmentId === automation.environmentId &&
          runsByThreadKey.get(automationRunVisitKey(thread))?.scheduledTaskId === automation.id,
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [automation, runsByThreadKey, threads]);
  // Which runs still owe the reader a look. Opening one clears its own mark
  // (ChatView stamps the visit), so this list shrinks as they are read.
  const unreadRunThreads = useMemo(
    () =>
      runThreads.filter((thread) =>
        isAutomationRunUnread({
          thread,
          localLastVisitedAt: threadLastVisitedAtById[automationRunVisitKey(thread)],
        }),
      ),
    [runThreads, threadLastVisitedAtById],
  );
  const unreadRunKeys = useMemo(
    () => new Set(unreadRunThreads.map((thread) => automationRunVisitKey(thread))),
    [unreadRunThreads],
  );

  const targetEnvironmentId = automation?.environmentId ?? primaryEnvironmentId;
  const scheduleLabel = describeAutomationSchedule(draftSchedule(draft), {
    use24Hour: timestampFormat === "24-hour",
  });

  // The importer leads, because the project you want may not be in Vetra yet
  // and hunting for that at the bottom of a list is the wrong shape. It is an
  // action, not a choice, so it sits above the divider — the selected value
  // still defaults to the automation's own workspace.
  const projectSelectItems = useMemo(
    () => [
      { value: ADD_PROJECT_VALUE, label: "Add a location…" },
      { value: NEW_PROJECT_VALUE, label: "A new project" },
      ...projectGroups.map((group) => ({
        value: `${group.environmentId}:${group.id}`,
        label: group.displayName,
      })),
    ],
    [projectGroups],
  );

  // Borrows the command palette's whole import-source flow — local folder, git
  // URL, GitHub, and the rest — rather than growing a second way to add a
  // project. It hands the project back here instead of opening a thread in it.
  const addProjectLocation = useCallback(() => {
    openCommandPalette({ open: "add-project", completion: "select" });
  }, []);
  useEffect(
    () =>
      onCommandPaletteProjectSelected((selected) => {
        setDraft((current) => ({
          ...current,
          projectKey: `${selected.environmentId}:${selected.projectId}`,
        }));
      }),
    [],
  );

  // The same provider surface the composer and project settings read, so an
  // automation can be pointed at any instance and model the workspace has.
  const instanceEntries = useMemo(
    () => applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
    [serverProviders, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, serverProviders),
    [serverProviders, settings],
  );
  const selectedProject = useMemo(
    () =>
      draft.projectKey === null
        ? null
        : (projects.find(
            (project) => `${project.environmentId}:${project.id}` === draft.projectKey,
          ) ?? null),
    [draft.projectKey, projects],
  );
  // A worktree task needs a base branch; until one is picked it is the
  // project's current branch, the one a new thread would start from.
  const currentRefQuery = useEnvironmentQuery(
    selectedProject !== null && draft.workspaceMode === "worktree" && draft.baseRef === ""
      ? vcsEnvironment.listRefs({
          environmentId: selectedProject.environmentId,
          input: { cwd: selectedProject.workspaceRoot, limit: 100 },
        })
      : null,
  );
  const currentRefs = currentRefQuery.data?.refs ?? [];
  const defaultBaseRef =
    currentRefs.find((ref) => ref.current && ref.isRemote !== true)?.name ??
    currentRefs.find((ref) => ref.isDefault && ref.isRemote !== true)?.name ??
    null;
  const effectiveBaseRef = draft.baseRef !== "" ? draft.baseRef : defaultBaseRef;

  // A draft with no selection yet falls back to the chosen project's default,
  // then the server's — so the picker always has something real to show.
  const resolvedModelSelection = useMemo(
    () =>
      resolveDefaultProviderModelSelection(
        serverProviders,
        draft.modelSelection ?? selectedProject?.defaultModelSelection ?? null,
      ),
    [draft.modelSelection, selectedProject, serverProviders],
  );
  const activeInstanceEntry = instanceEntries.find(
    (entry) => entry.instanceId === resolvedModelSelection?.instanceId,
  );
  const setModelSelection = useCallback((selection: ModelSelection) => {
    setDraft((current) => ({ ...current, modelSelection: selection }));
  }, []);

  /**
   * An atom command resolves with its failure rather than throwing, so the
   * result has to be read before anything downstream treats it as saved.
   * Interruption means a newer command took over, which needs no toast.
   */
  const settled = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>): boolean => {
      if (result._tag !== "Failure") return true;
      if (isAtomCommandInterrupted(result)) return false;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return false;
    },
    [],
  );

  const handleSave = useCallback(async () => {
    const title = draft.title.trim();
    const prompt = draft.prompt.trim();
    if (title.length === 0 || prompt.length === 0) {
      toastManager.add({
        type: "error",
        title: "An automation needs a name and a prompt",
      });
      return;
    }
    if (targetEnvironmentId === null) {
      toastManager.add({ type: "error", title: "No environment is connected" });
      return;
    }
    if (resolvedModelSelection === null) {
      toastManager.add({ type: "error", title: "No provider is available to run this" });
      return;
    }
    if (
      draft.workspaceMode === "worktree" &&
      selectedProject !== null &&
      effectiveBaseRef === null
    ) {
      toastManager.add({ type: "error", title: "Pick a base branch for the worktree" });
      return;
    }
    const schedule = draftSchedule(draft);
    if (automation !== null) {
      const baseRef = effectiveBaseRef ?? NEW_PROJECT_BASE_REF;
      const input: ScheduledTaskUpsertInput = {
        id: automation.id,
        requireExisting: true,
        title,
        prompt,
        enabled: draft.enabled,
        schedule,
        projectId: automation.projectId,
        // Upsert clears a thread it is not sent, so a task that posts into a
        // thread keeps posting there.
        threadId: automation.threadId,
        workspaceStrategy: draftWorkspaceStrategy(draft, automation.workspaceStrategy, baseRef),
        modelSelection: resolvedModelSelection,
        runtimeMode: draft.runtimeMode,
        interactionMode: automation.interactionMode,
        creationSource: automation.creationSource,
      };
      const result = await upsertAutomation({ environmentId: automation.environmentId, input });
      if (!settled("Could not save the automation", result)) return;
      toastManager.add({ type: "success", title: "Automation saved" });
      return;
    }

    // No project chosen means a new one, named after the automation, made
    // where the server keeps new projects.
    const environmentId = selectedProject?.environmentId ?? targetEnvironmentId;
    let projectId: ProjectId;
    if (selectedProject !== null) {
      projectId = selectedProject.id;
    } else {
      const created = await createProject({ environmentId, input: { name: title } });
      if (!settled("Could not create the project", created)) return;
      if (created._tag !== "Success") return;
      projectId = created.value.projectId;
    }
    const automationId = newAutomationId();
    const result = await upsertAutomation({
      environmentId,
      input: {
        id: automationId,
        title,
        prompt,
        enabled: draft.enabled,
        schedule,
        projectId,
        threadId: null,
        workspaceStrategy: draftWorkspaceStrategy(
          draft,
          null,
          effectiveBaseRef ?? NEW_PROJECT_BASE_REF,
        ),
        modelSelection: resolvedModelSelection,
        runtimeMode: draft.runtimeMode,
        interactionMode: "default",
        creationSource: "web",
      },
    });
    // Only navigate to the automation once it exists — the route would
    // otherwise land on "This automation no longer exists".
    if (!settled("Could not save the automation", result)) return;
    toastManager.add({ type: "success", title: "Automation created" });
    void navigate({
      to: "/automations/$automationKey",
      params: { automationKey: `${environmentId}:${automationId}` },
      replace: true,
    });
  }, [
    automation,
    createProject,
    draft,
    effectiveBaseRef,
    navigate,
    resolvedModelSelection,
    selectedProject,
    settled,
    targetEnvironmentId,
    upsertAutomation,
  ]);

  const handleToggleEnabled = useCallback(
    async (nextEnabled: boolean) => {
      // Optimistic so the switch answers the click; reverted if the server
      // disagrees. A draft that was never saved has only the local flag.
      setDraft((current) => ({ ...current, enabled: nextEnabled }));
      if (automation === null) return;
      if (!(await setEnabled(automation, nextEnabled))) {
        setDraft((current) => ({ ...current, enabled: !nextEnabled }));
      }
    },
    [automation, setEnabled],
  );

  const handleRunNow = useCallback(async () => {
    if (automation === null) return;
    await runNow(automation);
  }, [automation, runNow]);

  const handleDelete = useCallback(async () => {
    if (automation === null) return;
    if (await confirmAndDelete(automation, runThreads)) {
      void navigate({ to: "/automations", replace: true });
    }
  }, [automation, confirmAndDelete, navigate, runThreads]);

  const handleRevealRun = useCallback(
    async (environmentId: EnvironmentId, threadId: ThreadId) => {
      const result = await setRunHidden({ environmentId, input: { threadId, hidden: false } });
      if (!settled("Could not move the run", result)) return;
      toastManager.add({ type: "success", title: "Moved to the sidebar" });
    },
    [setRunHidden, settled],
  );

  const projectTitle =
    projects.find(
      (project) =>
        project.environmentId === automation?.environmentId && project.id === automation?.projectId,
    )?.workspaceRoot ?? null;

  const presetOptions =
    draft.keptSchedule === null ? PRESET_OPTIONS : [...PRESET_OPTIONS, KEPT_PRESET_OPTION];
  const workspaceModeOptions =
    automation?.workspaceStrategy.type === "existing_worktree"
      ? [...WORKSPACE_MODE_OPTIONS, EXISTING_WORKTREE_OPTION]
      : WORKSPACE_MODE_OPTIONS;
  const postsIntoThread =
    automation?.threadId == null
      ? null
      : (threads.find(
          (thread) =>
            thread.environmentId === automation.environmentId && thread.id === automation.threadId,
        )?.title ?? "a thread");

  if (!isNew && automation === null) {
    return (
      <AutomationPanelFrame title="Automation" onClose={props.onClose}>
        <p className="px-5 py-4 text-sm text-muted-foreground">This automation no longer exists.</p>
      </AutomationPanelFrame>
    );
  }

  return (
    <AutomationPanelFrame
      title={isNew ? "New automation" : (automation?.title ?? "Automation")}
      onClose={props.onClose}
    >
      <div className="@container/panel flex w-full flex-col gap-6 px-5 pt-4 pb-12">
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <Input
              nativeInput
              value={draft.title}
              placeholder="Morning briefing"
              onChange={(event) => {
                const title = event.target.value;
                setDraft((current) => ({ ...current, title }));
              }}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Prompt</span>
            <Textarea
              value={draft.prompt}
              rows={6}
              placeholder="What should the agent do each time this runs?"
              // Capped on the control itself so a long prompt scrolls inside
              // the box instead of pushing everything below it off the panel.
              // Styling the wrapper would scroll the box around a taller
              // textarea and lose the caret.
              style={{ maxHeight: "16rem" }}
              onChange={(event) => {
                const prompt = event.target.value;
                setDraft((current) => ({ ...current, prompt }));
              }}
            />
          </label>
        </section>

        {/* Side by side once the panel is wide enough for both to read well;
            stacked otherwise. Keyed to the panel's own width, since it depends
            on whether the list is beside it. */}
        <div className="grid grid-cols-1 gap-4 @min-[48rem]/panel:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-xl border border-border/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarClockIcon aria-hidden className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Schedule</span>
              </div>
              <span className="truncate text-xs text-muted-foreground">{scheduleLabel}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                items={presetOptions}
                value={draft.preset.kind}
                onValueChange={(value) =>
                  value &&
                  setDraft((current) => ({
                    ...current,
                    preset: { ...current.preset, kind: value as SchedulePresetKind },
                  }))
                }
              >
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder="How often" />
                </SelectTrigger>
                <SelectContent>
                  {presetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {draft.preset.kind === "weekly" ? (
                <Select
                  items={WEEKDAY_SELECT_ITEMS}
                  value={String(draft.preset.weekday)}
                  onValueChange={(value) =>
                    value &&
                    setDraft((current) => ({
                      ...current,
                      preset: { ...current.preset, weekday: Number(value) },
                    }))
                  }
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue placeholder="Day" />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_SELECT_ITEMS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {draft.preset.kind === "hourly" ? (
                <Input
                  nativeInput
                  type="number"
                  min={1}
                  max={23}
                  aria-label="Hours between runs"
                  className="w-24"
                  value={String(draft.preset.everyHours)}
                  onChange={(event) => {
                    const everyHours = Number(event.target.value) || 1;
                    setDraft((current) => ({
                      ...current,
                      preset: { ...current.preset, everyHours },
                    }));
                  }}
                />
              ) : null}

              {draft.preset.kind === "kept" || draft.preset.kind === "hourly" ? null : (
                <Input
                  nativeInput
                  type="time"
                  aria-label="Time of day"
                  className="w-32"
                  value={formatMinutesOfDay(draft.preset.minutesOfDay)}
                  onChange={(event) => {
                    const minutesOfDay = parseMinutesOfDay(event.target.value);
                    if (minutesOfDay === null) return;
                    setDraft((current) => ({
                      ...current,
                      preset: { ...current.preset, minutesOfDay },
                    }));
                  }}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground/70">
              Runs in the server's local time. A run needs this machine awake unless the environment
              is remote.
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-border/70 p-4">
            <div className="flex items-center gap-2">
              <BotIcon aria-hidden className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Agent</span>
            </div>
            {resolvedModelSelection && activeInstanceEntry ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <ProviderModelPicker
                  activeInstanceId={resolvedModelSelection.instanceId}
                  model={resolvedModelSelection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                  onInstanceModelChange={(instanceId, model) => {
                    setModelSelection(createModelSelection(instanceId, model));
                  }}
                />
                {/* Reasoning effort and thinking level live here, per model. */}
                <TraitsPicker
                  provider={activeInstanceEntry.driverKind as ProviderDriverKind}
                  models={activeInstanceEntry.models}
                  model={resolvedModelSelection.model}
                  prompt=""
                  onPromptChange={() => {}}
                  modelOptions={resolvedModelSelection.options ?? []}
                  allowPromptInjectedEffort={false}
                  planModeEnabled={settings.planModeEnabled}
                  triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                  onModelOptionsChange={(nextOptions) => {
                    setModelSelection(
                      createModelSelection(
                        resolvedModelSelection.instanceId,
                        resolvedModelSelection.model,
                        nextOptions,
                      ),
                    );
                  }}
                />
                <Select
                  items={RUNTIME_MODE_OPTIONS}
                  value={draft.runtimeMode}
                  onValueChange={(value) =>
                    value &&
                    setDraft((current) => ({ ...current, runtimeMode: value as RuntimeMode }))
                  }
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue placeholder="Permissions" />
                  </SelectTrigger>
                  <SelectContent>
                    {RUNTIME_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No providers available.</p>
            )}
            {draft.runtimeMode === "approval-required" ? (
              <p className="text-xs text-warning-foreground">
                A run that stops for approval waits for you, so it may sit unfinished until you open
                it.
              </p>
            ) : null}
          </section>

          {/* Spans the pair: it holds a workspace path, which wants the width. */}
          <section className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 @min-[48rem]/panel:col-span-2">
            <span className="text-sm font-medium text-foreground">Where it runs</span>
            {isNew ? (
              <Select
                items={projectSelectItems}
                value={draft.projectKey ?? NEW_PROJECT_VALUE}
                onValueChange={(value) => {
                  if (value === ADD_PROJECT_VALUE) {
                    addProjectLocation();
                    return;
                  }
                  setDraft((current) => ({
                    ...current,
                    projectKey: value === NEW_PROJECT_VALUE || !value ? null : value,
                    baseRef: "",
                  }));
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ADD_PROJECT_VALUE}>
                    <span className="flex items-center gap-2">
                      <FolderPlusIcon aria-hidden className="size-3.5" />
                      Add a location…
                    </span>
                  </SelectItem>
                  <SelectSeparator />
                  <SelectItem value={NEW_PROJECT_VALUE}>A new project</SelectItem>
                  {projectGroups.map((group) => (
                    <SelectItem key={group.projectKey} value={`${group.environmentId}:${group.id}`}>
                      {group.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="break-all text-xs text-muted-foreground">
                {projectTitle ?? "Unknown project"}
              </p>
            )}
            {postsIntoThread !== null ? (
              <p className="text-xs text-muted-foreground">
                Posts each run into “{postsIntoThread}” instead of starting a new thread.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Select
                items={workspaceModeOptions}
                value={draft.workspaceMode}
                onValueChange={(value) =>
                  value &&
                  setDraft((current) => ({ ...current, workspaceMode: value as WorkspaceMode }))
                }
              >
                <SelectTrigger size="sm" className="w-52">
                  <SelectValue placeholder="Checkout" />
                </SelectTrigger>
                <SelectContent>
                  {workspaceModeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.workspaceMode === "worktree" && selectedProject !== null ? (
              <div className="w-72 max-w-full">
                <WorktreeBaseBranchPicker
                  environmentId={selectedProject.environmentId}
                  cwd={selectedProject.workspaceRoot}
                  value={effectiveBaseRef ?? ""}
                  onValueChange={(baseRef) => setDraft((current) => ({ ...current, baseRef }))}
                  startFromOrigin={draft.startFromOrigin}
                  onStartFromOriginChange={(startFromOrigin) =>
                    setDraft((current) => ({ ...current, startFromOrigin }))
                  }
                />
              </div>
            ) : null}
          </section>
        </div>

        <section className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => void handleToggleEnabled(checked === true)}
            />
            {draft.enabled ? "Active" : "Paused"}
          </label>
          <div className="flex items-center gap-2">
            {!isNew ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void handleRunNow()}>
                  <PlayIcon />
                  Run now
                </Button>
                <Button size="sm" variant="destructive-outline" onClick={() => void handleDelete()}>
                  <Trash2Icon />
                  Delete
                </Button>
              </>
            ) : null}
            <Button size="sm" onClick={() => void handleSave()}>
              {isNew ? "Create automation" : "Save"}
            </Button>
          </div>
        </section>

        {!isNew ? (
          <section className="flex flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-sm font-medium text-foreground">Runs</span>
              {unreadRunThreads.length > 0 ? (
                <>
                  <span className="text-xs font-medium text-success-foreground tabular-nums">
                    {unreadRunCountLabel(unreadRunThreads.length)}
                  </span>
                  {/* The way out at scale: a schedule that ran all week should
                      not need a click per run to go quiet. */}
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    className="ms-auto shrink-0"
                    onClick={() => markRunsRead(unreadRunThreads)}
                  >
                    <CheckCheckIcon />
                    Mark all read
                  </Button>
                </>
              ) : null}
            </div>
            {runThreads.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing has run yet. Each run will appear here as its own thread.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {runThreads.map((thread) => {
                  const isUnread = unreadRunKeys.has(automationRunVisitKey(thread));
                  return (
                    <li
                      key={thread.id}
                      className="group/run-row flex items-center gap-2 rounded-lg pr-1 transition-colors hover:bg-accent/60"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams(
                              scopeThreadRef(thread.environmentId, thread.id),
                            ),
                          })
                        }
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {/* The gutter is held whether or not the dot is in
                              it, so titles line up down the list. */}
                          <span
                            aria-hidden
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              isUnread ? "bg-success" : "bg-transparent",
                            )}
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-sm",
                              isUnread ? "font-medium text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {thread.title}
                            {isUnread ? <span className="sr-only"> (unread)</span> : null}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatRelativeTimeLabel(thread.createdAt)}
                        </span>
                      </button>
                      {isHiddenAutomationRun(runsByThreadKey, thread) ? (
                        <span className="flex shrink-0 opacity-0 transition-opacity group-hover/run-row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleRevealRun(thread.environmentId, thread.id)}
                          >
                            Show in sidebar
                          </Button>
                        </span>
                      ) : (
                        <span className="shrink-0 px-3 text-xs text-muted-foreground/70">
                          In sidebar
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </AutomationPanelFrame>
  );
}

/**
 * The panel's chrome: a title row over a scrolling body. Slides in from the
 * right once, on mount — a one-shot keyframe rather than a transition, so
 * nothing keeps repainting after it lands.
 *
 * Sized by a drag handle on its own edge, the way a thread's right panel is:
 * the list beside it takes whatever is left. Below lg the list is hidden and
 * the panel is the whole page, so there is no split to move and the width
 * gives way to the viewport.
 */
function AutomationPanelFrame(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const viewportWidth = useViewportWidth();
  const { width, handlers } = useResizableWidth({
    storageKey: AUTOMATION_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: AUTOMATION_PANEL_DEFAULT_WIDTH,
    minWidth: AUTOMATION_PANEL_MIN_WIDTH,
    maxWidth: Math.max(
      AUTOMATION_PANEL_MIN_WIDTH,
      viewportWidth - AUTOMATION_PANEL_VIEWPORT_RESERVE,
    ),
    edge: "left",
  });

  return (
    <div
      className="relative flex min-h-0 w-full min-w-0 animate-panel-in flex-col border-s border-border/70 bg-background motion-reduce:animate-none lg:w-(--automation-panel-width) lg:shrink-0"
      style={{ "--automation-panel-width": `${width}px` } as CSSProperties}
    >
      <RightPanelResizeHandle handlers={handlers} className="max-lg:hidden" />
      {/* The page's own top strip, on this side of the rule: title and close
          sit level with the breadcrumb beside them rather than below an empty
          band. Sized and typed like the rest of the workspace chrome, and on
          desktop it is the drag region for its half of the titlebar. */}
      <header
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] w-full shrink-0 items-center gap-2 px-5",
          isElectron && "drag-region wco:pr-(--workspace-native-controls-inset)",
          // Below lg the list column is gone and the panel starts at the
          // window's left edge, where the titlebar controls are.
          "max-lg:[[data-sidebar-state=collapsed]_&]:ps-(--workspace-titlebar-content-left)",
        )}
      >
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {props.title}
        </h1>
        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={props.onClose}>
          <XIcon aria-hidden className="size-4" />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">{props.children}</ScrollArea>
    </div>
  );
}
