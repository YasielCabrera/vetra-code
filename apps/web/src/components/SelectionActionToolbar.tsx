import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  isSelectionRectVisible,
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
 * Floating buttons over a text selection inside `viewport`; scrolling hides them until it settles.
 * `capture` reads the selection into what `actions` act on, or null to show none. Tab from the
 * selection moves to the first enabled button, and Escape dismisses them.
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
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        captured,
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const observer = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
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
