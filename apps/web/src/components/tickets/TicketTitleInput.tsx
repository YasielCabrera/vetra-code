import type { Ref } from "react";
import { flushSync } from "react-dom";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          readOnly ? (
            <h1 className="min-w-0 truncate text-sm font-medium text-foreground">{title.saved}</h1>
          ) : (
            <textarea
              ref={ref}
              value={title.value}
              aria-label={label}
              rows={1}
              wrap="off"
              maxLength={500}
              disabled={disabled}
              onChange={(event) => title.change(event.target.value)}
              onBlur={(event) => {
                event.currentTarget.scrollLeft = 0;
                void title.commit();
              }}
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
              className="h-7 min-w-0 w-full resize-none truncate rounded-sm bg-transparent text-sm leading-7 font-medium text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )
        }
      />
      <TooltipPopup>{readOnly ? title.saved : title.value}</TooltipPopup>
    </Tooltip>
  );
}
