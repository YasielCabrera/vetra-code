import type {
  EnvironmentId,
  PowerhouseReactorDocumentViewFilter,
  PowerhouseReactorOperation,
} from "@t3tools/contracts";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { powerhouseEnvironment } from "~/state/powerhouse";

import { describeLoadedCount, formatOperationTimestamp } from "../PowerhousePanel.logic";
import { PowerhouseDisclosure, PowerhouseInlineNotice } from "../PowerhousePanelPrimitives";
import {
  cursorPageKey,
  useCursorPages,
  useListEndAutoLoad,
  usePageStatus,
  useReactorQuery,
  type PageStatus,
} from "../powerhouseQuery";
import { SdlBlock } from "../SdlBlock";

const PAGE_LIMIT = 50;

interface OperationPageFetcherProps {
  environmentId: EnvironmentId;
  url: string;
  documentId: string;
  view: PowerhouseReactorDocumentViewFilter | undefined;
  cursor: string | null;
  refreshOnMount: boolean;
  onPage: (
    cursor: string | null,
    page: {
      readonly items: ReadonlyArray<PowerhouseReactorOperation>;
      readonly nextCursor: string | null;
    },
  ) => void;
  onStatus: (cursor: string | null, status: PageStatus) => void;
}

function OperationPageFetcher({
  environmentId,
  url,
  documentId,
  view,
  cursor,
  refreshOnMount,
  onPage,
  onStatus,
}: OperationPageFetcherProps) {
  const query = useReactorQuery(
    powerhouseEnvironment.reactorOperations({
      environmentId,
      input: {
        url,
        documentId,
        ...(view === undefined ? {} : { view }),
        limit: PAGE_LIMIT,
        ...(cursor === null ? {} : { cursor }),
      },
    }),
  );
  const data = query.data;
  const errorMessage = query.error?.message ?? query.otherError;
  const isPending = query.isPending;
  const refreshed = useRef(false);

  useEffect(() => {
    if (!refreshOnMount || refreshed.current) return;
    refreshed.current = true;
    query.refresh();
  }, [query.refresh, refreshOnMount]);

  useEffect(() => {
    if (data === null) return;
    onPage(cursor, { items: data.operations, nextCursor: data.nextCursor });
  }, [cursor, data, onPage]);

  useEffect(() => {
    onStatus(cursor, { pending: isPending, error: errorMessage });
  }, [cursor, errorMessage, isPending, onStatus]);

  return null;
}

function OperationRow({ operation }: { operation: PowerhouseReactorOperation }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const hasInput = operation.actionInput !== null && operation.actionInput !== undefined;
  const failed = operation.error !== null;
  const metadata = [formatOperationTimestamp(operation.timestampUtcMs), operation.signer]
    .filter((entry) => entry !== null && entry.length > 0)
    .join(" · ");

  return (
    <li className="p-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((previous) => !previous)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {expanded ? (
          <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="w-10 shrink-0 text-right font-mono text-3xs text-muted-foreground">
          {operation.index}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={cn(
                "min-w-0 truncate font-mono text-2xs",
                failed ? "text-destructive" : undefined,
              )}
            >
              {operation.actionType ?? "—"}
            </span>
            {operation.scope === null ? null : (
              <span className="shrink-0 text-3xs text-muted-foreground">{operation.scope}</span>
            )}
          </span>
          {metadata.length === 0 ? null : (
            <span className="min-w-0 truncate text-3xs text-muted-foreground">{metadata}</span>
          )}
        </span>
      </button>
      {expanded ? (
        <div id={contentId} className="flex flex-col gap-2 px-3 pb-3 pl-17">
          {operation.error === null ? null : (
            <p className="text-2xs text-destructive">Error: {operation.error}</p>
          )}
          {operation.hash === null ? null : (
            <span className="font-mono text-3xs break-all text-muted-foreground">
              {operation.hash}
            </span>
          )}
          {operation.actionInputTruncated ? (
            <p className="text-2xs text-muted-foreground">
              Input omitted because it is too large to display safely.
            </p>
          ) : hasInput ? (
            <SdlBlock code={JSON.stringify(operation.actionInput, null, 2)} language="json" />
          ) : (
            <span className="text-2xs text-muted-foreground">No input.</span>
          )}
        </div>
      ) : null}
    </li>
  );
}

interface OperationsListProps {
  environmentId: EnvironmentId;
  url: string;
  documentId: string;
  view: PowerhouseReactorDocumentViewFilter | undefined;
}

/** The document's operation log — the event-sourced history behind its state. */
export function OperationsList({ environmentId, url, documentId, view }: OperationsListProps) {
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const identify = useCallback(
    (item: PowerhouseReactorOperation) => `${item.index}:${item.hash ?? ""}`,
    [],
  );
  const {
    cursors,
    items,
    lastCursor,
    nextCursor,
    reportPage,
    loadMore,
    reset: resetPages,
  } = useCursorPages(identify);
  const [status, reportStatus, resetStatus] = usePageStatus(lastCursor);
  const loadingMore = cursors.length > 1 && status.pending;
  const listEndRef = useListEndAutoLoad({ nextCursor, status, loadMore });
  const refresh = () => {
    resetPages();
    resetStatus();
    setRefreshGeneration((previous) => previous + 1);
  };

  return (
    <>
      {cursors.map((cursor) => (
        <OperationPageFetcher
          key={`${refreshGeneration}:${cursorPageKey(cursor)}`}
          environmentId={environmentId}
          url={url}
          documentId={documentId}
          view={view}
          cursor={cursor}
          refreshOnMount={refreshGeneration > 0 && cursor === null}
          onPage={reportPage}
          onStatus={reportStatus}
        />
      ))}
      <PowerhouseDisclosure
        title="Operations"
        defaultOpen={false}
        action={
          <Button
            size="icon-xs"
            variant="ghost"
            title="Reload operations"
            aria-label="Reload operations"
            disabled={status.pending}
            onClick={refresh}
          >
            <RefreshCw aria-hidden />
          </Button>
        }
      >
        <div className="flex flex-col">
          {items.length === 0 && status.pending ? (
            <div
              className="flex flex-col gap-2 py-1"
              role="status"
              aria-label="Loading operations…"
            >
              <span className="sr-only">Loading operations…</span>
              <Skeleton shape="card" className="h-10 w-full" />
              <Skeleton shape="card" className="h-10 w-full" />
            </div>
          ) : null}
          {items.length === 0 && !status.pending && status.error === null ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No operations recorded.</p>
          ) : null}
          <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 empty:hidden">
            {items.map((operation) => (
              <OperationRow key={identify(operation)} operation={operation} />
            ))}
          </ul>
          {/* Reaching this pulls the next page, so the log keeps going by itself. */}
          <div ref={listEndRef} aria-hidden className="h-px" />
          {status.error !== null ? (
            <div className="mt-2">
              <PowerhouseInlineNotice tone="error">{status.error}</PowerhouseInlineNotice>
            </div>
          ) : null}
          {items.length > 0 ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-3xs text-muted-foreground">
                {describeLoadedCount(items.length, "operation")}
              </span>
              {loadingMore ? (
                <span role="status" className="text-3xs text-muted-foreground">
                  Loading more…
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </PowerhouseDisclosure>
    </>
  );
}
