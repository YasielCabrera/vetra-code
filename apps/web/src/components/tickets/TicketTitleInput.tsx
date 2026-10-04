import type { Ref } from "react";
import { flushSync } from "react-dom";

import type { useTitleDraft } from "./useTitleDraft";

export function TicketTitleInput({
  ref,
  title,
  label,
  readOnly,
  disabled,
}: {
  readonly ref?: Ref<HTMLTextAreaElement>;
  readonly title: ReturnType<typeof useTitleDraft>;
  readonly label: string;
  readonly readOnly: boolean;
  readonly disabled?: boolean;
}) {
  if (readOnly) {
    return (
      <h2 className="text-3xl leading-tight font-semibold break-words tracking-tight text-foreground">
        {title.saved}
      </h2>
    );
  }
  return (
    <textarea
      ref={ref}
      value={title.value}
      aria-label={label}
      rows={1}
      maxLength={500}
      disabled={disabled}
      onChange={(event) => title.change(event.target.value)}
      onBlur={() => void title.commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          flushSync(title.cancel);
          event.currentTarget.blur();
        }
      }}
      className="field-sizing-content w-full resize-none overflow-hidden rounded-md bg-transparent text-3xl leading-tight font-semibold tracking-tight text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}
