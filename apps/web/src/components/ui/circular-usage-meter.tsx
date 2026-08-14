import type { ComponentPropsWithRef } from "react";

import { cn } from "~/lib/utils";

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface CircularUsageMeterButtonProps extends Omit<
  ComponentPropsWithRef<"button">,
  "children" | "value"
> {
  readonly value: number | null;
  readonly indicatorColor: string;
  readonly "aria-label": string;
}

export function CircularUsageMeterButton({
  value,
  indicatorColor,
  className,
  type = "button",
  ...buttonProps
}: CircularUsageMeterButtonProps) {
  const normalizedValue =
    value !== null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const dashOffset =
    normalizedValue === null ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - normalizedValue / 100);

  return (
    <button
      {...buttonProps}
      type={type}
      className={cn(
        "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted-foreground outline-none transition-colors",
        "hover:bg-accent data-[pressed]:bg-accent",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
      data-usage-meter-state={normalizedValue === null ? "neutral" : "value"}
      data-usage-meter-value={normalizedValue ?? undefined}
    >
      <span className="relative flex size-5 items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="-rotate-90 absolute inset-0 size-full transform-gpu"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            stroke={
              normalizedValue === null
                ? "color-mix(in oklab, var(--color-muted-foreground) 42%, transparent)"
                : "color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
            }
            strokeWidth="3"
            strokeLinecap={normalizedValue === null ? "round" : undefined}
            strokeDasharray={normalizedValue === null ? "1.5 4" : undefined}
          />
          {normalizedValue !== null ? (
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke={indicatorColor}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
            />
          ) : null}
        </svg>
      </span>
    </button>
  );
}
