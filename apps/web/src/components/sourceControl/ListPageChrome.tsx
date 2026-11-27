import { SearchIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "../ui/button";

/**
 * The search, folded to an icon until asked for. Opening moves focus into the input — the
 * whole point of pressing it is to type. It stays open while it holds a query, so an active
 * search is never invisible; empty and blurred, it folds back.
 */
export function ExpandableSearch({
  searchInput,
  searchValue,
  open,
  onOpenChange,
  focusToken,
  label,
  onFocusWithin,
}: {
  searchInput: ReactNode;
  searchValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped to pull focus into the input while it is already showing — the Mod+F path. */
  focusToken: number;
  /** Names what is being searched, since the folded control is an icon with no words on it. */
  label: string;
  /**
   * Focus entering and leaving the expanded input. An unmount fires no blur, which is the
   * point: whoever unmounted this can still see the reader was mid-typing and move the
   * focus somewhere that continues the sentence.
   */
  onFocusWithin?: (focused: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector("input")?.focus();
  }, [open]);
  const appliedFocusToken = useRef(focusToken);
  useEffect(() => {
    if (appliedFocusToken.current === focusToken) return;
    appliedFocusToken.current = focusToken;
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [focusToken]);
  if (open || searchValue.length > 0) {
    return (
      <div
        ref={containerRef}
        className="w-56 min-w-24 shrink"
        onFocus={() => {
          onFocusWithin?.(true);
          // Open while focused, so Escape clearing the query does not unmount the field.
          onOpenChange(true);
        }}
        onBlur={() => {
          onFocusWithin?.(false);
          onOpenChange(false);
        }}
      >
        {searchInput}
      </div>
    );
  }
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} onClick={() => onOpenChange(true)}>
      <SearchIcon className="size-4" />
    </Button>
  );
}
