import { ChartNoAxesColumnIncreasingIcon } from "lucide-react";
import { useRef, useState, type FocusEvent } from "react";

import { cn } from "~/lib/utils";
import { projectIconColorClassName } from "~/projectIconColors";
import { TicketStatusIcon } from "../tickets/ticketPresentation";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { summarizeThreadTicketStatuses } from "./ThreadTicketStatusSummary.logic";

export function ThreadTicketStatusSummary({
  tickets,
  statuses,
}: Parameters<typeof summarizeThreadTicketStatuses>[0]) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const rows = summarizeThreadTicketStatuses({ tickets, statuses });
  const largestCount = rows.reduce((largest, row) => Math.max(largest, row.count), 0);
  const handleTriggerFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (event.relatedTarget instanceof Node && popupRef.current?.contains(event.relatedTarget)) {
      return;
    }
    if (event.currentTarget.matches(":focus-visible")) setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={150}
        render={
          <ThreadDetailsControl
            ref={triggerRef}
            part="icon"
            tone="muted"
            aria-label="Show ticket status counts"
            onFocus={handleTriggerFocus}
          />
        }
      >
        <ChartNoAxesColumnIncreasingIcon aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup
        ref={popupRef}
        width="sm"
        padding="none"
        side="bottom"
        align="end"
        initialFocus={false}
        finalFocus={false}
        onKeyDown={(event) => {
          if (event.key === "Escape") triggerRef.current?.focus();
        }}
        aria-label="Ticket status counts"
      >
        <div className="min-w-0 bg-popover p-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold">Ticket statuses</h4>
            <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
              {tickets.length.toLocaleString()} total
            </span>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">Linked to this thread</p>
          <div aria-hidden className="mt-4 mb-3 flex h-2 overflow-hidden rounded-sm bg-muted">
            {rows.map((row) => (
              <span
                key={row.status ? `known:${row.status.id}` : "unknown"}
                className={cn(
                  "min-w-0 basis-0 bg-current",
                  projectIconColorClassName(row.status?.color ?? "gray"),
                )}
                style={{ flexGrow: row.count }}
              />
            ))}
          </div>
          <dl className="grid gap-1">
            {rows.map((row) => (
              <div
                key={row.status ? `known:${row.status.id}` : "unknown"}
                className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
              >
                <dt className="flex min-w-0 items-center gap-2">
                  <TicketStatusIcon
                    color={row.status?.color ?? "gray"}
                    category={row.status?.category ?? "open"}
                  />
                  <span className="min-w-0 wrap-anywhere">{row.status?.name ?? "No status"}</span>
                </dt>
                <dd className="flex shrink-0 items-center gap-3">
                  <span aria-hidden className="h-0.75 w-10 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full bg-current",
                        projectIconColorClassName(row.status?.color ?? "gray"),
                      )}
                      style={{
                        width: `${largestCount === 0 ? 0 : (row.count / largestCount) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="min-w-[2ch] text-right font-mono tabular-nums">
                    {row.count.toLocaleString()}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
