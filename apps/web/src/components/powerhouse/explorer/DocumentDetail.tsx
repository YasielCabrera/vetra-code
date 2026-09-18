import type { EnvironmentId, PowerhouseReactorDocumentViewFilter } from "@t3tools/contracts";
import { ArrowLeft, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { lazy, Suspense } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { powerhouseEnvironment } from "~/state/powerhouse";

import { documentDisplayName } from "../PowerhousePanel.logic";
import {
  POWERHOUSE_ROW_BUTTON_CLASS,
  PowerhouseDisclosure,
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
  PowerhousePanelState,
} from "../PowerhousePanelPrimitives";
import { useReactorQuery } from "../powerhouseQuery";
import { SdlBlock } from "../SdlBlock";
import { OperationsList } from "./OperationsList";

const LazyJsonStateView = lazy(() =>
  import("./JsonStateView").then(({ JsonStateView }) => ({ default: JsonStateView })),
);

interface DocumentDetailProps {
  environmentId: EnvironmentId;
  url: string;
  documentId: string;
  view: PowerhouseReactorDocumentViewFilter | undefined;
  onBack: () => void;
  onOpenChild: (childId: string) => void;
}

export function DocumentDetail({
  environmentId,
  url,
  documentId,
  view,
  onBack,
  onOpenChild,
}: DocumentDetailProps) {
  const query = useReactorQuery(
    powerhouseEnvironment.reactorDocument({
      environmentId,
      input: { url, documentId, ...(view === undefined ? {} : { view }) },
    }),
  );

  if (query.data === null && query.isPending) {
    return <PowerhousePanelLoading label="Loading reactor document…" />;
  }

  if (query.data === null) {
    return (
      <PowerhousePanelState
        title="This document could not be loaded"
        description={query.error?.message ?? query.otherError ?? "Failed to load the document."}
        tone="error"
        action={{ label: "Try again", onClick: query.refresh }}
        secondaryAction={{ label: "Back to documents", onClick: onBack }}
      />
    );
  }

  const document = query.data;
  const stateCode =
    document.state === null || document.state === undefined
      ? null
      : JSON.stringify(document.state, null, 2);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-3 @[32rem]:px-5">
        <div className="rounded-xl border border-border/70 bg-card/60 p-3 shadow-xs/5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button size="xs" variant="ghost-muted" onClick={onBack}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Reload document"
              aria-label="Reload document"
              onClick={query.refresh}
            >
              <RefreshCw aria-hidden />
            </Button>
          </div>
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/50 text-muted-foreground">
              <FileText aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold">{documentDisplayName(document)}</h2>
              <p className="mt-0.5 font-mono text-[.65rem] break-all text-muted-foreground">
                {document.documentType}
              </p>
              <p className="font-mono text-[.65rem] break-all text-muted-foreground">
                {document.id}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[.65rem] text-muted-foreground">
                {document.revisions.map((revision) => (
                  <span
                    key={`${revision.scope}:${revision.revision}`}
                    className="rounded-md bg-muted px-1.5 py-0.5"
                  >
                    {revision.scope} rev {revision.revision}
                  </span>
                ))}
                {document.preferredEditor === null ? null : (
                  <span className="rounded-md bg-muted px-1.5 py-0.5">
                    Editor: {document.preferredEditor}
                  </span>
                )}
                {document.revisionsTruncated ? (
                  <span className="rounded-md bg-warning/8 px-1.5 py-0.5 text-warning-foreground">
                    More revisions omitted
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {query.isFailure ? (
          <PowerhouseInlineNotice tone="error">
            Refresh failed. Showing the most recent document.{" "}
            {query.error?.message ?? query.otherError}
          </PowerhouseInlineNotice>
        ) : null}

        <PowerhouseDisclosure title="State" meta="JSON" contentClassName="p-0">
          {document.stateTruncated ? (
            <p className="p-3 text-xs text-muted-foreground">
              This document's state is too large to display safely.
            </p>
          ) : stateCode === null ? (
            <p className="p-3 text-xs text-muted-foreground">No state.</p>
          ) : (
            <Suspense
              fallback={
                <SdlBlock
                  code={stateCode}
                  language="json"
                  className="rounded-none border-0"
                  lineNumbers
                />
              }
            >
              <LazyJsonStateView code={stateCode} />
            </Suspense>
          )}
        </PowerhouseDisclosure>

        <OperationsList
          environmentId={environmentId}
          url={url}
          documentId={document.id}
          view={view}
        />

        {document.childIds.length > 0 ? (
          <PowerhouseDisclosure
            title="Children"
            meta={`${document.childIds.length}${document.childIdsTruncated ? "+" : ""}`}
            defaultOpen={false}
          >
            <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
              {document.childIds.map((childId) => (
                <li
                  key={childId}
                  className="p-1 [contain-intrinsic-block-size:44px] [content-visibility:auto]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenChild(childId)}
                    aria-label={`Open child document ${childId}`}
                    className={POWERHOUSE_ROW_BUTTON_CLASS}
                  >
                    <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[.7rem] text-muted-foreground group-hover:text-foreground">
                      {childId}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {document.childIdsTruncated ? (
              <div className="mt-2">
                <PowerhouseInlineNotice>
                  This document has more than 500 children. Only the first 500 are shown.
                </PowerhouseInlineNotice>
              </div>
            ) : null}
          </PowerhouseDisclosure>
        ) : null}
      </div>
    </ScrollArea>
  );
}
