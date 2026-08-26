import { squashAtomCommandFailure } from "@vetra-code/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PowerhouseDatabaseRelationSummary,
  PowerhouseDatabaseSchemaSummary,
  PowerhouseDatabaseTarget,
} from "@vetra-code/contracts";
import {
  Braces,
  Columns3,
  Database as DatabaseIcon,
  FileKey2,
  ListTree,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Table2,
  TerminalSquare,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useComposerHandleContext } from "~/composerHandleContext";
import { cn } from "~/lib/utils";
import { powerhouseEnvironment } from "~/state/powerhouse";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
  PowerhousePanelState,
} from "../PowerhousePanelPrimitives";
import { EMPTY_DATABASE_SESSION, usePowerhousePanelStore } from "../powerhousePanelStore";
import { useDatabaseQuery } from "../powerhouseQuery";
import { DatabaseResultTable } from "./DatabaseResultTable";
import {
  formatPowerhouseDatabaseTargetStatus,
  formatPowerhouseRelationChatContext,
  insertPowerhouseChatContext,
  makePowerhouseRelationSelectSql,
  selectPowerhouseDatabaseRelation,
} from "./databaseViewLogic";

const DatabaseSqlConsole = lazy(() => import("./DatabaseSqlConsole"));

type RelationTab = "data" | "columns" | "indexes" | "constraints" | "definition";

const TABS: ReadonlyArray<{ readonly id: RelationTab; readonly label: string }> = [
  { id: "data", label: "Data" },
  { id: "columns", label: "Columns" },
  { id: "indexes", label: "Indexes" },
  { id: "constraints", label: "Constraints" },
  { id: "definition", label: "Definition" },
];

const relationKindLabel = (kind: PowerhouseDatabaseRelationSummary["kind"]) =>
  kind.replaceAll("_", " ");

function StatusChip({ target }: { target: PowerhouseDatabaseTarget }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[.63rem] tabular-nums",
        target.status === "ready"
          ? "border-success/25 bg-success/7 text-success"
          : target.status === "missing"
            ? "border-warning/25 bg-warning/7 text-warning-foreground"
            : "border-destructive/25 bg-destructive/6 text-destructive",
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      <span className="truncate">{formatPowerhouseDatabaseTargetStatus(target)}</span>
    </span>
  );
}

function RelationNavigation({
  schemas,
  search,
  active,
  onSelect,
}: {
  schemas: ReadonlyArray<PowerhouseDatabaseSchemaSummary>;
  search: string;
  active: PowerhouseDatabaseRelationSummary | null;
  onSelect: (relation: PowerhouseDatabaseRelationSummary) => void;
}) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = schemas.flatMap((schema) => {
    const relations = schema.relations.filter((relation) =>
      `${schema.name}.${relation.name}`.toLocaleLowerCase().includes(normalizedSearch),
    );
    return relations.length === 0 ? [] : [{ ...schema, relations }];
  });

  if (filtered.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">No relations match.</p>
    );
  }

  return (
    <div className="space-y-1 px-2 pb-3">
      {filtered.map((schema) => (
        <details key={schema.name} open className="group/schema">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[.67rem] font-medium text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
            <ListTree aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{schema.name}</span>
            <span className="tabular-nums opacity-65">{schema.relations.length}</span>
          </summary>
          <div className="ml-2 border-l border-border/60 pl-1">
            {schema.relations.map((relation) => {
              const selected = active?.schema === relation.schema && active.name === relation.name;
              return (
                <button
                  key={`${relation.schema}.${relation.name}`}
                  type="button"
                  onClick={() => onSelect(relation)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
                  )}
                >
                  <Table2 aria-hidden className="size-3 shrink-0 opacity-75" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[.68rem]">
                    {relation.name}
                  </span>
                  {relation.estimatedRows === null ? null : (
                    <span className="shrink-0 font-mono text-[.58rem] tabular-nums opacity-55">
                      ~{Math.round(relation.estimatedRows).toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

function EmptyPart({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

export function DatabaseView({
  environmentId,
  cwd,
  projectPath,
  panelProjectKey,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  panelProjectKey: string;
}) {
  const session = usePowerhousePanelStore(
    (state) => state.databaseSessionByPanelProjectKey[panelProjectKey] ?? EMPTY_DATABASE_SESSION,
  );
  const setTarget = usePowerhousePanelStore((state) => state.setDatabaseTarget);
  const selectRelation = usePowerhousePanelStore((state) => state.selectDatabaseRelation);
  const setDraft = usePowerhousePanelStore((state) => state.setDatabaseDraft);
  const recordQuery = usePowerhousePanelStore((state) => state.recordDatabaseQuery);
  const setRowLimit = usePowerhousePanelStore((state) => state.setDatabaseRowLimit);
  const setIncludeSystem = usePowerhousePanelStore(
    (state) => state.setDatabaseIncludeSystemSchemas,
  );
  const composerRef = useComposerHandleContext();
  const refreshSnapshot = useAtomCommand(powerhouseEnvironment.databaseRefresh, {
    reportFailure: false,
  });
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<RelationTab>("data");
  const [sqlOpen, setSqlOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const projectInput = useMemo(
    () => ({ cwd, ...(projectPath.length === 0 ? {} : { projectPath }) }),
    [cwd, projectPath],
  );
  const discovery = useDatabaseQuery(
    powerhouseEnvironment.databaseDiscover({ environmentId, input: projectInput }),
  );
  const discoveredTarget =
    discovery.data?.targets.find((target) => target.id === session.target) ?? null;
  const catalog = useDatabaseQuery(
    discoveredTarget?.status === "ready"
      ? powerhouseEnvironment.databaseCatalog({
          environmentId,
          input: {
            ...projectInput,
            target: session.target,
            includeSystemSchemas: session.includeSystemSchemas,
          },
        })
      : null,
  );

  const allRelations = catalog.data?.schemas.flatMap((schema) => schema.relations) ?? [];
  const activeRelation = selectPowerhouseDatabaseRelation(
    allRelations,
    session.schema,
    session.relation,
  );
  const relation = useDatabaseQuery(
    activeRelation === null
      ? null
      : powerhouseEnvironment.databaseRelation({
          environmentId,
          input: {
            ...projectInput,
            target: session.target,
            schema: activeRelation.schema,
            relation: activeRelation.name,
          },
        }),
  );
  const preview = useDatabaseQuery(
    activeRelation === null || tab !== "data" || sqlOpen
      ? null
      : powerhouseEnvironment.databasePreview({
          environmentId,
          input: {
            ...projectInput,
            target: session.target,
            schema: activeRelation.schema,
            relation: activeRelation.name,
            limit: session.rowLimit,
          },
        }),
  );
  const displayTarget = relation.data?.target ?? catalog.data?.target ?? discoveredTarget;
  const tableTabFillsViewport =
    relation.data !== null &&
    ((tab === "data" && preview.data !== null) ||
      (tab === "columns" && relation.data.relation.columns.length > 0));

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setActionError(null);
    const result = await refreshSnapshot({
      environmentId,
      input: { ...projectInput, target: session.target },
    });
    setRefreshing(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setActionError(
        error instanceof Error ? error.message : "The database could not be refreshed.",
      );
      return;
    }
    discovery.refresh();
    catalog.refresh();
    relation.refresh();
    preview.refresh();
  };

  const addSchemaToChat = () => {
    if (relation.data === null) return;
    const insertion = insertPowerhouseChatContext(
      composerRef?.current,
      formatPowerhouseRelationChatContext(session.target, relation.data.relation),
    );
    if (insertion === "inserted") {
      toastManager.add({ type: "success", title: "Database schema added to chat" });
    } else {
      toastManager.add({
        type: "error",
        title: "Unable to add database schema",
        description:
          insertion === "unavailable"
            ? "Open a chat for this project and try again."
            : "The active composer could not accept database context.",
      });
    }
  };

  const openRelationInSql = () => {
    if (activeRelation === null) return;
    setDraft(panelProjectKey, makePowerhouseRelationSelectSql(activeRelation));
    setSqlOpen(true);
  };

  if (discovery.isPending && discovery.data === null) {
    return <PowerhousePanelLoading label="Discovering Powerhouse databases…" />;
  }
  if (discovery.isFailure && discovery.data === null) {
    return (
      <PowerhousePanelState
        title="Database discovery failed"
        description={discovery.errorMessage ?? "The Powerhouse databases could not be discovered."}
        tone="error"
        action={{ label: "Try again", onClick: discovery.refresh }}
      />
    );
  }
  if (discoveredTarget === null) {
    return (
      <PowerhousePanelState
        title="Database target unavailable"
        description="Vetra did not receive a database target for this Powerhouse project."
        tone="error"
        action={{ label: "Try again", onClick: discovery.refresh }}
      />
    );
  }

  return (
    <div className="@container/database flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-3 py-2 @[38rem]:px-4">
        <div
          role="group"
          aria-label="Database target"
          className="flex items-center rounded-lg border border-border/60 bg-muted/35 p-0.5"
        >
          {(["read_models", "reactor"] as const).map((target) => (
            <button
              key={target}
              type="button"
              aria-pressed={session.target === target}
              onClick={() => setTarget(panelProjectKey, target)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                session.target === target
                  ? "bg-background text-foreground shadow-xs dark:bg-input/64"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {target === "read_models" ? "Read models" : "Reactor"}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {displayTarget === null ? null : <StatusChip target={displayTarget} />}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh database snapshot and catalog"
            title="Refresh database snapshot and catalog"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            <RefreshCw aria-hidden />
          </Button>
          <Button
            size="xs"
            variant={sqlOpen ? "secondary" : "ghost"}
            onClick={() => setSqlOpen((open) => !open)}
            disabled={catalog.data === null}
          >
            <TerminalSquare aria-hidden className="size-3" />
            SQL
          </Button>
        </div>
      </div>

      {actionError === null ? null : (
        <div className="shrink-0 px-3 pt-3">
          <PowerhouseInlineNotice tone="error">{actionError}</PowerhouseInlineNotice>
        </div>
      )}

      {discoveredTarget.status !== "ready" ? (
        <PowerhousePanelState
          title={
            discoveredTarget.status === "missing"
              ? `${discoveredTarget.label} database not found`
              : `${discoveredTarget.label} database is unsupported`
          }
          description={discoveredTarget.detail ?? "This database target cannot be inspected."}
          action={{ label: "Check again", onClick: discovery.refresh }}
        />
      ) : catalog.isPending && catalog.data === null ? (
        <PowerhousePanelLoading label="Reading database catalog…" />
      ) : catalog.isFailure && catalog.data === null ? (
        <PowerhousePanelState
          title="Database catalog could not be read"
          description={catalog.errorMessage ?? "The database inspection request failed."}
          tone="error"
          action={{ label: "Try again", onClick: catalog.refresh }}
        />
      ) : catalog.data === null ? null : sqlOpen ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={<PowerhousePanelLoading label="Loading SQL editor…" />}>
            <DatabaseSqlConsole
              environmentId={environmentId}
              cwd={cwd}
              projectPath={projectPath}
              target={session.target}
              catalog={catalog.data}
              draft={session.draft}
              history={session.history}
              rowLimit={session.rowLimit}
              onDraftChange={(value) => setDraft(panelProjectKey, value)}
              onRecordQuery={(value) => recordQuery(panelProjectKey, value)}
              onRowLimitChange={(value) => setRowLimit(panelProjectKey, value)}
              onClose={() => setSqlOpen(false)}
            />
          </Suspense>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(11rem,32%)_minmax(0,1fr)] @[46rem]:grid-cols-[15rem_minmax(0,1fr)] @[46rem]:grid-rows-1">
          <aside className="min-h-0 overflow-auto border-b border-border/60 bg-muted/10 @[46rem]:border-r @[46rem]:border-b-0">
            <div className="sticky top-0 z-10 space-y-2 border-b border-border/50 bg-background/95 p-2.5">
              <label className="relative block">
                <span className="sr-only">Search schemas and relations</span>
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search database…"
                  className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 px-1 text-[.66rem] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={session.includeSystemSchemas}
                  onChange={(event) => setIncludeSystem(panelProjectKey, event.target.checked)}
                  className="size-3 rounded border-input accent-primary"
                />
                Show system schemas
              </label>
            </div>
            <RelationNavigation
              schemas={catalog.data.schemas}
              search={search}
              active={activeRelation}
              onSelect={(next) => {
                selectRelation(panelProjectKey, next.schema, next.name);
                setTab("data");
              }}
            />
          </aside>

          <main
            className={cn("min-h-0", tableTabFillsViewport ? "overflow-hidden" : "overflow-auto")}
          >
            {activeRelation === null ? (
              <PowerhousePanelState
                title="No database relations"
                description="This target has no tables, views, materialized views, or foreign tables to inspect."
                action={{ label: "Refresh catalog", onClick: catalog.refresh }}
              />
            ) : relation.isPending && relation.data === null ? (
              <PowerhousePanelLoading label="Reading relation definition…" />
            ) : relation.isFailure && relation.data === null ? (
              <PowerhousePanelState
                title="Relation could not be read"
                description={relation.errorMessage ?? "The relation definition request failed."}
                tone="error"
                action={{ label: "Try again", onClick: relation.refresh }}
              />
            ) : relation.data === null ? null : (
              <div
                className={cn(
                  "mx-auto max-w-5xl p-3 @[42rem]:p-4",
                  tableTabFillsViewport ? "flex h-full min-h-0 flex-col gap-3" : "space-y-3",
                )}
              >
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[.67rem] text-muted-foreground">
                      <DatabaseIcon aria-hidden className="size-3" />
                      <span className="truncate font-mono">{activeRelation.schema}</span>
                      <span aria-hidden>/</span>
                      <span className="capitalize">{relationKindLabel(activeRelation.kind)}</span>
                    </div>
                    <h2 className="mt-0.5 truncate font-mono text-sm font-medium">
                      {activeRelation.name}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="xs" variant="outline" onClick={openRelationInSql}>
                      <TerminalSquare aria-hidden className="size-3" />
                      Open in SQL
                    </Button>
                    <Button size="xs" variant="ghost" onClick={addSchemaToChat}>
                      <MessageSquarePlus aria-hidden className="size-3" />
                      Add schema to chat
                    </Button>
                  </div>
                </div>

                <div
                  role="tablist"
                  aria-label="Relation details"
                  className="flex max-w-full shrink-0 gap-0.5 overflow-x-auto border-b border-border/60"
                >
                  {TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      onClick={() => setTab(item.id)}
                      className={cn(
                        "shrink-0 border-b-2 px-2.5 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        tab === item.id
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {tab === "data" ? (
                  preview.isPending && preview.data === null ? (
                    <PowerhousePanelLoading label="Reading relation rows…" />
                  ) : preview.isFailure && preview.data === null ? (
                    <PowerhouseInlineNotice tone="error">
                      {preview.errorMessage ?? "The data preview failed."}
                    </PowerhouseInlineNotice>
                  ) : preview.data === null ? null : (
                    <DatabaseResultTable result={preview.data.result} className="min-h-0 flex-1" />
                  )
                ) : tab === "columns" ? (
                  relation.data.relation.columns.length === 0 ? (
                    <EmptyPart>No columns are reported for this relation.</EmptyPart>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/70">
                      <table className="min-w-full border-collapse text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">
                              Column
                            </th>
                            <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">
                              Type
                            </th>
                            <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">
                              Nullable
                            </th>
                            <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">
                              Default / generated
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {relation.data.relation.columns.map((column) => (
                            <tr key={column.name} className="border-t border-border/50">
                              <td className="px-3 py-2 font-mono">{column.name}</td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">
                                {column.dataType}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {column.nullable ? "yes" : "no"}
                              </td>
                              <td className="max-w-sm px-3 py-2 font-mono text-[.68rem] break-words text-muted-foreground">
                                {column.defaultExpression ?? (column.generated ? "generated" : "—")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : tab === "indexes" ? (
                  relation.data.relation.indexes.length === 0 ? (
                    <EmptyPart>No indexes are defined on this relation.</EmptyPart>
                  ) : (
                    <div className="space-y-2">
                      {relation.data.relation.indexes.map((index) => (
                        <section
                          key={index.name}
                          className="rounded-lg border border-border/70 bg-card/45 p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <FileKey2 aria-hidden className="size-3.5 text-muted-foreground" />
                            <h3 className="font-mono text-xs font-medium">{index.name}</h3>
                            {index.primary ? (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[.6rem] text-primary">
                                primary
                              </span>
                            ) : null}
                            {index.unique ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[.6rem] text-muted-foreground">
                                unique
                              </span>
                            ) : null}
                          </div>
                          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[.68rem] leading-relaxed text-muted-foreground">
                            {index.definition}
                          </pre>
                        </section>
                      ))}
                    </div>
                  )
                ) : tab === "constraints" ? (
                  relation.data.relation.constraints.length === 0 ? (
                    <EmptyPart>No constraints are defined on this relation.</EmptyPart>
                  ) : (
                    <div className="space-y-2">
                      {relation.data.relation.constraints.map((constraint) => (
                        <section
                          key={constraint.name}
                          className="rounded-lg border border-border/70 bg-card/45 p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Columns3 aria-hidden className="size-3.5 text-muted-foreground" />
                            <h3 className="font-mono text-xs font-medium">{constraint.name}</h3>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[.6rem] text-muted-foreground">
                              {constraint.type.replaceAll("_", " ")}
                            </span>
                          </div>
                          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[.68rem] leading-relaxed text-muted-foreground">
                            {constraint.definition}
                          </pre>
                        </section>
                      ))}
                    </div>
                  )
                ) : (
                  <section className="overflow-hidden rounded-lg border border-border/70 bg-card/45">
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                      <span className="flex items-center gap-1.5 text-[.67rem] text-muted-foreground">
                        <Braces aria-hidden className="size-3" />
                        {relation.data.relation.definitionKind === "exact"
                          ? "Exact catalog definition"
                          : "Reconstructed structure"}
                      </span>
                    </div>
                    <pre className="max-h-[32rem] overflow-auto p-3 font-mono text-[.7rem] leading-relaxed whitespace-pre-wrap">
                      {relation.data.relation.definition}
                    </pre>
                  </section>
                )}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
