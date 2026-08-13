import { FileDiffIcon } from "lucide-react";

export function DiffFileCount(props: { count: number; truncated: boolean }) {
  const { count, truncated } = props;
  if (count <= 0) return null;

  const formattedCount = count.toLocaleString();
  const fileLabel = truncated
    ? `${formattedCount}+ files`
    : `${formattedCount} file${count === 1 ? "" : "s"}`;
  const accessibleLabel = truncated
    ? `At least ${formattedCount} changed files; diff preview is truncated`
    : `${formattedCount} changed file${count === 1 ? "" : "s"}`;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums"
      aria-label={accessibleLabel}
      title={truncated ? accessibleLabel : undefined}
    >
      <FileDiffIcon aria-hidden="true" className="size-3.5" />
      {fileLabel}
    </span>
  );
}
