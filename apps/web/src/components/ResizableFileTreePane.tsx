import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { fileTreePaneResizeEdge, resolveFileTreePaneMaxWidth } from "./fileTreePaneWidth";

interface ResizableFileTreePaneProps {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxFraction: number;
  readonly side: "left" | "right";
  /** When true the tree fills the row (no file open) and is not resizable. */
  readonly fill?: boolean;
  readonly label?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function ResizableFileTreePane({
  storageKey,
  defaultWidth,
  minWidth,
  maxFraction,
  side,
  fill = false,
  label = "Resize file tree",
  className,
  children,
}: ResizableFileTreePaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const edge = fileTreePaneResizeEdge(side);
  const { width, handlers } = useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth: resolveFileTreePaneMaxWidth(containerWidth, maxFraction, minWidth),
    edge,
  });

  useLayoutEffect(() => {
    const parent = paneRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth == null || frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setContainerWidth(nextWidth);
      });
    });
    observer.observe(parent);
    setContainerWidth(parent.getBoundingClientRect().width);

    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <aside
      ref={paneRef}
      data-file-tree-pane={side}
      className={cn(
        "relative flex min-h-0 bg-background",
        fill ? "min-w-0 flex-1" : "shrink-0",
        className,
      )}
      style={
        fill
          ? undefined
          : {
              width: `${width}px`,
              minWidth: `${minWidth}px`,
              maxWidth: `${maxFraction * 100}%`,
            }
      }
    >
      {fill ? null : <RightPanelResizeHandle edge={edge} handlers={handlers} label={label} />}
      {children}
    </aside>
  );
}
