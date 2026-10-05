import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  TicketActivity,
  TicketActivityEntry,
  TicketActor,
  TicketId,
  TicketPlanId,
  TicketPlanSummary,
  TicketStatusSet,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BotIcon,
  CircleDotIcon,
  CheckIcon,
  ChevronRightIcon,
  FilePenIcon,
  FilePlusIcon,
  FileXIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  UserRoundIcon,
  ZapIcon,
} from "lucide-react";
import { memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useThreadShell, useThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel, formatTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { GitHubIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  foldTicketActivity,
  groupTicketActivity,
  type TicketActivityFamily,
  type TicketActivityRow,
} from "./ticketActivity.logic";
import { ticketPlanRouteParams } from "./ticketPlans.logic";

const FIELD_LABELS = { title: "the title", body: "the description", labels: "the labels" } as const;
const LINK_KIND_LABELS = {
  project: "a project",
  thread: "a thread",
  pull_request: "a pull request",
  issue: "an issue",
} as const;

function joinWords(words: ReadonlyArray<string>): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

export const PLAN_ENTRY_VERBS = {
  plan_created: "created",
  plan_edited: "edited",
  plan_archived: "archived",
  plan_restored: "restored",
  plan_deleted: "deleted",
  plan_review_status_changed: "marked",
} as const;

const SYNC_CHANGE_LABELS: Readonly<Record<string, string>> = {
  ...FIELD_LABELS,
  state: "the issue state",
  assignees: "the assignees",
};

/**
 * A sync's state change lands with the status move that follows it. Alone, it is a close or
 * reopen that reached GitHub while the ticket's move did not save, which the next sync settles.
 */
function describeSynced(changes: ReadonlyArray<string>, movedWithIt: boolean): string {
  if (changes.length === 1 && changes[0] === "state" && !movedWithIt) {
    return "saw the issue's state change on GitHub. The next sync moves the ticket to match";
  }
  return `updated ${joinWords(changes.map((change) => SYNC_CHANGE_LABELS[change] ?? change))} from GitHub`;
}

function describeEntry(
  entry: TicketActivityEntry,
  statusName: (id: string) => string,
  next: TicketActivity | undefined,
): string {
  switch (entry.type) {
    case "created":
      return "created the ticket";
    case "edited":
      return `edited ${joinWords(entry.fields.map((field) => FIELD_LABELS[field]))}`;
    case "status_changed":
      return `moved it from ${statusName(entry.from)} to ${statusName(entry.to)}`;
    case "linked":
      return entry.target.kind === "pull_request" || entry.target.kind === "issue"
        ? `linked ${entry.target.ref.repository}#${entry.target.ref.number}`
        : `linked ${LINK_KIND_LABELS[entry.target.kind]}`;
    case "unlinked":
      return entry.kind === "pull_request" || entry.kind === "issue"
        ? `unlinked ${entry.targetKey}`
        : `unlinked ${LINK_KIND_LABELS[entry.kind]}`;
    case "comment":
      return "commented";
    case "attachment_added":
      return `attached ${entry.name}`;
    case "attachment_removed":
      return `removed ${entry.name}`;
    case "synced":
      return describeSynced(entry.changes, next?.entry.type === "status_changed");
    case "plan_created":
    case "plan_edited":
    case "plan_archived":
    case "plan_restored":
    case "plan_deleted":
      return `${PLAN_ENTRY_VERBS[entry.type]} plan`;
    case "plan_review_status_changed":
      return "marked plan";
  }
}

const ACTOR_ICONS = {
  user: UserRoundIcon,
  agent: BotIcon,
  sync: GitHubIcon,
  automation: ZapIcon,
};
const EVENT_ICONS = {
  created: CircleDotIcon,
  edited: PencilIcon,
  status_changed: CircleDotIcon,
  linked: LinkIcon,
  unlinked: LinkIcon,
  attachment_added: PaperclipIcon,
  attachment_removed: PaperclipIcon,
  synced: RefreshCwIcon,
  plan_created: FilePlusIcon,
  plan_edited: FilePenIcon,
  plan_archived: ArchiveIcon,
  plan_restored: ArchiveRestoreIcon,
  plan_deleted: FileXIcon,
  plan_review_status_changed: CheckIcon,
};
const FAMILY_ICONS = {
  link: LinkIcon,
  attachment: PaperclipIcon,
  edit: PencilIcon,
  status: CircleDotIcon,
  sync: RefreshCwIcon,
  plan: FilePenIcon,
};
const LINK_KIND_NOUNS = {
  project: "project",
  thread: "thread",
  pull_request: "pull request",
  issue: "issue",
} as const;

function ActivityIcon(props: { readonly activity: TicketActivity; readonly className: string }) {
  const { actor, entry } = props.activity;
  const Icon = entry.type === "comment" ? ACTOR_ICONS[actor.type] : EVENT_ICONS[entry.type];
  return <Icon aria-hidden className={props.className} />;
}

function ActivityMarker(props: { readonly activity: TicketActivity }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute start-0 top-1 z-10 flex size-8 items-center justify-center rounded-full bg-background text-muted-foreground",
        props.activity.entry.type === "comment" && "border border-border bg-muted",
      )}
    >
      <ActivityIcon activity={props.activity} className="size-3.5" />
    </span>
  );
}

/** Who did something to a ticket: "You", "GitHub sync", or an agent by its thread's title. */
function ticketActorName(actor: TicketActor, threadTitle: string | undefined): string {
  switch (actor.type) {
    case "user":
      return "You";
    case "sync":
      return "GitHub sync";
    case "automation":
      return "Auto-advance";
    case "agent":
      return threadTitle === undefined ? "An agent" : `An agent in “${threadTitle}”`;
  }
}

/** `ticketActorName` for one actor, watching only the agent's own thread. */
export function TicketActorName(props: {
  readonly environmentId: EnvironmentId;
  readonly actor: TicketActor;
}) {
  const { actor } = props;
  const thread = useThreadShell(
    actor.type === "agent" ? scopeThreadRef(props.environmentId, actor.threadId) : null,
  );
  return ticketActorName(actor, thread?.title);
}

type TimelineView = {
  readonly environmentId: EnvironmentId;
  readonly activity: ReadonlyArray<TicketActivity>;
  readonly planIds: ReadonlySet<TicketPlanId>;
  readonly statusName: (statusId: string) => string;
  readonly actorName: (activity: TicketActivity) => string;
};

type TicketActivityGroup = Extract<TicketActivityRow, { readonly type: "group" }>;

function fullTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString();
}

function PlanReference(props: {
  readonly view: TimelineView;
  readonly ticketId: TicketId;
  readonly planId: TicketPlanId;
  readonly number: number;
}) {
  if (!props.view.planIds.has(props.planId)) return `P${props.number}`;
  return (
    <Link
      to="/tickets/$ticketKey/plans/$planNumber"
      params={ticketPlanRouteParams(
        { environmentId: props.view.environmentId, ticketId: props.ticketId },
        props.number,
      )}
      className="font-medium text-foreground hover:underline"
    >
      P{props.number}
    </Link>
  );
}

function ActivityDescription(props: { readonly view: TimelineView; readonly index: number }) {
  const { view, index } = props;
  const activity = view.activity[index]!;
  const { entry } = activity;
  return (
    <>
      {describeEntry(entry, view.statusName, view.activity[index + 1])}
      {"planId" in entry ? (
        <>
          {" "}
          <PlanReference
            view={view}
            ticketId={activity.ticketId}
            planId={entry.planId}
            number={entry.number}
          />
        </>
      ) : null}
      {entry.type === "plan_review_status_changed"
        ? ` ${entry.to === "ready" ? "Ready" : "Draft"}`
        : null}
    </>
  );
}

function ActivityEntryRow(props: { readonly view: TimelineView; readonly index: number }) {
  const { view, index } = props;
  const activity = view.activity[index]!;
  const comment = activity.entry.type === "comment" ? activity.entry.body : null;
  return (
    <li
      className={cn(
        "relative min-w-0 ps-12 text-xs [content-visibility:auto]",
        comment !== null
          ? "py-1 pb-4 [contain-intrinsic-block-size:120px]"
          : "py-2.5 [contain-intrinsic-block-size:40px]",
      )}
    >
      <ActivityMarker activity={activity} />
      <div className={cn(comment !== null && "overflow-hidden rounded-lg border border-border/70")}>
        <p
          className={cn(
            "leading-5 text-muted-foreground",
            comment !== null && "border-b border-border/50 bg-muted/30 px-4 py-2",
          )}
        >
          <span className="font-medium text-foreground">{view.actorName(activity)}</span>{" "}
          <ActivityDescription view={view} index={index} />
          <time
            dateTime={activity.createdAt}
            aria-label={fullTime(activity.createdAt)}
            className="text-muted-foreground/70"
          >
            {" · "}
            {formatRelativeTimeLabel(activity.createdAt)}
          </time>
        </p>
        {comment !== null ? (
          <div className="px-4 py-3 text-sm">
            <ChatMarkdown
              allowLocalFileLinks={false}
              text={comment}
              cwd={undefined}
              environmentId={view.environmentId}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function describeGroup(
  family: TicketActivityFamily,
  items: ReadonlyArray<TicketActivity>,
  statusName: (statusId: string) => string,
): ReactNode {
  const count = items.length;
  switch (family.type) {
    case "link":
      return `made ${count} ${LINK_KIND_NOUNS[family.kind]} link changes`;
    case "attachment":
      return `made ${count} attachment changes`;
    case "edit":
      return `made ${count} edits`;
    case "status": {
      const first = items[0]!.entry;
      const last = items.at(-1)!.entry;
      return first.type === "status_changed" && last.type === "status_changed"
        ? `moved it ${count} times, from ${statusName(first.from)} to ${statusName(last.to)}`
        : `moved it ${count} times`;
    }
    case "sync":
      return `synced ${count} updates from GitHub`;
    case "plan":
      // A link cannot nest in the toggle button; each expanded line links the plan.
      return (
        <>
          made {count} changes to plan{" "}
          <span className="font-medium text-foreground">P{family.number}</span>
        </>
      );
  }
}

function GroupTally(props: { readonly items: ReadonlyArray<TicketActivity> }) {
  const added = props.items.filter(
    ({ entry }) => entry.type === "linked" || entry.type === "attachment_added",
  ).length;
  return (
    <>
      {" "}
      <span className="whitespace-nowrap">
        (<span className="text-success">+{added}</span>{" "}
        <span className="text-destructive">−{props.items.length - added}</span>)
      </span>
    </>
  );
}

function ActivityGroupMarker(props: {
  readonly family: TicketActivityFamily;
  readonly count: number;
}) {
  const Icon = FAMILY_ICONS[props.family.type];
  return (
    <span aria-hidden className="absolute start-0 top-1 z-10 size-8">
      <span className="absolute inset-0 translate-x-0.75 -translate-y-0.75 rounded-full border border-border bg-background" />
      <span className="absolute inset-0 flex items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <span className="absolute -end-1.5 -bottom-1 min-w-4 rounded-full border-2 border-background bg-muted px-1 text-center text-3xs leading-3 font-medium text-foreground tabular-nums">
        {props.count > 99 ? "99+" : props.count}
      </span>
    </span>
  );
}

function ActivityGroupRow(props: {
  readonly view: TimelineView;
  readonly group: TicketActivityGroup;
  readonly expanded: boolean;
  readonly onToggle: (groupId: number) => void;
}) {
  const { view, group, expanded } = props;
  const cardId = useId();
  const items = view.activity.slice(group.start, group.end);
  const first = items[0]!;
  const last = items.at(-1)!;
  const spanMinutes = Math.floor(
    (Date.parse(last.createdAt) - Date.parse(first.createdAt)) / 60_000,
  );
  return (
    <li className="relative min-w-0 py-2.5 ps-12 text-xs [content-visibility:auto] [contain-intrinsic-block-size:auto_40px]">
      <ActivityGroupMarker family={group.family} count={items.length} />
      <p className="leading-5 text-muted-foreground">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? cardId : undefined}
          onClick={() => props.onToggle(group.id)}
          className="cursor-pointer rounded-sm text-start outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("me-1 inline size-3.5", expanded && "rotate-90")}
          />
          <span className="font-medium text-foreground">{view.actorName(first)}</span>{" "}
          {describeGroup(group.family, items, view.statusName)}
          {group.family.type === "link" || group.family.type === "attachment" ? (
            <GroupTally items={items} />
          ) : null}
          <time
            dateTime={first.createdAt}
            aria-label={`${fullTime(first.createdAt)} – ${fullTime(last.createdAt)}`}
            className="text-muted-foreground/70"
          >
            {" · "}
            {formatRelativeTimeLabel(first.createdAt)}
            {spanMinutes >= 1 ? `, over ${spanMinutes} min` : null}
          </time>
        </button>
      </p>
      {expanded ? <ActivityGroupCard id={cardId} view={view} group={group} /> : null}
    </li>
  );
}

/** Every entry of an expanded group, timed to the second because they share one relative time. */
function ActivityGroupCard(props: {
  readonly id: string;
  readonly view: TimelineView;
  readonly group: TicketActivityGroup;
}) {
  const { view, group } = props;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const indexes = Array.from(
    { length: group.end - group.start },
    (_, offset) => group.start + offset,
  );
  return (
    <div id={props.id} className="mt-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-1">
      <ol className="m-0 list-none p-0">
        {indexes.map((index) => {
          const activity = view.activity[index]!;
          return (
            <li
              key={activity.id}
              className="flex items-start gap-2.5 border-b border-border/50 py-1.5 leading-5 last:border-b-0"
            >
              <ActivityIcon
                activity={activity}
                className="mt-0.75 size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 wrap-break-word text-muted-foreground">
                <ActivityDescription view={view} index={index} />
              </span>
              <time
                dateTime={activity.createdAt}
                aria-label={fullTime(activity.createdAt)}
                className="shrink-0 text-muted-foreground/70 tabular-nums"
              >
                {formatTimestamp(activity.createdAt, timestampFormat)}
              </time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ActivityFoldRow(props: {
  readonly hiddenActivityCount: number;
  readonly hiddenCommentCount: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const comments = props.hiddenCommentCount;
  return (
    <li className="relative py-0.5 ps-12 before:absolute before:inset-y-0 before:start-4 before:w-px before:border-s before:border-dashed before:border-border before:bg-background">
      <Button
        size="xs"
        variant="ghost-muted"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
      >
        <ChevronRightIcon aria-hidden className={cn(props.expanded && "rotate-90")} />
        {props.expanded
          ? "Hide earlier updates"
          : `Show ${props.hiddenActivityCount} earlier updates${
              comments > 0
                ? `, including ${comments} ${comments === 1 ? "comment" : "comments"}`
                : ""
            }`}
      </Button>
    </li>
  );
}

export const TicketActivityTimeline = memo(function TicketActivityTimeline(props: {
  readonly environmentId: EnvironmentId;
  readonly activity: ReadonlyArray<TicketActivity>;
  readonly statusSet: TicketStatusSet | null;
  /** The ticket's plans; an entry about a plan links to it while it exists. */
  readonly plans: ReadonlyArray<TicketPlanSummary>;
}) {
  const threads = useThreadShells();
  const threadTitleById = useMemo(
    () =>
      new Map(
        threads
          .filter((thread) => thread.environmentId === props.environmentId)
          .map((thread) => [thread.id as string, thread.title]),
      ),
    [props.environmentId, threads],
  );
  const planIds = useMemo(() => new Set(props.plans.map((plan) => plan.planId)), [props.plans]);
  const view: TimelineView = {
    environmentId: props.environmentId,
    activity: props.activity,
    planIds,
    statusName: (statusId) =>
      props.statusSet?.statuses.find((status) => status.id === statusId)?.name ??
      "a removed status",
    actorName: ({ actor }) =>
      ticketActorName(
        actor,
        actor.type === "agent" ? threadTitleById.get(actor.threadId) : undefined,
      ),
  };
  const rows = useMemo(() => groupTicketActivity(props.activity), [props.activity]);
  const fold = useMemo(() => foldTicketActivity(rows, props.activity), [rows, props.activity]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<number>>(() => new Set());
  const [showEarlier, setShowEarlier] = useState(false);
  const toggleGroup = useCallback((groupId: number) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (!next.delete(groupId)) next.add(groupId);
      return next;
    });
  }, []);

  const renderRow = (row: TicketActivityRow) =>
    row.type === "entry" ? (
      <ActivityEntryRow key={props.activity[row.index]!.id} view={view} index={row.index} />
    ) : (
      <ActivityGroupRow
        key={row.id}
        view={view}
        group={row}
        expanded={expandedGroupIds.has(row.id)}
        onToggle={toggleGroup}
      />
    );

  return (
    <ol
      aria-label="Ticket activity"
      className="relative m-0 flex list-none flex-col gap-1 p-0 before:absolute before:start-4 before:top-4 before:bottom-4 before:w-px before:bg-border/60"
    >
      {fold.lead.map(renderRow)}
      {fold.earlier.length > 0 ? (
        <ActivityFoldRow
          hiddenActivityCount={fold.hiddenActivityCount}
          hiddenCommentCount={fold.hiddenCommentCount}
          expanded={showEarlier}
          onToggle={() => setShowEarlier((value) => !value)}
        />
      ) : null}
      {showEarlier ? fold.earlier.map(renderRow) : null}
      {fold.recent.map(renderRow)}
    </ol>
  );
});
