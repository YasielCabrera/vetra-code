import { ChevronRightIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * Sections share header and content insets in both the sidebar and popover.
 * Passing `expanded` makes the heading a toggle that hides the content.
 */
export function ThreadDetailsSection({
  headingId,
  title,
  actions,
  separated = true,
  showHeading = true,
  expanded,
  onExpandedChange,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style" | "title" | "aria-labelledby"> & {
  headingId: string;
  title: string;
  actions?: ReactNode;
  separated?: boolean;
  showHeading?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const collapsed = expanded === false;
  return (
    <section
      {...props}
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : title}
      className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}
    >
      <div
        className={cn(
          "flex min-h-8 min-w-0 items-center justify-between gap-2 px-1.5",
          !collapsed && "mb-1",
          !showHeading && "hidden",
        )}
      >
        <h3
          id={headingId}
          className={cn(
            "min-w-0 truncate text-2xs font-medium text-muted-foreground select-none",
            expanded !== undefined && "flex-1",
          )}
        >
          {expanded === undefined ? (
            title
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => onExpandedChange?.(!expanded)}
              className="flex min-h-8 w-full cursor-pointer items-center gap-1 rounded-md text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {title}
              <ChevronRightIcon
                aria-hidden
                className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
              />
            </button>
          )}
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {collapsed ? null : children}
    </section>
  );
}
