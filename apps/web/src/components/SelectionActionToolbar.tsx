import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "./ui/button";

export interface SelectionAction {
  readonly label: string;
  readonly ariaLabel: string;
  readonly icon: LucideIcon;
  readonly disabled?: boolean;
  /** True once it took the selection, which then clears and hides the toolbar. */
  readonly run: () => boolean;
}

/**
 * Floating buttons over a text selection inside `viewport`, which scrolling dismisses. `capture`
 * reads the selection into what `actions` act on, or null to show none. Tab from the selection
 * moves to the first enabled button, and Escape dismisses them.
 */
export function SelectionActionToolbar<Captured extends { readonly range: Range }>({
  viewport,
  capture,
  actions,
}: {
  readonly viewport: HTMLElement | null;
  /** Keep it stable: a new one observes the viewport again. */
  readonly capture: (selection: Selection | null, viewport: HTMLElement) => Captured | null;
  readonly actions: (captured: Captured) => ReadonlyArray<SelectionAction>;
}) {
  const [selection, setSelection] = useState<{
    captured: Captured;
    position: SelectionActionPoint;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const captured = capture(window.getSelection(), viewport);
      if (!captured) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom || rect.width === 0) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      setSelection({
        captured,
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const observer = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    observerRef.current = observer;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      const firstAction = toolbar.querySelector<HTMLButtonElement>("button:enabled");
      if (!firstAction) return;
      event.preventDefault();
      event.stopPropagation();
      firstAction.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", observer.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", observer.selectionChanged);
      observer.dispose();
      observerRef.current = null;
    };
  }, [capture, viewport]);

  if (!selection) return null;
  const dismiss = () => {
    observerRef.current?.cancel();
    setSelection(null);
  };
  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] gap-1"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      {actions(selection.captured).map((action) => (
        <Button
          key={action.label}
          type="button"
          size="xs"
          variant="glass"
          disabled={action.disabled}
          aria-label={action.ariaLabel}
          onClick={() => {
            if (!action.run()) return;
            window.getSelection()?.removeAllRanges();
            dismiss();
          }}
        >
          <action.icon aria-hidden className="size-3.5" />
          {action.label}
        </Button>
      ))}
    </div>,
    document.body,
  );
}
