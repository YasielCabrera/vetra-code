import { FileDiffIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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

  const chip = (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums"
      aria-label={accessibleLabel}
    >
      <FileDiffIcon aria-hidden="true" className="size-3.5" />
      {fileLabel}
    </span>
  );

  // Only a truncated preview needs explaining; an exact count already reads as one.
  if (!truncated) return chip;

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup>{accessibleLabel}</TooltipPopup>
    </Tooltip>
  );
}
