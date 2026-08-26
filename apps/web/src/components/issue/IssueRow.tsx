import { memo } from "react";
import { CheckCircle2Icon, CircleDotIcon, MessageSquareIcon } from "lucide-react";

import type { EnvironmentIssueEntry } from "~/state/issues";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";

import { PullRequestMetaLine } from "../pullRequest/pullRequestPresentation";
import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { IssueLabel } from "./IssueLabel";

function IssueRowImpl({
  entry,
  selected,
  showEnvironment,
  environmentLabel,
  onSelect,
}: {
  readonly entry: EnvironmentIssueEntry;
  readonly selected: boolean;
  readonly showEnvironment: boolean;
  readonly environmentLabel?: string;
  readonly onSelect: (entry: EnvironmentIssueEntry) => void;
}) {
  const StateIcon = entry.state === "open" ? CircleDotIcon : CheckCircle2Icon;
  const activityTime =
    entry.state === "open" ? entry.createdAt : (entry.closedAt ?? entry.updatedAt);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        // Offscreen rows are skipped for style, layout and paint: a long list costs what the
        // viewport shows, not what the pages have loaded. The intrinsic size keeps the
        // scrollbar honest while a row is skipped.
        "[contain-intrinsic-block-size:54px] [content-visibility:auto]",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
      onClick={() => onSelect(entry)}
    >
      <StateIcon
        aria-label={entry.state === "open" ? "Open issue" : "Closed issue"}
        className={cn(
          "size-4 shrink-0",
          entry.state === "open" ? "text-success" : "text-violet-600 dark:text-violet-300/90",
        )}
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {entry.title}
          </span>
          {entry.labels.slice(0, 3).map((label) => (
            <IssueLabel key={label.name} label={label} />
          ))}
          {entry.labels.length > 3 ? (
            <span className="shrink-0 text-xs text-muted-foreground/70">
              +{entry.labels.length - 3}
            </span>
          ) : null}
        </span>
        <PullRequestMetaLine className="mt-0.5 text-xs text-muted-foreground/70">
          <span className="shrink-0">#{entry.number}</span>
          <span className="truncate">{entry.repository}</span>
          {showEnvironment && environmentLabel ? (
            <span className="max-w-32 shrink-0 truncate">{environmentLabel}</span>
          ) : null}
          <span className="flex min-w-0 max-w-40 shrink-0 items-center gap-1.5">
            <SourceControlActorAvatar actor={entry.author} />
            <span className="truncate">{entry.author?.login ?? "ghost"}</span>
          </span>
          <span className="shrink-0">
            {entry.state === "open" ? "opened" : "closed"} {formatRelativeTimeLabel(activityTime)}
          </span>
        </PullRequestMetaLine>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs tabular-nums text-muted-foreground/70">
        <span>{formatRelativeTimeLabel(entry.updatedAt)}</span>
        {entry.commentCount !== undefined && entry.commentCount > 0 ? (
          <span className="flex items-center gap-1">
            <MessageSquareIcon aria-hidden className="size-3" />
            {entry.commentCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Memoized: the list re-renders on every keystroke of a search, and a row whose entry and
 * selection are unchanged has nothing new to say. Effective because the route hands it a
 * stable `onSelect`.
 */
export const IssueRow = memo(IssueRowImpl);
