import type * as React from "react";

/**
 * Field-shaped trigger for the explorer's two-line pickers. Render it as the
 * combobox trigger: `<ComboboxTrigger render={<PickerTriggerButton />}>`.
 */
export function PickerTriggerButton(props: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="relative flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 text-left text-sm text-foreground shadow-xs/5 outline-none ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:bg-input/32 dark:aria-invalid:ring-destructive/24"
    />
  );
}
