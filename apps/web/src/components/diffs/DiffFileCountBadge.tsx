import { Badge } from "../ui/badge";

export function DiffFileCountBadge(props: { count: number; truncated: boolean }) {
  const { count, truncated } = props;
  if (count <= 0) return null;

  const fileLabel = truncated ? `${count}+ files` : `${count} file${count === 1 ? "" : "s"}`;
  const accessibleLabel = truncated
    ? `At least ${count} changed files; diff preview is truncated`
    : `${count} changed file${count === 1 ? "" : "s"}`;

  return (
    <Badge
      variant="secondary"
      size="sm"
      className="leading-none"
      aria-label={accessibleLabel}
      title={truncated ? accessibleLabel : undefined}
    >
      {fileLabel}
    </Badge>
  );
}
