import type { CSSProperties, ReactNode } from "react";

import { isElectron } from "../../env";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { useViewportWidth } from "../../hooks/useViewportWidth";
import { cn } from "../../lib/utils";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";

const PANEL_MIN_WIDTH = 260;
const PANEL_VIEWPORT_RESERVE = 640;
const SIDE_PANEL_MIN_VIEWPORT = 1024;

export function useSidePanelFits(): boolean {
  return useViewportWidth() >= SIDE_PANEL_MIN_VIEWPORT;
}

export function TicketSidePanelLayout(props: {
  readonly sidePanel: boolean;
  readonly panel: ReactNode;
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly resizeLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
      {props.sidePanel ? (
        <TicketSidePanel
          storageKey={props.storageKey}
          defaultWidth={props.defaultWidth}
          resizeLabel={props.resizeLabel}
        >
          {props.panel}
        </TicketSidePanel>
      ) : null}
    </div>
  );
}

function TicketSidePanel(props: {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly resizeLabel: string;
  readonly children: ReactNode;
}) {
  const viewportWidth = useViewportWidth();
  const { width, handlers } = useResizableWidth({
    storageKey: props.storageKey,
    defaultWidth: props.defaultWidth,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: Math.max(PANEL_MIN_WIDTH, viewportWidth - PANEL_VIEWPORT_RESERVE),
    edge: "left",
  });
  return (
    <aside
      className="relative flex min-h-0 w-(--ticket-panel-width) shrink-0 flex-col border-s border-border/70 bg-muted/10"
      style={{ "--ticket-panel-width": `${width}px` } as CSSProperties}
    >
      <RightPanelResizeHandle handlers={handlers} label={props.resizeLabel} />
      <div
        className={cn("h-[var(--workspace-topbar-height)] shrink-0", isElectron && "drag-region")}
      />
      {props.children}
    </aside>
  );
}
