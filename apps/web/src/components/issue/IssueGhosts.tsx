/**
 * Loading states for the issue surface, drawn in the geometry of the content they stand for.
 *
 * The same technique the pull-request ghosts use: one `animate-ghost-pulse` on the container is
 * a single opacity animation however many bars sit under it, and the bars take their tone from
 * `muted-foreground` at low alpha, which reads on both themes.
 */
import { cn } from "~/lib/utils";

function GhostBar({ className }: { className?: string | undefined }) {
  return <div aria-hidden className={cn("h-3 rounded bg-muted-foreground/15", className)} />;
}

/** Widths cycle rather than randomize, so the ghost renders the same on every pass. */
const TITLE_WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-2/5", "w-3/5", "w-1/2"];
const META_WIDTHS = ["w-2/5", "w-1/3", "w-2/5", "w-1/4", "w-1/3", "w-2/5", "w-1/3"];

/** Rows in the list's own grid — glyph, title over meta, comment count. */
export function IssueListGhost({
  rows = 7,
  caption,
}: {
  rows?: number;
  /** Said where the group headers speak, for the states with something to say — a search. */
  caption?: string;
}) {
  return (
    <div
      role="status"
      aria-label={caption ?? "Loading issues"}
      className="animate-ghost-pulse space-y-0.5"
    >
      {caption ? (
        <p className="px-3 pb-1 text-xs font-medium text-muted-foreground/70">{caption}</p>
      ) : null}
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2"
        >
          <GhostBar className="size-4 rounded-full" />
          <div className="min-w-0 space-y-1.5">
            <GhostBar className={cn("h-3.5", TITLE_WIDTHS[index % TITLE_WIDTHS.length])} />
            <GhostBar className={META_WIDTHS[index % META_WIDTHS.length]} />
          </div>
          <GhostBar className="w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * The detail panel's shape while it reads. Keeping the chrome, the summary facts and the
 * description boundary in the ghost stops the loaded issue replacing one layout with another.
 */
export function IssueDetailGhost() {
  return (
    <div
      role="status"
      aria-label="Loading issue"
      className="animate-ghost-pulse flex h-full min-h-0 flex-col overflow-hidden bg-background"
    >
      <div className="shrink-0 border-b border-border/60">
        <div className="flex h-7 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <GhostBar className="w-32" />
            <GhostBar className="w-9" />
          </div>
          <GhostBar className="size-5 shrink-0 rounded-md" />
        </div>

        <div className="px-4 pt-1 pb-4">
          <GhostBar className="h-5 w-4/5 max-w-md" />
          <div className="mt-2 flex items-center gap-1.5">
            <GhostBar className="size-4 rounded-full" />
            <GhostBar className="w-24" />
          </div>
        </div>

        <div className="flex min-h-10 items-center gap-1 border-t border-border/60 px-4 py-2">
          <GhostBar className="h-6 w-16 rounded-md" />
          <GhostBar className="h-6 w-16 rounded-md" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <section className="px-4 py-3">
          {["w-16", "w-10", "w-14", "w-20", "w-12"].map((width, index) => (
            <div
              key={width}
              className="grid min-h-8 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2"
            >
              <div className="flex items-center gap-1.5">
                <GhostBar className="size-3.5 rounded-full" />
                <GhostBar className={width} />
              </div>
              <GhostBar className={META_WIDTHS[index % META_WIDTHS.length]} />
            </div>
          ))}
        </section>

        <section className="border-t border-border/60">
          <div className="flex min-h-11 items-center gap-1.5 px-4 py-3">
            <GhostBar className="h-4 w-24" />
            <GhostBar className="size-3.5 rounded-full" />
          </div>
          <div className="space-y-2 px-4 pb-4">
            <GhostBar className="w-full" />
            <GhostBar className="w-11/12" />
            <GhostBar className="w-4/5" />
            <GhostBar className="w-2/3" />
          </div>
        </section>
      </div>
    </div>
  );
}

/** The timeline's own shape: dots on the rail, a line and a date to each. */
export function IssueTimelineGhost({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading issue timeline"
      className="animate-ghost-pulse px-4 py-5"
    >
      <div className="relative ml-2 border-l border-border/70 pl-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="relative pb-5">
            <GhostBar className="absolute -left-[1.55rem] top-1 size-2 rounded-full" />
            <GhostBar className={cn("h-3.5", TITLE_WIDTHS[index % TITLE_WIDTHS.length])} />
            <GhostBar className="mt-1.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
