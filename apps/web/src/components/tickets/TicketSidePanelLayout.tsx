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
  readonly panelHeader?: ReactNode;
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
          header={props.panelHeader}
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
  readonly header?: ReactNode;
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
      className={cn(
        "relative flex min-h-0 w-(--ticket-panel-width) shrink-0 flex-col border-s border-border/70 bg-muted/10",
        props.header == null && isElectron && "wco:pt-(--workspace-topbar-height)",
      )}
      style={{ "--ticket-panel-width": `${width}px` } as CSSProperties}
    >
      <RightPanelResizeHandle handlers={handlers} label={props.resizeLabel} />
      {props.header == null ? null : (
        <div
          className={cn(
            "flex h-[var(--workspace-topbar-height)] shrink-0 items-center",
            isElectron && "drag-region wco:pr-(--workspace-native-controls-inset)",
          )}
        >
          {props.header}
        </div>
      )}
      {props.children}
    </aside>
  );
}
