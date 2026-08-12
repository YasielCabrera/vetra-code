import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentAutomation } from "@vetra-studio/client-runtime/state/automations";
import {
  CalendarClockIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CloudIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayCircleIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useAllEnvironmentShellsBootstrapped, useThreadShells } from "../../state/entities";
import { useAutomationActions } from "../../hooks/useAutomationActions";
import { useAutomations, useEnvironmentSupportsAutomations } from "../../state/automations";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import {
  buildAutomationRowModels,
  matchesAutomationQuery,
  runCountLabel,
  sortAutomationRows,
  type AutomationRowModel,
  type AutomationRowStatus,
} from "./automationsList.logic";
import { AutomationDetailPanel } from "./AutomationDetailPanel";
import { AUTOMATION_TEMPLATES, type AutomationTemplate } from "./automationTemplates";

export function AutomationsPage(props?: {
  /** Present when a route selected an automation, so the panel is open. */
  readonly automationKey?: string;
  readonly isNew?: boolean;
  readonly templateId?: string;
}) {
  const navigate = useNavigate();
  const panelOpen = props?.automationKey !== undefined || props?.isNew === true;
  const automations = useAutomations();
  const threads = useThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  // Until the workspace has said what it holds, an empty list means "not
  // loaded" rather than "none" — and telling somebody to create the automation
  // they already have is the one wrong thing an empty state can say.
  const automationsKnown = useAllEnvironmentShellsBootstrapped();
  // New automations land on the primary environment, so its server is the one
  // that has to understand them. An older server gets told, not a command it
  // would reject.
  const canCreate = useEnvironmentSupportsAutomations(primaryEnvironmentId);
  const [query, setQuery] = useState("");

  const projectTitleByKey = useMemo(
    () =>
      new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project.title])),
    [projects],
  );
  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  // Labelled the way the picker labels it, so a row reads the same as the form
  // that produced it. Falls back to the raw slug for a model this workspace no
  // longer offers.
  const modelLabelBySlug = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entry of applyProviderInstanceSettings(
      deriveProviderInstanceEntries(serverProviders),
      settings,
    )) {
      for (const model of entry.models) {
        labels.set(`${entry.instanceId}:${model.slug}`, getTriggerDisplayModelLabel(model));
      }
    }
    return labels;
  }, [serverProviders, settings]);

  const rows = useMemo(
    () =>
      sortAutomationRows(
        buildAutomationRowModels({
          automations,
          threads,
          resolveProjectName: (automation) =>
            projectTitleByKey.get(`${automation.environmentId}:${automation.projectId}`) ?? null,
          resolveModelLabel: (automation) =>
            modelLabelBySlug.get(
              `${automation.modelSelection.instanceId}:${automation.modelSelection.model}`,
            ) ?? automation.modelSelection.model,
          // Named only when the automation runs somewhere other than here: a
          // label on every row would say nothing about any of them.
          resolveEnvironmentLabel: (automation) =>
            automation.environmentId === primaryEnvironmentId
              ? null
              : (environmentLabelById.get(automation.environmentId) ?? null),
          use24Hour: timestampFormat === "24-hour",
        }),
      ),
    [
      automations,
      environmentLabelById,
      modelLabelBySlug,
      primaryEnvironmentId,
      projectTitleByKey,
      threads,
      timestampFormat,
    ],
  );

  const visibleRows = useMemo(
    () => rows.filter((row) => matchesAutomationQuery(row, query)),
    [query, rows],
  );

  const openAutomation = useCallback(
    (automation: EnvironmentAutomation) => {
      void navigate({
        to: "/automations/$automationKey",
        params: { automationKey: `${automation.environmentId}:${automation.id}` },
      });
    },
    [navigate],
  );
  const newAutomation = useCallback(
    (template?: AutomationTemplate) => {
      void navigate({
        to: "/automations/new",
        search: { template: template?.id },
      });
    },
    [navigate],
  );

  const breadcrumb = (
    <WorkspaceBreadcrumb ariaLabel="Automations breadcrumb">
      <WorkspaceBreadcrumbItem current>
        <h1 className="truncate">Automations</h1>
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {/* Full width, above both columns: on desktop this strip is the window
            drag region, so it cannot live inside one of them. */}
        <>
          {!isElectron && (
            <header
              className={cn(
                "workspace-topbar px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
                COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
              )}
            >
              {breadcrumb}
            </header>
          )}
          {isElectron && (
            <div
              className={cn(
                "drag-region flex h-[52px] shrink-0 items-center px-5 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
                COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
              )}
            >
              {breadcrumb}
            </div>
          )}
        </>

        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          {/* A query container, so the list reacts to its own width rather
              than the viewport's: the same column is full-bleed on its own and
              a narrow rail beside an open panel, and its rows and template grid
              need to read well in both. */}
          <div
            className={cn(
              "@container/list flex min-h-0 min-w-0 flex-col",
              // The list yields to the panel rather than being replaced by it,
              // so the automation you opened stays visible beside its detail.
              // Below lg there is not room for both, and the panel wins.
              panelOpen ? "hidden w-full max-w-md shrink-0 lg:flex" : "flex-1",
            )}
          >
            <ScrollArea className="min-h-0 flex-1">
              <div
                className={cn(
                  "flex w-full flex-col gap-4 px-5 pt-6 pb-12",
                  panelOpen ? "max-w-none" : "mx-auto max-w-4xl",
                )}
              >
                {/* Onboarding copy is the first thing to go when the column is
                    a rail beside an open panel. */}
                <p className="hidden text-sm text-muted-foreground @min-[34rem]/list:block">
                  Run a prompt on a schedule. Each run opens its own thread, kept out of the sidebar
                  until you move it there.
                </p>

                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <SearchIcon
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search automations"
                      aria-label="Search automations"
                      className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 sm:h-8"
                    />
                  </div>
                  {/* Sheds its label before the search field starves. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={!canCreate}
                    aria-label="New automation"
                    title={
                      canCreate
                        ? "New automation"
                        : "Update this environment's server to create automations."
                    }
                    onClick={() => newAutomation()}
                  >
                    <PlusIcon />
                    <span className="hidden @min-[34rem]/list:inline">New automation</span>
                  </Button>
                </div>

                {rows.length === 0 && !automationsKnown ? (
                  <AutomationsListGhost rows={3} />
                ) : rows.length === 0 ? (
                  <AutomationsEmptyState
                    title={canCreate ? "No automations yet" : "Automations need a newer server"}
                    description={
                      canCreate
                        ? "Schedule a prompt and Vetra will run it for you, once or on repeat."
                        : "Update the Vetra Studio server in this environment to schedule work."
                    }
                    action={
                      canCreate ? (
                        <Button size="sm" onClick={() => newAutomation()}>
                          <PlusIcon />
                          New automation
                        </Button>
                      ) : null
                    }
                  />
                ) : visibleRows.length === 0 ? (
                  <AutomationsEmptyState
                    title="No automations match this search"
                    description={`Nothing in this workspace matches “${query.trim()}”.`}
                    action={
                      <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                        Clear search
                      </Button>
                    }
                  />
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {visibleRows.map((row) => (
                      <AutomationRow
                        key={`${row.automation.environmentId}:${row.automation.id}`}
                        row={row}
                        onOpen={openAutomation}
                      />
                    ))}
                  </ul>
                )}

                {/* Suggestions outlive the empty state: they are the fastest way to
                a second automation, not just a first. They step aside during a
                search, where the only thing on screen should be matches. */}
                {automationsKnown && query.trim().length === 0 ? (
                  <>
                    <div
                      aria-hidden
                      className="mt-2 h-px bg-[repeating-linear-gradient(to_right,var(--color-border)_0,var(--color-border)_4px,transparent_4px,transparent_8px)]"
                    />
                    {rows.length > 0 ? (
                      <p className="px-2 text-xs font-medium text-muted-foreground">
                        Start from a template
                      </p>
                    ) : null}
                    <ul className="m-0 grid list-none grid-cols-1 gap-x-8 gap-y-5 p-0 @min-[42rem]/list:grid-cols-2">
                      {AUTOMATION_TEMPLATES.map((template) => (
                        <AutomationTemplateRow
                          key={template.id}
                          template={template}
                          onSelect={newAutomation}
                        />
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            </ScrollArea>
          </div>
          {panelOpen ? (
            <AutomationDetailPanel
              key={props?.automationKey ?? "new"}
              {...(props?.automationKey !== undefined
                ? { automationKey: props.automationKey }
                : {})}
              {...(props?.templateId !== undefined ? { templateId: props.templateId } : {})}
              onClose={() => void navigate({ to: "/automations" })}
            />
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}

function statusPresentation(status: AutomationRowStatus): {
  readonly label: string;
  readonly className: string;
  readonly icon: ReactNode;
} {
  switch (status.kind) {
    case "running":
      return {
        label: "Running",
        className: "text-sky-600 dark:text-sky-400",
        icon: <CircleDashedIcon aria-hidden className="size-3" />,
      };
    case "paused":
      return {
        label: "Paused",
        className: "text-muted-foreground",
        icon: <PauseIcon aria-hidden className="size-3" />,
      };
    case "missed":
      return {
        label: `Missed ${formatRelativeTimeLabel(status.scheduledFor)}`,
        className: "text-amber-700 dark:text-amber-300",
        icon: <CircleAlertIcon aria-hidden className="size-3" />,
      };
    case "skipped":
      return {
        label: `Skipped ${formatRelativeTimeLabel(status.scheduledFor)}`,
        className: "text-amber-700 dark:text-amber-300",
        icon: <CircleAlertIcon aria-hidden className="size-3" />,
      };
    case "scheduled":
      return {
        label: `Next ${formatRelativeTimeLabel(status.nextRunAt)}`,
        className: "text-muted-foreground",
        icon: <CalendarClockIcon aria-hidden className="size-3" />,
      };
    case "idle":
      return {
        label: "Not scheduled",
        className: "text-muted-foreground",
        icon: <CircleDashedIcon aria-hidden className="size-3" />,
      };
  }
}

/**
 * Memoized: a search narrows the list on every keystroke, and a row whose
 * automation and counts are unchanged has nothing new to say.
 */
const AutomationRow = memo(function AutomationRow({
  row,
  onOpen,
}: {
  row: AutomationRowModel;
  onOpen: (automation: EnvironmentAutomation) => void;
}) {
  const status = statusPresentation(row.status);
  const { confirmAndDelete, runNow, setEnabled } = useAutomationActions();
  const automation = row.automation;
  return (
    <li className="group/automation-row flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-accent/60">
      <button
        type="button"
        onClick={() => onOpen(row.automation)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <CalendarClockIcon
          aria-hidden
          className={cn(
            "size-5 shrink-0",
            row.automation.enabled ? "text-muted-foreground" : "text-muted-foreground/50",
          )}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium",
              row.automation.enabled ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {row.automation.title}
          </span>
          {/* The schedule is the one thing this line must always say, so it
              never yields: the other facts drop out with the container instead
              of squeezing it to nothing and leaving a stray separator. */}
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/70">
            <span className="shrink-0 truncate">{row.scheduleLabel}</span>
            {row.modelLabel ? (
              <span className="hidden min-w-0 truncate @min-[26rem]/list:inline">
                · {row.modelLabel}
              </span>
            ) : null}
            {row.projectName ? (
              <span className="hidden min-w-0 truncate @min-[40rem]/list:inline">
                · {row.projectName}
              </span>
            ) : null}
            {row.environmentLabel ? (
              <span className="hidden shrink-0 items-center gap-1 @min-[48rem]/list:flex">
                <CloudIcon aria-hidden className="size-3" />
                <span className="max-w-32 truncate">{row.environmentLabel}</span>
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums">
          <span className={cn("flex items-center gap-1", status.className)}>
            {status.icon}
            {status.label}
          </span>
          <span className="text-muted-foreground/70">{runCountLabel(row.runCount)}</span>
        </span>
      </button>
      {/* Revealed on hover, and always on touch, where there is no hover to
          reveal it with. */}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Options for ${automation.title}`}
              className="shrink-0 opacity-0 transition-opacity group-hover/automation-row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end" className="w-44">
          <MenuItem onClick={() => void runNow(automation)}>
            <PlayIcon aria-hidden />
            Run now
          </MenuItem>
          <MenuItem onClick={() => void setEnabled(automation, !automation.enabled)}>
            {automation.enabled ? <PauseIcon aria-hidden /> : <PlayCircleIcon aria-hidden />}
            {automation.enabled ? "Pause" : "Resume"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={() => void confirmAndDelete(automation, row.runThreads)}
          >
            <Trash2Icon aria-hidden />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
});

function AutomationTemplateRow({
  template,
  onSelect,
}: {
  template: AutomationTemplate;
  onSelect: (template: AutomationTemplate) => void;
}) {
  const Icon = template.icon;
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => onSelect(template)}
        className="flex w-full min-w-0 items-start gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {template.title}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {template.description}
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/70">
            <CalendarClockIcon aria-hidden className="size-3" />
            {template.scheduleLabel}
          </span>
        </span>
      </button>
    </li>
  );
}

function AutomationsEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
      <CalendarClockIcon aria-hidden className="size-8 text-muted-foreground/60" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Only for a cold start, where the workspace has not said what it holds yet. */
function AutomationsListGhost({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-0.5">
      {Array.from({ length: rows }, (_unused, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2">
          <div className="size-5 shrink-0 rounded bg-muted/60" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-40 rounded bg-muted/60" />
            <div className="h-2.5 w-56 rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>
  );
}
