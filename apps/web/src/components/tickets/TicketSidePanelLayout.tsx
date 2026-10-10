import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { observeResize } from "../../lib/observeResize";
import { useViewportWidth } from "../../hooks/useViewportWidth";
import { cn } from "../../lib/utils";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";

const PANEL_MIN_WIDTH = 260;
const PANEL_VIEWPORT_RESERVE = 640;
const SIDE_PANEL_MIN_VIEWPORT = 1024;

export function useSidePanelFits(presentation: "page" | "panel" = "page") {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  useEffect(() => {
    if (!element || presentation !== "panel") return;
    return observeResize(element, ([entry]) => {
      if (entry) setMeasuredWidth(entry.contentRect.width);
    });
  }, [element, presentation]);
  const viewportWidth = useViewportWidth();
  const width = presentation === "panel" ? (measuredWidth ?? 0) : viewportWidth;
  return { ref, width, sidePanel: width >= SIDE_PANEL_MIN_VIEWPORT };
}

export function TicketSidePanelLayout({
  onContainerElement,
  ...props
}: {
  readonly sidePanel: boolean;
  readonly onContainerElement: (element: HTMLDivElement | null) => void;
  readonly containerWidth: number;
  readonly presentation?: "page" | "panel";
  readonly panel: ReactNode;
  readonly panelHeader?: ReactNode;
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly resizeLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      ref={onContainerElement}
      className="flex min-h-0 min-w-0 flex-1 flex-row bg-background text-foreground"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
      {props.sidePanel ? (
        <TicketSidePanel
          storageKey={props.storageKey}
          defaultWidth={props.defaultWidth}
          resizeLabel={props.resizeLabel}
          header={props.panelHeader}
          containerWidth={props.containerWidth}
          presentation={props.presentation ?? "page"}
        >
          {props.panel}
        </TicketSidePanel>
      ) : null}
    </div>
  );
}

function TicketSidePanel(props: {
  readonly containerWidth: number;
  readonly presentation?: "page" | "panel";
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly resizeLabel: string;
  readonly header?: ReactNode;
  readonly children: ReactNode;
}) {
  const { width, handlers } = useResizableWidth({
    storageKey: props.storageKey,
    defaultWidth: props.defaultWidth,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: Math.max(PANEL_MIN_WIDTH, props.containerWidth - PANEL_VIEWPORT_RESERVE),
    edge: "left",
  });
  return (
    <aside
      className={cn(
        "relative flex min-h-0 w-(--ticket-panel-width) shrink-0 flex-col border-s border-border/70 bg-muted/10",
        props.header == null &&
          isElectron &&
          props.presentation !== "panel" &&
          "wco:pt-(--workspace-topbar-height)",
      )}
      style={{ "--ticket-panel-width": `${width}px` } as CSSProperties}
    >
      <RightPanelResizeHandle handlers={handlers} label={props.resizeLabel} />
      {props.header == null ? null : (
        <div
          className={cn(
            "flex h-[var(--workspace-topbar-height)] shrink-0 items-center",
            isElectron &&
              props.presentation !== "panel" &&
              "drag-region wco:pr-(--workspace-native-controls-inset)",
          )}
        >
          {props.header}
        </div>
      )}
      {props.children}
    </aside>
  );
}
