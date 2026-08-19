import { ChevronDown, ChevronRight, CircleAlert, SearchX } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

export const POWERHOUSE_ROW_BUTTON_CLASS =
  "group flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function PowerhousePanelLoading({ label = "Loading Powerhouse…" }: { label?: string }) {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-3 py-4 @[32rem]:px-5"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="mb-1 flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-7 rounded-md" />
      </div>
      {["w-4/5", "w-2/3", "w-3/4"].map((width) => (
        <div
          key={width}
          className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-3"
        >
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={cn("h-3", width)} />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PowerhousePanelState({
  title,
  description,
  action,
  secondaryAction,
  tone = "neutral",
}: {
  title: string;
  description: string;
  action?: { readonly label: string; readonly onClick: () => void } | undefined;
  secondaryAction?: { readonly label: string; readonly onClick: () => void } | undefined;
  tone?: "neutral" | "error";
}) {
  const Icon = tone === "error" ? CircleAlert : SearchX;
  return (
    <div className="flex h-full items-center justify-center px-4 py-10 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl border",
            tone === "error"
              ? "border-destructive/24 bg-destructive/8 text-destructive"
              : "border-border/70 bg-muted/50 text-muted-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="text-xs leading-relaxed break-words text-muted-foreground">{description}</p>
        </div>
        {action === undefined && secondaryAction === undefined ? null : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {action === undefined ? null : (
              <Button size="sm" variant="outline" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
            {secondaryAction === undefined ? null : (
              <Button size="sm" variant="ghost" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PowerhouseInlineNotice({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "error";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        tone === "error"
          ? "border-destructive/24 bg-destructive/6 text-destructive"
          : "border-warning/24 bg-warning/6 text-warning-foreground",
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export function PowerhouseDisclosure({
  title,
  meta,
  action,
  children,
  defaultOpen = true,
  contentClassName,
}: {
  title: string;
  meta?: string | undefined;
  /** Header control beside the title; kept outside the toggle so it can be a button. */
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  contentClassName?: string | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-xs/5">
      <div className="flex w-full min-w-0 items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((previous) => !previous)}
          className={cn(
            "flex min-w-0 items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            action === undefined ? "w-full" : "flex-1",
          )}
        >
          {open ? (
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
          {meta === undefined ? null : (
            <span className="shrink-0 text-[.65rem] tabular-nums text-muted-foreground">
              {meta}
            </span>
          )}
        </button>
        {action === undefined ? null : <div className="shrink-0 pr-1.5">{action}</div>}
      </div>
      {open ? (
        <div id={contentId} className={cn("border-t border-border/60", contentClassName ?? "p-3")}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
