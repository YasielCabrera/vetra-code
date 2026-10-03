import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronRight, HardDrive, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { powerhouseEnvironment } from "~/state/powerhouse";

import { documentDisplayName } from "../PowerhousePanel.logic";
import {
  POWERHOUSE_ROW_BUTTON_CLASS,
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
  PowerhousePanelState,
} from "../PowerhousePanelPrimitives";
import { powerhouseReactorMention, powerhouseRowDragProps } from "../powerhouseDragMention";
import { useReactorQuery } from "../powerhouseQuery";
import type { PowerhouseExplorerCrumb } from "../powerhousePanelStore";
import { filterDocumentsByTextSearch } from "./documentFilters";

interface DriveListProps {
  environmentId: EnvironmentId;
  url: string;
  query: string;
  onSelectDrive: (drive: PowerhouseExplorerCrumb) => void;
}

export function DriveList({ environmentId, url, query, onSelectDrive }: DriveListProps) {
  const request = useReactorQuery(
    powerhouseEnvironment.reactorDrives({ environmentId, input: { url } }),
  );

  if (request.data === null && request.isPending) {
    return <PowerhousePanelLoading label="Loading reactor drives…" />;
  }

  if (request.data === null) {
    return (
      <PowerhousePanelState
        title="Drives could not be loaded"
        description={request.error?.message ?? request.otherError ?? "Failed to list drives."}
        tone="error"
        action={{ label: "Try again", onClick: request.refresh }}
      />
    );
  }

  const { drives, truncated } = request.data;
  const searching = query.trim().length > 0;
  const visibleDrives = filterDocumentsByTextSearch(drives, query);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-4 @[32rem]:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">Reactor drives</h2>
            <p className="text-3xs text-muted-foreground">
              {searching
                ? `${visibleDrives.length} of ${drives.length} drives match`
                : `${drives.length} drive${drives.length === 1 ? "" : "s"} available`}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Reload drives"
            aria-label="Reload reactor drives"
            onClick={request.refresh}
          >
            <RefreshCw aria-hidden />
          </Button>
        </div>
        {request.isFailure ? (
          <PowerhouseInlineNotice tone="error">
            Refresh failed. Showing the most recent drives.{" "}
            {request.error?.message ?? request.otherError}
          </PowerhouseInlineNotice>
        ) : null}
        {truncated ? (
          <PowerhouseInlineNotice>
            This reactor exposes more than 500 drives. Showing the first 500 returned by the
            reactor.
          </PowerhouseInlineNotice>
        ) : null}
        {drives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No drives are visible. The reactor may be empty or require authentication this panel
              does not send.
            </p>
          </div>
        ) : visibleDrives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">No drives match this search.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-xs/5">
            {visibleDrives.map((drive) => (
              <li
                key={drive.id}
                className="p-1 [contain-intrinsic-block-size:52px] [content-visibility:auto]"
              >
                <button
                  type="button"
                  onClick={() => onSelectDrive({ id: drive.id, name: documentDisplayName(drive) })}
                  aria-label={`Open ${documentDisplayName(drive)}`}
                  className={POWERHOUSE_ROW_BUTTON_CLASS}
                  {...powerhouseRowDragProps(
                    powerhouseReactorMention({
                      kind: "drive",
                      item: drive,
                      crumbNames: [],
                      reactorUrl: url,
                    }),
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground group-hover:text-foreground">
                    <HardDrive aria-hidden className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {documentDisplayName(drive)}
                    </span>
                    <span className="min-w-0 truncate font-mono text-3xs text-muted-foreground">
                      {drive.id}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  );
}
