import { CheckIcon } from "lucide-react";
import { memo, useState } from "react";

import { cn } from "~/lib/utils";
import { taskControlAriaLabel, type TaskControlState } from "~/session-logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const STEP_STATUS_LABEL: Record<TaskControlState["steps"][number]["status"], string> = {
  pending: "pending",
  inProgress: "in progress",
  completed: "completed",
};

function PlanStepStatusMark({ status }: { status: TaskControlState["steps"][number]["status"] }) {
  return (
    <span
      className={cn(
        "w-3 shrink-0 text-center font-mono text-[10px]",
        status === "completed"
          ? "text-success"
          : status === "inProgress"
            ? "text-primary"
            : "text-muted-foreground/40",
      )}
      aria-hidden
    >
      {status === "completed" ? "✓" : status === "inProgress" ? "●" : "○"}
    </span>
  );
}

export const ThreadTasksControl = memo(function ThreadTasksControl({
  state,
}: {
  state: TaskControlState;
}) {
  const [open, setOpen] = useState(false);
  const ariaLabel = taskControlAriaLabel(state);

  return (
    <Popover onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className={cn(
                    "tabular-nums",
                    state.allDone ? "w-7 px-0 sm:w-6" : "min-w-7 px-[calc(--spacing(2)-1px)]",
                  )}
                  aria-label={ariaLabel}
                  data-toolbar-control=""
                  data-thread-tasks-control=""
                />
              }
            />
          }
        >
          {state.allDone ? (
            <CheckIcon aria-hidden className="size-3.5 text-success" />
          ) : (
            <span>
              {state.completed}/{state.total}
            </span>
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">{ariaLabel}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align="end"
        side="bottom"
        sideOffset={6}
        className="min-w-56 max-w-80"
        viewportClassName="px-2 py-2 [--viewport-inline-padding:--spacing(2)]"
      >
        <PopoverTitle className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">
          Tasks
        </PopoverTitle>
        <ul className="space-y-px">
          {state.steps.map((step) => (
            <li
              key={step.step}
              className="flex items-baseline gap-2 rounded-md px-1.5 py-0.5 text-[12px] leading-5"
            >
              <PlanStepStatusMark status={step.status} />
              <span
                className={cn(
                  "min-w-0 break-words",
                  step.status === "completed"
                    ? "text-muted-foreground/55"
                    : step.status === "inProgress"
                      ? "text-foreground/90"
                      : "text-muted-foreground/70",
                )}
              >
                {step.step}
                <span className="sr-only">, {STEP_STATUS_LABEL[step.status]}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverPopup>
    </Popover>
  );
});
