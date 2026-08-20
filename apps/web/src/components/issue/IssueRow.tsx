import { memo } from "react";
import { CheckCircle2Icon, CircleDotIcon, MessageSquareIcon } from "lucide-react";

import type { EnvironmentIssueEntry } from "~/state/issues";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";

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
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b border-border/70 px-4 py-3 text-left outline-none transition-colors last:border-b-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        "[contain-intrinsic-block-size:74px] [content-visibility:auto]",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      onClick={() => onSelect(entry)}
    >
      <StateIcon
        aria-label={entry.state === "open" ? "Open issue" : "Closed issue"}
        className={cn(
          "mt-0.5 size-4.5",
          entry.state === "open" ? "text-success" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {entry.title}
          </span>
          {entry.labels.slice(0, 4).map((label) => (
            <IssueLabel key={label.name} label={label} />
          ))}
          {entry.labels.length > 4 ? (
            <span className="text-xs text-muted-foreground">+{entry.labels.length - 4}</span>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>#{entry.number}</span>
          <span>{entry.repository}</span>
          {showEnvironment && environmentLabel ? <span>{environmentLabel}</span> : null}
          <span>
            {entry.state === "open" ? "opened" : "closed"} {formatRelativeTimeLabel(activityTime)}
          </span>
          {entry.author ? <span>by {entry.author.login}</span> : null}
        </span>
      </span>
      <span className="flex min-w-8 items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground">
        {entry.commentCount !== undefined && entry.commentCount > 0 ? (
          <>
            <MessageSquareIcon aria-hidden className="size-3.5" />
            {entry.commentCount}
          </>
        ) : null}
      </span>
    </button>
  );
}

export const IssueRow = memo(IssueRowImpl);
