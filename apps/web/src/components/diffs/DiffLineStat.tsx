import { cn } from "~/lib/utils";

/** Added and removed lines, coloured and formatted consistently across diff surfaces. */
export function DiffLineStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  if (additions === 0 && deletions === 0) return null;

  return (
    <span className={cn("inline-flex items-baseline gap-1 tabular-nums", className)}>
      <span className="text-emerald-600 dark:text-emerald-300/90">
        +{additions.toLocaleString()}
      </span>
      <span className="text-destructive">-{deletions.toLocaleString()}</span>
    </span>
  );
}
