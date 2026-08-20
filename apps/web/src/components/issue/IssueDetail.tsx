import type {
  EnvironmentId,
  IssueActivity,
  IssueDetail as IssueDetailValue,
  IssueRef,
} from "@vetra-code/contracts";
import {
  ArrowDownUpIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDotIcon,
  FlagIcon,
  FolderGit2Icon,
  HistoryIcon,
  LinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  TagIcon,
  UserRoundIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";

import ChatMarkdown from "../ChatMarkdown";
import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { normalizeIssueExternalUrl } from "./issueExternalUrl";
import { IssueAssigneePicker } from "./IssueAssigneePicker";
import { IssueConversationCard } from "./IssueConversationCard";
import { IssueHandoffMenuItems } from "./IssueHandoffActions";
import { IssueLabel } from "./IssueLabel";
import { IssueTimeline } from "./IssueTimeline";

type IssueDetailTab = "summary" | "timeline";

const COMMENT_PAGE = 30;

function MetaRow({
  icon,
  label,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
    </div>
  );
}

function IssueSection({
  title,
  count,
  actions,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center border-t border-border/60 bg-background pr-4">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-sm font-medium">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          {count === undefined ? null : (
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          )}
        </CollapsibleTrigger>
        {open ? actions : null}
      </div>
      <CollapsiblePanel>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function IssueTimelineGhost() {
  return (
    <div
      role="status"
      aria-label="Loading issue timeline"
      className="animate-ghost-pulse mx-auto max-w-3xl py-6"
    >
      <div className="relative ml-4 border-l border-border/70 pl-7">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="relative pb-6">
            <span className="absolute -left-[2.05rem] top-0.5 size-2.5 rounded-full bg-muted" />
            <span className="block h-3.5 w-2/3 rounded bg-muted" />
            <span className="mt-2 block h-3 w-20 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function IssueDetail({
  detail,
  environmentId,
  activity,
  activityPending,
  activityError,
  refreshing,
  onBack,
  onRefresh,
  onRetryActivity,
}: {
  readonly detail: IssueDetailValue;
  readonly environmentId: EnvironmentId;
  readonly activity: IssueActivity | null;
  readonly activityPending: boolean;
  readonly activityError: string | null;
  readonly refreshing: boolean;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onRetryActivity: () => void;
}) {
  const [tab, setTab] = useState<IssueDetailTab>("summary");
  const [timelineOrder, setTimelineOrder] = useState<"newest" | "oldest">("newest");
  const [commentOrder, setCommentOrder] = useState<"newest" | "oldest">("newest");
  const [shown, setShown] = useState({ url: detail.url, count: COMMENT_PAGE });
  const reference = useMemo(
    () =>
      ({
        projectId: detail.projectId,
        repository: detail.repository,
        number: detail.number,
      }) satisfies IssueRef,
    [detail.number, detail.projectId, detail.repository],
  );
  const shownComments = shown.url === detail.url ? shown.count : COMMENT_PAGE;
  const recentComments = detail.comments.slice(Math.max(0, detail.comments.length - shownComments));
  const hiddenCommentCount = detail.comments.length - recentComments.length;
  const visibleComments = commentOrder === "newest" ? recentComments.toReversed() : recentComments;
  const StateIcon = detail.state === "open" ? CircleDotIcon : CheckCircle2Icon;
  const { copyToClipboard } = useCopyToClipboard({ target: "issue link" });
  const openExternal = (raw: string) => {
    const url = normalizeIssueExternalUrl(raw);
    if (url !== null)
      void readLocalApi()
        ?.shell.openExternal(url)
        .catch(() => undefined);
  };

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <header className="border-b border-border/60">
        <div className="flex h-11 min-w-0 items-center gap-1 px-4">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Back to all issues"
                  className="-ml-1"
                  size="icon-xs"
                  variant="ghost-muted"
                  onClick={onBack}
                />
              }
            >
              <ArrowLeftIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">All issues</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {detail.repository}
                </span>
              }
            />
            <TooltipPopup side="bottom">{detail.repository}</TooltipPopup>
          </Tooltip>
          <button
            type="button"
            className={cn(
              "shrink-0 text-xs font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              detail.state === "open" ? "text-success" : "text-violet-600 dark:text-violet-300/90",
            )}
            aria-label={`Open issue #${detail.number} on GitHub`}
            onClick={() => openExternal(detail.url)}
          >
            #{detail.number}
          </button>

          <div className="ml-auto flex shrink-0 items-center">
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="More issue actions"
                    className="size-6"
                    size="icon-xs"
                    variant="ghost-muted"
                  />
                }
              >
                <MoreHorizontalIcon className="size-4" />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom" className="min-w-72">
                <MenuItem disabled={refreshing} onClick={onRefresh}>
                  <RefreshCwIcon className="size-3.5" />
                  {refreshing ? "Refreshing..." : "Refresh"}
                </MenuItem>
                <IssueHandoffMenuItems detail={detail} environmentId={environmentId} />
                <MenuSeparator />
                <MenuItem onClick={() => openExternal(detail.url)}>
                  <ArrowUpRightIcon className="size-3.5" />
                  Open on GitHub
                </MenuItem>
                <MenuItem onClick={() => copyToClipboard(detail.url, undefined)}>
                  <LinkIcon className="size-3.5" />
                  Copy link
                </MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => openExternal(detail.newIssueUrl)}>
                  <PlusIcon className="size-3.5" />
                  New issue
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>

        <div className="min-w-0 px-4 pt-3 pb-4">
          <div className="flex min-w-0 items-start gap-2">
            <h1 className="min-w-0 flex-1 text-base leading-snug font-semibold text-foreground">
              {detail.title}
            </h1>
            <Badge
              variant={detail.state === "open" ? "success" : "secondary"}
              className="h-5 shrink-0 gap-1 rounded px-1.5 text-[10px]"
            >
              <StateIcon
                aria-hidden
                className={cn(
                  "size-3",
                  detail.state === "closed" &&
                    "text-violet-600 opacity-100 dark:text-violet-300/90",
                )}
              />
              {detail.state === "open" ? "Open" : "Closed"}
            </Badge>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <SourceControlActorAvatar actor={detail.author} />
            <span className="font-medium text-foreground">
              {detail.author?.login ?? "Unknown author"}
            </span>
            <span>opened {formatRelativeTimeLabel(detail.createdAt)}</span>
          </div>
        </div>

        <nav
          aria-label="Issue tabs"
          className="flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {(["summary", "timeline"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                tab === value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(value)}
            >
              {value === "summary" ? "Summary" : "Timeline"}
            </button>
          ))}
          {tab === "timeline" ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                aria-label={
                  activityError
                    ? "Issue activity unavailable"
                    : activityPending
                      ? "Loading issue activity"
                      : `${activity?.items.length ?? 0} history entries`
                }
              >
                <HistoryIcon aria-hidden className="size-3" />
                {activityError ? "—" : activityPending ? "…" : (activity?.items.length ?? 0)}
              </span>
              <Button
                aria-label={
                  timelineOrder === "newest"
                    ? "Show oldest activity first"
                    : "Show newest activity first"
                }
                className="h-7 px-2 text-[10px] text-muted-foreground"
                size="xs"
                variant="ghost"
                onClick={() =>
                  setTimelineOrder((value) => (value === "newest" ? "oldest" : "newest"))
                }
              >
                <ArrowDownUpIcon aria-hidden className="size-3" />
                {timelineOrder === "newest" ? "Newest first" : "Oldest first"}
              </Button>
            </div>
          ) : null}
        </nav>
      </header>

      {tab === "summary" ? (
        <div>
          <section aria-label="Issue metadata" className="px-4 py-3">
            <MetaRow icon={<UserRoundIcon className="size-3.5" />} label="Assignees">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {detail.assignees.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    {detail.assignees.map((assignee) => (
                      <span key={assignee.login} className="inline-flex items-center gap-1.5">
                        <SourceControlActorAvatar actor={assignee} />
                        <span>{assignee.login}</span>
                      </span>
                    ))}
                  </span>
                )}
                <IssueAssigneePicker
                  environmentId={environmentId}
                  reference={reference}
                  onAssigned={onRefresh}
                />
              </span>
            </MetaRow>
            <MetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
              {detail.labels.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {detail.labels.map((label) => (
                    <IssueLabel key={label.name} label={label} />
                  ))}
                </span>
              )}
            </MetaRow>
            <MetaRow icon={<FlagIcon className="size-3.5" />} label="Milestone">
              <span className={cn(detail.milestone === null && "text-muted-foreground")}>
                {detail.milestone?.title ?? "None"}
              </span>
            </MetaRow>
            <MetaRow icon={<MessageSquareIcon className="size-3.5" />} label="Comments">
              {detail.commentCount === 1 ? "1 comment" : `${detail.commentCount} comments`}
            </MetaRow>
            <MetaRow icon={<FolderGit2Icon className="size-3.5" />} label="Project">
              {detail.projectTitle}
            </MetaRow>
          </section>

          <IssueSection title="Description">
            {detail.body.trim().length > 0 ? (
              <ChatMarkdown className="max-w-none text-sm" cwd={undefined} text={detail.body} />
            ) : (
              <p className="text-xs text-muted-foreground">No description provided.</p>
            )}
          </IssueSection>

          <IssueSection
            title="Comments"
            count={detail.commentCount}
            actions={
              detail.comments.length > 1 ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-[10px] text-muted-foreground"
                  aria-label={
                    commentOrder === "newest"
                      ? "Show oldest comments first"
                      : "Show newest comments first"
                  }
                  onClick={() =>
                    setCommentOrder((value) => (value === "newest" ? "oldest" : "newest"))
                  }
                >
                  <ArrowDownUpIcon aria-hidden className="size-3" />
                  {commentOrder === "newest" ? "Newest first" : "Oldest first"}
                </Button>
              ) : null
            }
          >
            {detail.commentsTruncated ? (
              <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs">
                This conversation is longer than this page reads in one go. Open it on GitHub to
                read the rest.
              </p>
            ) : null}
            {detail.comments.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {hiddenCommentCount > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      setShown({
                        url: detail.url,
                        count: shownComments + COMMENT_PAGE,
                      })
                    }
                  >
                    Show {Math.min(hiddenCommentCount, COMMENT_PAGE)} earlier{" "}
                    {hiddenCommentCount === 1 ? "comment" : "comments"}
                  </Button>
                ) : null}
                {visibleComments.map((comment) => (
                  <IssueConversationCard
                    key={comment.id}
                    action="commented"
                    actor={comment.author}
                    body={comment.body}
                    createdAt={comment.createdAt}
                    url={comment.url}
                    onOpen={openExternal}
                  />
                ))}
              </div>
            )}
          </IssueSection>
        </div>
      ) : activityPending ? (
        <IssueTimelineGhost />
      ) : activityError !== null ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Could not load issue activity</p>
          <p className="max-w-md text-xs text-muted-foreground">{activityError}</p>
          <Button size="sm" variant="outline" onClick={onRetryActivity}>
            <RefreshCwIcon aria-hidden className="size-3.5" />
            Retry
          </Button>
        </div>
      ) : activity !== null ? (
        <IssueTimeline activity={activity} order={timelineOrder} onOpen={openExternal} />
      ) : null}
    </div>
  );
}
