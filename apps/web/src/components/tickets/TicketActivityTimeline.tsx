import type {
  EnvironmentId,
  TicketActivity,
  TicketActivityEntry,
  TicketStatusSet,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BotIcon,
  CircleDotIcon,
  FilePenIcon,
  FilePlusIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  UserRoundIcon,
  ZapIcon,
} from "lucide-react";
import { memo, useMemo } from "react";

import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { GitHubIcon } from "../Icons";

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
      return `created plan P${entry.number}`;
    case "plan_edited":
      return `edited plan P${entry.number}`;
    case "plan_archived":
      return `archived plan P${entry.number}`;
    case "plan_restored":
      return `restored plan P${entry.number}`;
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
};

function ActivityMarker(props: { readonly activity: TicketActivity }) {
  const { actor, entry } = props.activity;
  const Icon = entry.type === "comment" ? ACTOR_ICONS[actor.type] : EVENT_ICONS[entry.type];
  return (
    <span
      aria-hidden
      className={cn(
        "absolute start-0 top-1 z-10 flex size-8 items-center justify-center rounded-full bg-background text-muted-foreground",
        entry.type === "comment" && "border border-border bg-muted",
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

export const TicketActivityTimeline = memo(function TicketActivityTimeline(props: {
  readonly environmentId: EnvironmentId;
  readonly activity: ReadonlyArray<TicketActivity>;
  readonly statusSet: TicketStatusSet | null;
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
  const statusName = (statusId: string) =>
    props.statusSet?.statuses.find((status) => status.id === statusId)?.name ?? "a removed status";
  const actorName = (activity: TicketActivity) => {
    switch (activity.actor.type) {
      case "user":
        return "You";
      case "sync":
        return "GitHub sync";
      case "automation":
        return "Auto-advance";
      case "agent": {
        const title = threadTitleById.get(activity.actor.threadId);
        return title === undefined ? "An agent" : `An agent in “${title}”`;
      }
    }
  };

  return (
    <ol
      aria-label="Ticket activity"
      className="relative m-0 flex list-none flex-col gap-1 p-0 before:absolute before:start-4 before:top-4 before:bottom-4 before:w-px before:bg-border/60"
    >
      {props.activity.map((activity, index) => (
        <li
          key={activity.id}
          className={cn(
            "relative min-w-0 ps-12 text-xs [content-visibility:auto]",
            activity.entry.type === "comment"
              ? "py-1 pb-4 [contain-intrinsic-block-size:120px]"
              : "py-2.5 [contain-intrinsic-block-size:40px]",
          )}
        >
          <ActivityMarker activity={activity} />
          <div
            className={cn(
              activity.entry.type === "comment" &&
                "overflow-hidden rounded-lg border border-border/70",
            )}
          >
            <p
              className={cn(
                "leading-5 text-muted-foreground",
                activity.entry.type === "comment" &&
                  "border-b border-border/50 bg-muted/30 px-4 py-2",
              )}
            >
              <span className="font-medium text-foreground">{actorName(activity)}</span>{" "}
              {describeEntry(activity.entry, statusName, props.activity[index + 1])}
              <time
                dateTime={activity.createdAt}
                aria-label={new Date(activity.createdAt).toLocaleString()}
                className="text-muted-foreground/70"
              >
                {" · "}
                {formatRelativeTimeLabel(activity.createdAt)}
              </time>
            </p>
            {activity.entry.type === "comment" ? (
              <div className="px-4 py-3 text-sm">
                <ChatMarkdown
                  allowLocalFileLinks={false}
                  text={activity.entry.body}
                  cwd={undefined}
                  environmentId={props.environmentId}
                />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
});
