import type {
  EnvironmentId,
  IssueActivity,
  IssueTimelineComment,
  IssueTimelineEvent,
} from "@t3tools/contracts";
import {
  ArchiveRestoreIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  FlagIcon,
  FolderKanbanIcon,
  GitCommitHorizontalIcon,
  LinkIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  PinIcon,
  TagIcon,
  UnlockIcon,
  UserRoundIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { formatRelativeTimeLabel } from "~/timestampFormat";

import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { Button } from "../ui/button";
import { IssueConversationCard } from "./IssueConversationCard";
import { buildIssueTimeline, issueTimelineEventLabel } from "./issueTimeline.logic";

function TimelineMarker({ children }: { readonly children: ReactNode }) {
  return (
    <span className="absolute left-0 top-6 z-10 flex size-8 -translate-y-1/2 items-center justify-center bg-background">
      {children}
    </span>
  );
}

function EventIcon({ event }: { readonly event: IssueTimelineEvent }) {
  const className = "size-3.5";
  switch (event.kind) {
    case "assigned":
    case "unassigned":
      return <UserRoundIcon aria-hidden className={className} />;
    case "labeled":
    case "unlabeled":
      return <TagIcon aria-hidden className={className} />;
    case "milestoned":
    case "demilestoned":
      return <FlagIcon aria-hidden className={className} />;
    case "renamed":
      return <PencilIcon aria-hidden className={className} />;
    case "locked":
      return <LockIcon aria-hidden className={className} />;
    case "unlocked":
      return <UnlockIcon aria-hidden className={className} />;
    case "pinned":
    case "unpinned":
      return <PinIcon aria-hidden className={className} />;
    case "added_to_project":
    case "moved_columns_in_project":
    case "removed_from_project":
      return <FolderKanbanIcon aria-hidden className={className} />;
    case "referenced":
      return event.commitId ? (
        <GitCommitHorizontalIcon aria-hidden className={className} />
      ) : (
        <LinkIcon aria-hidden className={className} />
      );
    case "cross-referenced":
    case "connected":
    case "disconnected":
      return <LinkIcon aria-hidden className={className} />;
    case "reopened":
      return <ArchiveRestoreIcon aria-hidden className={className} />;
    default:
      return <CircleDotIcon aria-hidden className={className} />;
  }
}

function CommentMarker({ comment }: { readonly comment: IssueTimelineComment }) {
  const actor = comment.actor;
  return (
    <TimelineMarker>
      {actor === null ? (
        <MessageSquareIcon aria-hidden className="size-3.5 text-muted-foreground" />
      ) : (
        <SourceControlActorAvatar
          actor={actor}
          className="size-7 border border-border text-[9px] font-semibold"
        />
      )}
    </TimelineMarker>
  );
}

function ConversationItem({
  item,
  environmentId,
  onOpen,
}: {
  readonly item: IssueTimelineComment;
  readonly environmentId: EnvironmentId;
  readonly onOpen: (url: string) => void;
}) {
  return (
    <div className="relative mb-5 pl-12 [contain-intrinsic-block-size:160px] [content-visibility:auto]">
      <CommentMarker comment={item} />
      <IssueConversationCard
        action="commented"
        actor={item.actor}
        body={item.body}
        createdAt={item.createdAt}
        environmentId={environmentId}
        url={item.url}
        onOpen={onOpen}
      />
    </div>
  );
}

function EventItem({
  event,
  onOpen,
}: {
  readonly event: IssueTimelineEvent;
  readonly onOpen: (url: string) => void;
}) {
  const sourceUrl = event.source?.url ?? null;
  return (
    <div className="relative mb-5 pl-12 [contain-intrinsic-block-size:48px] [content-visibility:auto]">
      <TimelineMarker>
        <span className="flex size-7 items-center justify-center bg-background text-muted-foreground">
          <EventIcon event={event} />
        </span>
      </TimelineMarker>
      <div className="flex min-w-0 items-start gap-2 py-1.5 text-xs">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {event.actor ? (
            <>
              <SourceControlActorAvatar
                actor={event.actor}
                className="size-4 text-[7px] font-semibold"
              />
              <span className="font-semibold text-foreground">{event.actor.login}</span>
            </>
          ) : null}
          <span className="text-foreground">{issueTimelineEventLabel(event)}</span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTimeLabel(event.createdAt)}
          </span>
        </div>
        {sourceUrl !== null ? (
          <Button
            aria-label="Open referenced issue on GitHub"
            className="-mr-1 -mt-1 shrink-0"
            size="icon-xs"
            variant="ghost-muted"
            onClick={() => onOpen(sourceUrl)}
          >
            <ExternalLinkIcon aria-hidden className="size-3" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function IssueTimeline({
  activity,
  environmentId,
  order,
  onOpen,
}: {
  readonly activity: IssueActivity;
  readonly environmentId: EnvironmentId;
  readonly order: "newest" | "oldest";
  readonly onOpen: (url: string) => void;
}) {
  const timeline = useMemo(() => buildIssueTimeline(activity), [activity]);
  const items = useMemo(
    () => (order === "newest" ? timeline.toReversed() : timeline),
    [order, timeline],
  );
  return (
    <section aria-label="Issue timeline" className="mx-auto w-full max-w-3xl py-6">
      {items.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="relative">
          <span aria-hidden className="absolute bottom-5 left-[15px] top-1 w-px bg-border/45" />
          {items.map((item) =>
            item.type === "event" ? (
              <EventItem key={`event:${item.id}`} event={item} onOpen={onOpen} />
            ) : (
              <ConversationItem
                key={`comment:${item.id}`}
                item={item}
                environmentId={environmentId}
                onOpen={onOpen}
              />
            ),
          )}
        </div>
      )}
      {activity.truncated ? (
        <div className="ml-12 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Older activity is still available on GitHub.
        </div>
      ) : null}
    </section>
  );
}
