/**
 * What the issue list shows when it has no rows to show.
 *
 * The drawing is the page's own subject rather than a stock empty box: the issue glyph at the
 * weight of the icons beside it, its ring left unclosed when nothing was found. The states that
 * are showing a host's answer offer to ask for it again; the two that are not — a search still
 * in flight, and a workspace with no project to read from — leave the button out, since pressing
 * it could only repeat what is already happening or ask nobody.
 */
import { PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { IssueListGhost } from "./IssueGhosts";

function IssueMark({ found }: { found: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 72"
      className="h-20 w-32 text-muted-foreground/60"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* The thread of issues the list is drawn from, always whole. */}
      <path d="M10 36h22" className="text-muted-foreground/30" stroke="currentColor" />
      <path d="M88 36h22" className="text-muted-foreground/30" stroke="currentColor" />
      {found ? (
        <circle cx="60" cy="36" r="20" />
      ) : (
        <>
          {/* The same ring, left open. What is missing is the issue, so that is what the
              drawing withholds. */}
          <path d="M60 16a20 20 0 0 1 17.3 30" />
          <path
            d="M60 56a20 20 0 0 1-17.3-30"
            strokeDasharray="2 7"
            className="text-muted-foreground/50"
          />
        </>
      )}
      <circle
        cx="60"
        cy="36"
        r={found ? 6 : 5}
        fill={found ? "currentColor" : "none"}
        fillOpacity={0.25}
        className={found ? undefined : "text-muted-foreground/45"}
      />
    </svg>
  );
}

export function IssueListEmptyState({
  query,
  filtered,
  searching,
  hasProjects,
  refreshing,
  onClearQuery,
  onRefresh,
}: {
  /** The text being searched for, so the reader is told what was searched rather than guessing. */
  query: string;
  /** True when a state, assignee, host, server or project filter is narrowing the list. */
  filtered: boolean;
  /** A search is in flight; the rows on screen are the previous answer. */
  searching: boolean;
  /**
   * Whether this workspace holds a project at all. The list is assembled from the projects'
   * remotes, so without one there is no host to ask and no filter or search that could help.
   */
  hasProjects: boolean;
  /** A re-read of the hosts is already running, from here or from the header. */
  refreshing: boolean;
  onClearQuery: () => void;
  onRefresh: () => void;
}) {
  // Ahead of the search and the filters, because neither can produce a row until a project does.
  if (!hasProjects) {
    return (
      <Empty className="py-16">
        <IssueMark found={false} />
        <EmptyHeader>
          <EmptyTitle>No projects in this workspace</EmptyTitle>
          <EmptyDescription>
            Add a project, and the issues from its repository appear here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
            <PlusIcon className="size-3.5" />
            Add project
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (searching) {
    // The same ghost the first load wears, so a search on its way and a list on its way are one
    // state to the eye — with the question named where the group headers usually speak.
    return (
      <IssueListGhost
        rows={5}
        caption={`Searching every host for “${query.length > 48 ? `${query.slice(0, 48)}…` : query}”`}
      />
    );
  }

  if (query.length > 0) {
    return (
      <Empty className="py-16">
        <IssueMark found={false} />
        <EmptyHeader>
          {/* A pasted paragraph is still a search, but it is not a title. */}
          <EmptyTitle>
            Nothing matches “{query.length > 48 ? `${query.slice(0, 48)}…` : query}”
          </EmptyTitle>
          <EmptyDescription>
            The hosts were searched for it. Try fewer words, or search by number, author or label.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onClearQuery}>
            <SearchIcon className="size-3.5" />
            Clear search
          </Button>
          {/* The hosts answered this query once; an issue opened since then would answer
              differently, and nothing on screen says which of the two the reader is looking at. */}
          <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
            <RefreshCwIcon className="size-3.5" />
            {refreshing ? "Checking..." : "Check again"}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Empty className="py-16">
      <IssueMark found={false} />
      <EmptyHeader>
        <EmptyTitle>{filtered ? "Nothing under these filters" : "No issues"}</EmptyTitle>
        <EmptyDescription>
          {filtered
            ? "Widen the state, assignee or project filter to see more."
            : "Issues from every project in this workspace appear here."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
          <RefreshCwIcon className="size-3.5" />
          {refreshing ? "Checking..." : "Check again"}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function IssuesUnavailableState({
  title = "Could not load issues",
  error,
  onRetry,
}: {
  title?: string;
  error: string;
  onRetry?: () => void;
}) {
  return (
    <Empty className="px-4 py-16 md:px-4">
      <IssueMark found={false} />
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {/* The caller names the fix — update the server, install gh, sign in — so this shows its
            message rather than trying to infer one from the failure text. */}
        <EmptyDescription>{error}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCwIcon className="size-3.5" />
            Retry
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
