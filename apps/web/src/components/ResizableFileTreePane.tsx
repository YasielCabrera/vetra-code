import { type ReactNode, useState } from "react";

import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { observeResize } from "~/lib/observeResize";
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
  const [containerWidth, setContainerWidth] = useState(0);
  const edge = fileTreePaneResizeEdge(side);
  const maxWidth = resolveFileTreePaneMaxWidth(containerWidth, maxFraction, minWidth);
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    edge,
  });

  return (
    <aside
      ref={(host) => {
        const parent = host?.parentElement;
        if (!parent) return;
        const measure = () => setContainerWidth(parent.getBoundingClientRect().width);
        measure();
        return observeResize(parent, measure);
      }}
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
      {fill ? null : (
        <RightPanelResizeHandle
          edge={edge}
          handlers={handlers}
          label={label}
          tabIndex={0}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            let nextWidth: number;
            switch (event.key) {
              case "ArrowLeft":
                nextWidth = width + (edge === "left" ? 16 : -16);
                break;
              case "ArrowRight":
                nextWidth = width + (edge === "left" ? -16 : 16);
                break;
              case "Home":
                nextWidth = minWidth;
                break;
              case "End":
                nextWidth = maxWidth;
                break;
              default:
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            setWidth(nextWidth);
          }}
        />
      )}
      {children}
    </aside>
  );
}
