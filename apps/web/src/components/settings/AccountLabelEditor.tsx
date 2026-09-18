/**
 * Click-to-edit account name, shared by the preview wallet chip and Settings.
 *
 * Settings treats the visible name as the rename control: click it, type, Enter
 * or blur commits. The preview popover mounts this already editing, from the
 * account options menu. Empty and Escape restore the previous label.
 */
import { WEB3_ACCOUNT_LABEL_MAX_LENGTH } from "@t3tools/web3/schema";
import { PencilIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { resolveAccountLabelCommit } from "./web3Settings.logic";

export function AccountLabelEditor({
  address,
  label,
  disabled,
  className,
  defaultEditing = false,
  onCommit,
  onEditingEnd,
}: {
  readonly address: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly className?: string;
  readonly defaultEditing?: boolean;
  readonly onCommit: (address: string, nextLabel: string) => void;
  readonly onEditingEnd?: () => void;
}) {
  const [editing, setEditing] = useState(defaultEditing);
  const committedRef = useRef(false);

  const finish = useCallback(() => {
    setEditing(false);
    onEditingEnd?.();
  }, [onEditingEnd]);

  const commit = useCallback(
    (value: string) => {
      const resolution = resolveAccountLabelCommit({ label: value, originalLabel: label });
      if (resolution.action === "commit") onCommit(address, resolution.label);
      finish();
    },
    [address, finish, label, onCommit],
  );

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Account name"
        maxLength={WEB3_ACCOUNT_LABEL_MAX_LENGTH}
        defaultValue={label}
        className={cn(
          "min-w-0 max-w-[14rem] rounded-sm bg-transparent px-1 outline-none ring-1 ring-ring/50 focus:ring-ring",
          className,
        )}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          if (committedRef.current) return;
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            committedRef.current = true;
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            committedRef.current = true;
            finish();
          }
        }}
      />
    );
  }

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Rename ${label}`}
      className={cn(
        "group inline-flex min-w-0 max-w-[14rem] items-center gap-1 rounded-sm px-1 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-64",
        className,
      )}
      onClick={() => {
        committedRef.current = false;
        setEditing(true);
      }}
    >
      <span className="truncate">{label}</span>
      <PencilIcon
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
        aria-hidden
      />
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipPopup>Rename account</TooltipPopup>
    </Tooltip>
  );
}
