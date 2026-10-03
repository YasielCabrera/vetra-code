import {
  type EnvironmentId,
  TICKET_GITHUB_SOURCE_ISSUE_WARNING,
  type TicketAutoAdvanceSettings,
  type TicketCloseReason,
  type TicketStatusCategory,
  type TicketStatusDefinition,
  type TicketStatusId,
  type TicketStatusSet,
} from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { useRunning } from "../../hooks/useRunning";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useTicketActions } from "../../hooks/useTicketActions";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useProjects } from "../../state/entities";
import {
  type EnvironmentTicketGitHubSource,
  useEnvironmentSupportsTickets,
  useTicketGitHubSources,
  useTicketStatuses,
} from "../../state/tickets";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { GitHubIcon } from "../Icons";
import { eligibleTicketGitHubProjects } from "../tickets/ticketGitHub.logic";
import { useTicketGitHubRemotes } from "../tickets/useTicketGitHubRemotes";
import { TICKET_STATUS_COLOR_OPTIONS, TicketStatusIcon } from "../tickets/ticketPresentation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  enqueueTicketStatusEdit,
  moveTicketStatus,
  settleTicketStatusEdit,
  type TicketStatusEdit,
  type TicketStatusEditQueue,
  ticketStatusUpsert,
} from "./ticketStatusSettings.logic";

const CATEGORY_OPTIONS: ReadonlyArray<{ value: TicketStatusCategory; label: string }> = [
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
];

const CLOSE_REASON_OPTIONS: ReadonlyArray<{ value: TicketCloseReason; label: string }> = [
  { value: "completed", label: "Completed" },
  { value: "not_planned", label: "Not planned" },
];

export function TicketsSettingsPanel() {
  const { scope, environment } = useSettingsScope();
  const environmentId =
    scope.environmentIds.length === 1 ? (environment?.environmentId ?? null) : null;
  const supported = useEnvironmentSupportsTickets(environmentId);
  const statusSet = useTicketStatuses(supported ? environmentId : null);

  return (
    <SettingsPageContainer>
      <SettingsSection {...searchableSetting("ticket-statuses")}>
        {environmentId === null ? (
          <SettingsRow
            title="Ticket statuses"
            description="Choose one environment. Each environment keeps its own statuses."
          />
        ) : !supported ? (
          <SettingsRow
            title="Ticket statuses"
            description="Update this environment's Vetra Code server to keep tickets."
          />
        ) : statusSet === null ? (
          <SettingsRow title="Ticket statuses" description="Loading statuses…" />
        ) : (
          <TicketStatusEditor
            key={environmentId}
            environmentId={environmentId}
            statusSet={statusSet}
          />
        )}
      </SettingsSection>
      {environmentId !== null && supported ? (
        <SettingsSection {...searchableSetting("ticket-github-sources")}>
          <TicketGitHubSources environmentId={environmentId} />
        </SettingsSection>
      ) : null}
      {environmentId !== null && supported && statusSet !== null ? (
        <SettingsSection title="Auto-advance">
          <TicketAutoAdvanceRows environmentId={environmentId} statusSet={statusSet} />
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}

function TicketGitHubSources(props: { readonly environmentId: EnvironmentId }) {
  const actions = useTicketActions();
  const allProjects = useProjects();
  const allSources = useTicketGitHubSources();
  const [adding, trackAdd] = useRunning();
  const [addOpen, setAddOpen] = useState(false);
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === props.environmentId),
    [allProjects, props.environmentId],
  );
  const sources = useMemo(
    () => allSources.filter((source) => source.environmentId === props.environmentId),
    [allSources, props.environmentId],
  );
  const remotes = useTicketGitHubRemotes(projects, addOpen);
  const candidates = useMemo(
    () => eligibleTicketGitHubProjects({ projects: remotes.projects, sources }),
    [remotes.projects, sources],
  );
  const projectTitle = (source: EnvironmentTicketGitHubSource) =>
    projects.find((project) => project.id === source.projectId)?.title ?? "Missing project";

  return (
    <div className="flex flex-col">
      {sources.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
          Bring a repository's open GitHub issues onto the board as tickets. Sync runs every 10
          minutes through the GitHub CLI signed in on this environment.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {sources.map((source) => (
            <TicketGitHubSourceRow
              key={`${source.projectId}:${source.host}/${source.repository}`}
              source={source}
              projectTitle={projectTitle(source)}
            />
          ))}
        </ul>
      )}
      <div className="border-t border-border/50 px-3 py-2 sm:px-4">
        <Menu open={addOpen} onOpenChange={setAddOpen}>
          <MenuTrigger render={<Button size="xs" variant="ghost" disabled={adding} />}>
            <PlusIcon aria-hidden />
            Add repository
          </MenuTrigger>
          <MenuPopup align="start" className="w-72">
            <MenuGroup>
              <MenuGroupLabel>From a project's GitHub remote</MenuGroupLabel>
              {remotes.errors.map((error) => (
                <p
                  key={error}
                  role="alert"
                  className="px-2 py-2 text-xs text-destructive-foreground"
                >
                  {error}
                </p>
              ))}
              {remotes.loading ? <MenuItem disabled>Loading project remotes…</MenuItem> : null}
              {candidates.length === 0 && !remotes.loading && remotes.errors.length === 0 ? (
                <MenuItem disabled>
                  {projects.length === 0
                    ? "No projects in this environment"
                    : "No unconnected GitHub remotes"}
                </MenuItem>
              ) : (
                candidates.map((candidate) => (
                  <MenuItem
                    key={`${candidate.project.id}:${candidate.host}:${candidate.repository}:${candidate.remoteName}`}
                    onClick={() =>
                      void trackAdd(() =>
                        actions.addGitHubSource(props.environmentId, {
                          projectId: candidate.project.id,
                          host: candidate.host,
                          repository: candidate.repository,
                        }),
                      )
                    }
                  >
                    <GitHubIcon aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{candidate.repository}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {candidate.project.title} · {candidate.remoteName}
                        {candidate.host !== "github.com" ? ` · ${candidate.host}` : ""}
                      </span>
                    </span>
                  </MenuItem>
                ))
              )}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

function TicketGitHubSourceRow(props: {
  readonly source: EnvironmentTicketGitHubSource;
  readonly projectTitle: string;
}) {
  const { source } = props;
  const actions = useTicketActions();
  const [syncing, trackSync] = useRunning();
  const ref = { projectId: source.projectId, host: source.host, repository: source.repository };
  const remove = async (deleteCache: boolean) => {
    if (deleteCache) {
      const confirmed =
        (await readLocalApi()?.dialogs.confirm(
          `Remove ${source.repository} and delete its tickets?\nTheir statuses, links and notes go with them. The issues stay on GitHub.`,
          { variant: "destructive" },
        )) ?? true;
      if (!confirmed) return;
    }
    await actions.removeGitHubSource(source.environmentId, ref, deleteCache);
  };
  const syncedLabel = syncing
    ? "Syncing"
    : source.lastSyncedAt === null
      ? "Not synced yet"
      : `Synced ${formatRelativeTimeLabel(source.lastSyncedAt)}`;

  return (
    <li className="flex flex-col gap-1.5 border-t border-border/50 px-3 py-2.5 first:border-t-0 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <GitHubIcon aria-hidden className="size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">{source.repository}</span>
          <span className="truncate text-xs text-muted-foreground">
            {props.projectTitle} · {syncedLabel} · {source.issueCount} open issue
            {source.issueCount === 1 ? "" : "s"}
          </span>
        </div>
        <Switch
          checked={source.enabled}
          aria-label={`Sync ${source.repository} automatically`}
          onCheckedChange={(enabled) =>
            void actions.setGitHubSourceEnabled(source.environmentId, ref, enabled)
          }
        />
        <Button
          size="xs"
          variant="ghost"
          disabled={syncing}
          onClick={() => void trackSync(() => actions.syncGitHubSource(source.environmentId, ref))}
        >
          <RefreshIcon refreshing={syncing} />
          Sync now
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="ghost" aria-label={`Remove ${source.repository}`} />
            }
          >
            <Trash2Icon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end" className="w-64">
            <MenuItem onClick={() => void remove(false)}>Remove and hide its tickets</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => void remove(true)}>
              Remove and also delete cached tickets
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {source.lastError === null ? null : (
        <p className="text-xs text-destructive-foreground">{source.lastError}</p>
      )}
      {source.issueCount > TICKET_GITHUB_SOURCE_ISSUE_WARNING ? (
        <p className="text-xs text-warning-foreground">
          More than {TICKET_GITHUB_SOURCE_ISSUE_WARNING.toLocaleString()} open issues sync from this
          repository, which makes the board slower to load and filter.
        </p>
      ) : null}
    </li>
  );
}

const AUTO_ADVANCE_TARGETS: ReadonlyArray<{
  readonly key: Exclude<keyof TicketAutoAdvanceSettings, "enabled">;
  readonly title: string;
  readonly description: string;
  readonly fallback: TicketStatusCategory;
}> = [
  {
    key: "threadStartedStatusId",
    title: "When a thread starts",
    description: "A message with an open ticket attached moves it here.",
    fallback: "active",
  },
  {
    key: "pullRequestLinkedStatusId",
    title: "When a pull request is linked",
    description: "A pull request on a thread linked to the ticket moves it here.",
    fallback: "active",
  },
  {
    key: "pullRequestMergedStatusId",
    title: "When the pull request merges",
    description: "Moves local tickets here. GitHub tickets follow their issue instead.",
    fallback: "closed",
  },
];

function TicketAutoAdvanceRows(props: {
  readonly environmentId: EnvironmentId;
  readonly statusSet: TicketStatusSet;
}) {
  const settings = useEnvironmentSettings(props.environmentId, (all) => all.ticketAutoAdvance);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const statuses = props.statusSet.statuses;
  const items = statuses.map((status) => ({ value: status.id, label: status.name }));
  return (
    <>
      <SettingsRow
        serverScoped
        {...searchableSetting("ticket-auto-advance")}
        description="Move tickets forward as their threads and pull requests progress. Links are kept either way."
        control={
          <Switch
            checked={settings.enabled}
            aria-label="Auto-advance tickets"
            onCheckedChange={(enabled) => updateSettings({ ticketAutoAdvance: { enabled } })}
          />
        }
      />
      {settings.enabled
        ? AUTO_ADVANCE_TARGETS.map((target) => {
            const selected =
              statuses.find((status) => status.id === settings[target.key]) ??
              statuses.find((status) => status.category === target.fallback && status.isDefault);
            return (
              <SettingsRow
                key={target.key}
                serverScoped
                title={target.title}
                description={target.description}
                control={
                  <Select
                    items={items}
                    value={selected?.id ?? null}
                    onValueChange={(value) => {
                      const status = statuses.find((candidate) => candidate.id === value);
                      if (status !== undefined) {
                        updateSettings({ ticketAutoAdvance: { [target.key]: status.id } });
                      }
                    }}
                  >
                    <SelectTrigger size="xs" className="w-36" aria-label={target.title}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {statuses.map((status) => (
                        <SelectItem key={status.id} value={status.id}>
                          <TicketStatusIcon color={status.color} category={status.category} />
                          {status.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            );
          })
        : null}
    </>
  );
}

function TicketStatusEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly statusSet: TicketStatusSet;
}) {
  const actions = useTicketActions();
  const statuses = props.statusSet.statuses;
  const statusIds = statuses.map((status) => status.id);
  const [editQueues] = useState(() => new Map<TicketStatusId, TicketStatusEditQueue>());

  const save = async (status: TicketStatusDefinition, edit: TicketStatusEdit) => {
    const previous = editQueues.get(status.id);
    editQueues.set(status.id, enqueueTicketStatusEdit(previous, status, edit));
    if (previous !== undefined && previous.edits.length > 0) return;

    for (;;) {
      const queue = editQueues.get(status.id);
      const nextEdit = queue?.edits[0];
      if (queue === undefined || nextEdit === undefined) return;
      const result = await actions.upsertStatus(
        props.environmentId,
        ticketStatusUpsert(queue.status, nextEdit),
      );
      const pending = editQueues.get(status.id);
      if (pending !== undefined) {
        editQueues.set(status.id, settleTicketStatusEdit(pending, result));
      }
    }
  };

  return (
    <div className="flex flex-col">
      <ul className="m-0 flex list-none flex-col p-0">
        {statuses.map((status, index) => (
          <TicketStatusRow
            key={status.id}
            status={status}
            reassignTargets={statuses.filter(
              (other) => other.id !== status.id && other.category === status.category,
            )}
            isFirst={index === 0}
            isLast={index === statuses.length - 1}
            onSave={(edit) => void save(status, edit)}
            onMove={(direction) =>
              void actions.reorderStatuses(
                props.environmentId,
                moveTicketStatus(statusIds, status.id, direction),
              )
            }
            onDelete={(reassignTo) =>
              void actions.deleteStatus(props.environmentId, status.id, reassignTo.id)
            }
          />
        ))}
      </ul>
      <div className="px-3 py-2 sm:px-4">
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void actions.upsertStatus(props.environmentId, {
              name: "New status",
              color: "gray",
              category: "open",
            })
          }
        >
          <PlusIcon aria-hidden />
          Add status
        </Button>
      </div>
    </div>
  );
}

function TicketStatusRow(props: {
  readonly status: TicketStatusDefinition;
  /** Where its tickets can go when it is deleted: its category's other statuses. */
  readonly reassignTargets: ReadonlyArray<TicketStatusDefinition>;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onSave: (edit: TicketStatusEdit) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onDelete: (reassignTo: TicketStatusDefinition) => void;
}) {
  const { status } = props;
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const commitName = () => {
    if (nameDraft === null) return;
    const name = nameDraft.trim();
    setNameDraft(null);
    if (name.length > 0 && name !== status.name) props.onSave({ name });
  };

  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2 first:border-t-0 sm:px-4">
      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost" aria-label={`Color of ${status.name}`} />}
        >
          <TicketStatusIcon color={status.color} category={status.category} />
        </MenuTrigger>
        <MenuPopup align="start">
          {TICKET_STATUS_COLOR_OPTIONS.map((option) => (
            <MenuItem key={option.value} onClick={() => props.onSave({ color: option.value })}>
              <span aria-hidden className={cn("size-3 rounded-full", option.swatchClassName)} />
              {option.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      <Input
        size="compact"
        value={nameDraft ?? status.name}
        maxLength={64}
        aria-label="Status name"
        className="w-40"
        onChange={(event) => setNameDraft(event.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setNameDraft(null);
        }}
      />
      <Select
        items={CATEGORY_OPTIONS}
        value={status.category}
        onValueChange={(value) => {
          const category = CATEGORY_OPTIONS.find((option) => option.value === value)?.value;
          if (category !== undefined && category !== status.category) props.onSave({ category });
        }}
      >
        <SelectTrigger size="xs" className="w-24" aria-label="Category" disabled={status.isDefault}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {CATEGORY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {status.category === "closed" ? (
        <Select
          items={CLOSE_REASON_OPTIONS}
          value={status.closeReason}
          onValueChange={(value) => {
            const closeReason = CLOSE_REASON_OPTIONS.find(
              (option) => option.value === value,
            )?.value;
            if (closeReason !== undefined) props.onSave({ closeReason });
          }}
        >
          <SelectTrigger size="xs" className="w-28" aria-label="Close reason">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {CLOSE_REASON_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {status.isDefault ? (
        <Badge variant="secondary">Default</Badge>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => props.onSave({ makeDefault: true })}>
          Set default
        </Button>
      )}
      <label className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch
          checked={status.collapsedByDefault}
          onCheckedChange={(collapsedByDefault) => props.onSave({ collapsedByDefault })}
        />
        Collapsed
      </label>
      <div className="flex items-center">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Move ${status.name} up`}
          disabled={props.isFirst}
          onClick={() => props.onMove(-1)}
        >
          <ArrowUpIcon aria-hidden />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Move ${status.name} down`}
          disabled={props.isLast}
          onClick={() => props.onMove(1)}
        >
          <ArrowDownIcon aria-hidden />
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Delete ${status.name}`}
                disabled={props.reassignTargets.length === 0}
              />
            }
          >
            <Trash2Icon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end" className="w-56">
            <MenuGroup>
              <MenuGroupLabel>Move its tickets to</MenuGroupLabel>
              {props.reassignTargets.map((other) => (
                <MenuItem key={other.id} onClick={() => props.onDelete(other)}>
                  <TicketStatusIcon color={other.color} category={other.category} />
                  {other.name}
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
    </li>
  );
}
