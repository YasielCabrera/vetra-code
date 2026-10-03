import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronRight } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { powerhouseEnvironment } from "~/state/powerhouse";
import { useEnvironmentQuery } from "~/state/query";

import { displayReactorUrl } from "../PowerhousePanel.logic";
import { PowerhousePanelLoading } from "../PowerhousePanelPrimitives";
import { useReactorQuery } from "../powerhouseQuery";
import type { PowerhouseExplorerCrumb, PowerhouseExplorerSelection } from "../powerhousePanelStore";
import { DocumentDetail } from "./DocumentDetail";
import { DocumentFilterBar } from "./DocumentFilterBar";
import { DocumentList } from "./DocumentList";
import {
  documentTypeOptions,
  type PowerhouseDocumentTypeCatalogStatus,
  type PowerhouseDocumentTypeOption,
} from "./documentTypeOptions";
import { DriveList } from "./DriveList";
import { ReactorConnectionCard } from "./ReactorConnectionCard";
import {
  documentFilterCount,
  EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
  hasExplicitDocumentSearch,
  reactorDocumentSearch,
  reactorDocumentView,
  type PowerhouseDocumentFilters,
} from "./documentFilters";

interface ExplorerViewProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  overrideUrl: string | null;
  selection: PowerhouseExplorerSelection;
  onSetOverride: (url: string | null) => void;
  onSelectDrive: (drive: PowerhouseExplorerCrumb) => void;
  onEnterFolder: (folder: PowerhouseExplorerCrumb) => void;
  onPopToDepth: (depth: number) => void;
  onSelectDocument: (documentId: string | null) => void;
}

/**
 * Live reactor data. Every state here is bounded: the probe times out server
 * side, so a reactor that is not running lands on the connection card rather
 * than a spinner that never resolves.
 */
export function ExplorerView({
  environmentId,
  cwd,
  projectPath,
  overrideUrl,
  selection,
  onSetOverride,
  onSelectDrive,
  onEnterFolder,
  onPopToDepth,
  onSelectDocument,
}: ExplorerViewProps) {
  const probe = useReactorQuery(
    powerhouseEnvironment.reactorProbe({
      environmentId,
      input: {
        cwd,
        ...(projectPath.length === 0 ? {} : { projectPath }),
        ...(overrideUrl === null ? {} : { overrideUrl }),
      },
    }),
  );
  const modelCatalog = useEnvironmentQuery(
    powerhouseEnvironment.documentModels({
      environmentId,
      input: { cwd, ...(projectPath.length === 0 ? {} : { projectPath }) },
    }),
  );
  const knownDocumentTypeOptions = useMemo(
    () => documentTypeOptions(modelCatalog.data?.models ?? []),
    [modelCatalog.data],
  );
  const documentTypeCatalogStatus: PowerhouseDocumentTypeCatalogStatus =
    modelCatalog.data !== null
      ? modelCatalog.data.truncated || modelCatalog.data.failures.length > 0
        ? "partial"
        : "ready"
      : modelCatalog.error !== null
        ? "error"
        : "loading";
  const connection = probe.isFailure ? null : probe.data;

  if (connection === null && probe.isPending) {
    return (
      <PowerhousePanelLoading
        label={
          overrideUrl === null
            ? "Looking for a reactor…"
            : `Connecting to ${displayReactorUrl(overrideUrl)}…`
        }
      />
    );
  }

  if (connection === null) {
    return (
      <ReactorConnectionCard
        error={probe.error}
        otherError={probe.otherError}
        overrideUrl={overrideUrl}
        onSetOverride={onSetOverride}
        onRetry={probe.refresh}
      />
    );
  }

  const url = connection.url;
  return (
    <ConnectedExplorer
      key={url}
      environmentId={environmentId}
      url={url}
      selection={selection}
      documentTypeOptions={knownDocumentTypeOptions}
      documentTypeCatalogStatus={documentTypeCatalogStatus}
      onSelectDrive={onSelectDrive}
      onEnterFolder={onEnterFolder}
      onPopToDepth={onPopToDepth}
      onSelectDocument={onSelectDocument}
    />
  );
}

interface ConnectedExplorerProps {
  environmentId: EnvironmentId;
  url: string;
  selection: PowerhouseExplorerSelection;
  documentTypeOptions: ReadonlyArray<PowerhouseDocumentTypeOption>;
  documentTypeCatalogStatus: PowerhouseDocumentTypeCatalogStatus;
  onSelectDrive: (drive: PowerhouseExplorerCrumb) => void;
  onEnterFolder: (folder: PowerhouseExplorerCrumb) => void;
  onPopToDepth: (depth: number) => void;
  onSelectDocument: (documentId: string | null) => void;
}

/** Search state belongs to one resolved reactor and resets when its URL changes. */
function ConnectedExplorer({
  environmentId,
  url,
  selection,
  documentTypeOptions,
  documentTypeCatalogStatus,
  onSelectDrive,
  onEnterFolder,
  onPopToDepth,
  onSelectDocument,
}: ConnectedExplorerProps) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<PowerhouseDocumentFilters>(
    EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
  );
  // Text matching can walk hundreds of loaded summaries. Keep keystrokes
  // urgent and let the list follow on React's deferred render.
  const deferredQuery = useDeferredValue(query);
  const currentParent = selection.path[selection.path.length - 1] ?? null;
  const search = reactorDocumentSearch(filters, currentParent?.id ?? null);
  const view = reactorDocumentView(filters);
  const apiFilterCount = documentFilterCount(filters);
  const showDocumentResults = currentParent !== null || hasExplicitDocumentSearch(filters);
  const enteringCurrentPath =
    currentParent !== null &&
    (filters.parentId.length === 0 || filters.parentId === currentParent.id);
  const resultKey = JSON.stringify({ search, view });
  const viewKey = JSON.stringify(view);
  const filtered = apiFilterCount > 0 || deferredQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      {selection.path.length > 0 ? (
        <nav
          aria-label="Reactor explorer breadcrumb"
          className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-1 px-3 pt-3 text-2xs @[32rem]:px-5"
        >
          <button
            type="button"
            onClick={() => onPopToDepth(0)}
            className="rounded-md px-1.5 py-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Drives
          </button>
          {selection.path.map((crumb, index) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/50" />
              {index === selection.path.length - 1 ? (
                <span
                  aria-current="page"
                  className="min-w-0 max-w-48 truncate px-1.5 py-1 font-medium text-foreground"
                >
                  {crumb.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onPopToDepth(index + 1)}
                  className="min-w-0 max-w-48 truncate rounded-md px-1.5 py-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {selection.documentId === null ? (
        <DocumentFilterBar
          query={query}
          filters={filters}
          currentParentId={currentParent?.id ?? null}
          documentTypeOptions={documentTypeOptions}
          documentTypeCatalogStatus={documentTypeCatalogStatus}
          onQueryChange={setQuery}
          onFiltersChange={setFilters}
        />
      ) : null}

      <div className="min-h-0 flex-1">
        {selection.documentId !== null ? (
          <DocumentDetail
            key={`${url}:${selection.documentId}:${viewKey}`}
            environmentId={environmentId}
            url={url}
            documentId={selection.documentId}
            view={view}
            onBack={() => onSelectDocument(null)}
            onOpenChild={(childId) => onSelectDocument(childId)}
          />
        ) : !showDocumentResults ? (
          <DriveList
            key={url}
            environmentId={environmentId}
            url={url}
            query={deferredQuery}
            onSelectDrive={onSelectDrive}
          />
        ) : (
          <DocumentList
            key={`${url}:${resultKey}`}
            environmentId={environmentId}
            url={url}
            search={search}
            view={view}
            query={deferredQuery}
            filtered={filtered}
            crumbNames={enteringCurrentPath ? selection.path.map((crumb) => crumb.name) : []}
            onEnterFolder={enteringCurrentPath ? onEnterFolder : undefined}
            onSelectDocument={(documentId) => onSelectDocument(documentId)}
          />
        )}
      </div>
    </div>
  );
}
