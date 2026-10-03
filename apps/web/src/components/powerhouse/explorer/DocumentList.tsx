import type {
  EnvironmentId,
  PowerhouseReactorDocumentSearchFilter,
  PowerhouseReactorDocumentSummary,
  PowerhouseReactorDocumentViewFilter,
} from "@t3tools/contracts";
import { ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { powerhouseEnvironment } from "~/state/powerhouse";

import { describeLoadedCount, documentDisplayName } from "../PowerhousePanel.logic";
import {
  POWERHOUSE_ROW_BUTTON_CLASS,
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
} from "../PowerhousePanelPrimitives";
import { powerhouseReactorMention, powerhouseRowDragProps } from "../powerhouseDragMention";
import {
  cursorPageKey,
  useCursorPages,
  useListEndAutoLoad,
  usePageStatus,
  useReactorQuery,
  type PageStatus,
} from "../powerhouseQuery";
import type { PowerhouseExplorerCrumb } from "../powerhousePanelStore";
import { filterDocumentsByTextSearch } from "./documentFilters";

/** Documents that hold other documents; entering one navigates instead of opening it. */
const CONTAINER_TYPES = new Set([
  "powerhouse/document-drive",
  "powerhouse/reactor-drive",
  "powerhouse/folder",
]);

interface DocumentPageFetcherProps {
  environmentId: EnvironmentId;
  url: string;
  search: PowerhouseReactorDocumentSearchFilter;
  view: PowerhouseReactorDocumentViewFilter | undefined;
  cursor: string | null;
  refreshOnMount: boolean;
  onPage: (
    cursor: string | null,
    page: {
      readonly items: ReadonlyArray<PowerhouseReactorDocumentSummary>;
      readonly nextCursor: string | null;
    },
  ) => void;
  onTruncated: (truncated: boolean) => void;
  onStatus: (cursor: string | null, status: PageStatus) => void;
}

/**
 * One page of children. Renders nothing: it exists so each cursor gets its own
 * query atom while the list itself stays a single merged render.
 */
function DocumentPageFetcher({
  environmentId,
  url,
  search,
  view,
  cursor,
  refreshOnMount,
  onPage,
  onTruncated,
  onStatus,
}: DocumentPageFetcherProps) {
  const query = useReactorQuery(
    // No limit: the reactor gives no usable document cursor, so the server's
    // bound is the listing size and guessing a smaller page here would just
    // hide children.
    powerhouseEnvironment.reactorDocuments({
      environmentId,
      input: {
        url,
        search,
        ...(view === undefined ? {} : { view }),
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
    onPage(cursor, { items: data.documents, nextCursor: data.nextCursor });
    onTruncated(data.truncated);
  }, [cursor, data, onPage, onTruncated]);

  useEffect(() => {
    onStatus(cursor, { pending: isPending, error: errorMessage });
  }, [cursor, errorMessage, isPending, onStatus]);

  return null;
}

interface DocumentListProps {
  environmentId: EnvironmentId;
  url: string;
  search: PowerhouseReactorDocumentSearchFilter;
  view: PowerhouseReactorDocumentViewFilter | undefined;
  query: string;
  filtered: boolean;
  /** Drive down to this list, so a dragged row can say where it lives. */
  crumbNames: ReadonlyArray<string>;
  onEnterFolder: ((folder: PowerhouseExplorerCrumb) => void) | undefined;
  onSelectDocument: (documentId: string) => void;
}

export function DocumentList({
  environmentId,
  url,
  search,
  view,
  query,
  filtered,
  crumbNames,
  onEnterFolder,
  onSelectDocument,
}: DocumentListProps) {
  const identify = useCallback((item: PowerhouseReactorDocumentSummary) => item.id, []);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [truncated, setTruncated] = useState(false);
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
  const searchingText = query.trim().length > 0;
  const visibleItems = useMemo(() => filterDocumentsByTextSearch(items, query), [items, query]);
  const refresh = () => {
    resetPages();
    resetStatus();
    setTruncated(false);
    setRefreshGeneration((previous) => previous + 1);
  };

  return (
    <ScrollArea className="h-full">
      {cursors.map((cursor) => (
        <DocumentPageFetcher
          key={`${refreshGeneration}:${cursorPageKey(cursor)}`}
          environmentId={environmentId}
          url={url}
          search={search}
          view={view}
          cursor={cursor}
          refreshOnMount={refreshGeneration > 0 && cursor === null}
          onPage={reportPage}
          onTruncated={setTruncated}
          onStatus={reportStatus}
        />
      ))}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-3 @[32rem]:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{filtered ? "Search results" : "Documents"}</h2>
            <p className="truncate font-mono text-3xs text-muted-foreground">
              {search.parentId ?? "Across reactor"}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Reload documents"
            aria-label="Reload documents"
            disabled={status.pending}
            onClick={refresh}
          >
            <RefreshCw aria-hidden />
          </Button>
        </div>
        {truncated ? (
          <PowerhouseInlineNotice>
            This Switchboard search was bounded at {items.length} documents. Matching documents
            beyond the returned set may be omitted because the reactor offered no next cursor.
          </PowerhouseInlineNotice>
        ) : null}
        {items.length === 0 && status.pending ? (
          <PowerhousePanelLoading label="Loading documents…" />
        ) : null}
        {items.length === 0 && !status.pending && status.error === null ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {filtered ? "No documents match these filters." : "This drive is empty."}
            </p>
          </div>
        ) : null}
        {items.length > 0 && visibleItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">No loaded documents match this search.</p>
          </div>
        ) : null}
        <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-xs/5 empty:hidden">
          {visibleItems.map((document) => {
            const container = CONTAINER_TYPES.has(document.documentType);
            const navigableContainer = container && onEnterFolder !== undefined;
            return (
              <li
                key={document.id}
                className="p-1 [contain-intrinsic-block-size:52px] [content-visibility:auto]"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (container && onEnterFolder !== undefined) {
                      onEnterFolder({ id: document.id, name: documentDisplayName(document) });
                      return;
                    }
                    onSelectDocument(document.id);
                  }}
                  aria-label={`${navigableContainer ? "Open folder" : "Open document"} ${documentDisplayName(document)}`}
                  className={POWERHOUSE_ROW_BUTTON_CLASS}
                  {...powerhouseRowDragProps(
                    powerhouseReactorMention({
                      kind: container ? "folder" : "doc",
                      item: document,
                      crumbNames,
                      reactorUrl: url,
                    }),
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground group-hover:text-foreground">
                    {container ? (
                      <Folder aria-hidden className="size-3.5" />
                    ) : (
                      <FileText aria-hidden className="size-3.5" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {documentDisplayName(document)}
                    </span>
                    <span className="min-w-0 truncate font-mono text-3xs text-muted-foreground">
                      {document.documentType}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                  />
                </button>
              </li>
            );
          })}
        </ul>
        {/* Reaching this pulls the next page, so the list keeps going by itself. */}
        <div ref={listEndRef} aria-hidden className="h-px" />
        {status.error !== null ? (
          <PowerhouseInlineNotice tone="error">{status.error}</PowerhouseInlineNotice>
        ) : null}
        {items.length > 0 ? (
          <div className="flex items-center justify-between gap-2">
            {/* Never "N of M": the reactor reports page length as its total. */}
            <span className="text-3xs text-muted-foreground">
              {searchingText
                ? `${visibleItems.length} matching · ${describeLoadedCount(items.length, "document")}`
                : describeLoadedCount(items.length, "document")}
            </span>
            {loadingMore ? (
              <span role="status" className="text-3xs text-muted-foreground">
                Loading more…
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
