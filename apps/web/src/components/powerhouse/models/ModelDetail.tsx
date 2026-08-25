import type {
  EnvironmentId,
  PowerhouseDocumentModel,
  PowerhouseDocumentModelModule,
  PowerhouseDocumentModelSpecification,
} from "@vetra-code/contracts";
import { ArrowLeft, Braces, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { powerhouseEnvironment } from "~/state/powerhouse";

import {
  displayModelExtension,
  resolveSpecificationIndex,
  specificationLabel,
} from "../PowerhousePanel.logic";
import {
  PowerhouseDisclosure,
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
  PowerhousePanelState,
} from "../PowerhousePanelPrimitives";
import { SdlBlock } from "../SdlBlock";
import { ModelSchemaView } from "./ModelSchemaView";

interface ModelDetailProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  directoryName: string;
  selectedSpecIndex: number | null;
  onSelectSpec: (index: number) => void;
  onBack: () => void;
}

const MAX_VERSION_CONTROLS = 100;
const MAX_RENDERED_MODULES = 100;
const MAX_RENDERED_OPERATIONS = 500;
const MAX_RENDERED_CHANGELOG_ENTRIES = 500;

interface IndexedSpecification {
  readonly specification: PowerhouseDocumentModelSpecification;
  readonly sourceIndex: number;
}

interface RenderedModule {
  readonly module: PowerhouseDocumentModelModule;
  readonly operations: PowerhouseDocumentModelModule["operations"];
  readonly operationsTruncated: boolean;
}

function CodeSurface({
  code,
  language,
  flush = false,
}: {
  code: string;
  language: "graphql" | "json";
  flush?: boolean;
}) {
  return (
    <SdlBlock
      code={code}
      language={language}
      className={flush ? "rounded-none border-0" : undefined}
    />
  );
}

function withOccurrenceKeys<T>(
  items: ReadonlyArray<T>,
  identify: (item: T) => string,
): ReadonlyArray<{ readonly item: T; readonly index: number; readonly key: string }> {
  const occurrences = new Map<string, number>();
  return items.map((item, index) => {
    const identity = identify(item);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { item, index, key: `${identity}:${occurrence}` };
  });
}

/** Keep the newest controls plus an older current selection when the file is unusually dense. */
function visibleSpecifications(
  specifications: ReadonlyArray<PowerhouseDocumentModelSpecification>,
  selectedIndex: number | null,
): ReadonlyArray<IndexedSpecification> {
  const toEntry = (specification: PowerhouseDocumentModelSpecification, sourceIndex: number) => ({
    specification,
    sourceIndex,
  });
  if (specifications.length <= MAX_VERSION_CONTROLS) return specifications.map(toEntry);
  const newestStart = specifications.length - MAX_VERSION_CONTROLS;
  if (selectedIndex === null || selectedIndex >= newestStart) {
    return specifications
      .slice(newestStart)
      .map((entry, index) => toEntry(entry, newestStart + index));
  }
  const latest = specifications
    .slice(-(MAX_VERSION_CONTROLS - 1))
    .map((entry, index) =>
      toEntry(entry, specifications.length - (MAX_VERSION_CONTROLS - 1) + index),
    );
  const selected = specifications[selectedIndex];
  return selected === undefined ? latest : [toEntry(selected, selectedIndex), ...latest];
}

/** Bound React work even when a valid two-megabyte model contains thousands of tiny entries. */
function renderedModules(modules: ReadonlyArray<PowerhouseDocumentModelModule>): {
  readonly modules: ReadonlyArray<RenderedModule>;
  readonly modulesTruncated: boolean;
  readonly operationsTruncated: boolean;
} {
  let remainingOperations = MAX_RENDERED_OPERATIONS;
  let operationsTruncated = false;
  const visible = modules.slice(0, MAX_RENDERED_MODULES).map((module) => {
    const operations = module.operations.slice(0, remainingOperations);
    remainingOperations -= operations.length;
    const truncated = operations.length < module.operations.length;
    operationsTruncated ||= truncated;
    return { module, operations, operationsTruncated: truncated };
  });
  return {
    modules: visible,
    modulesTruncated: visible.length < modules.length,
    operationsTruncated,
  };
}

/** One document model: identity, the version picker, state SDL, and operations. */
export function ModelDetail({
  environmentId,
  cwd,
  projectPath,
  directoryName,
  selectedSpecIndex,
  onSelectSpec,
  onBack,
}: ModelDetailProps) {
  const query = useEnvironmentQuery(
    powerhouseEnvironment.documentModel({
      environmentId,
      input: { cwd, directoryName, ...(projectPath.length === 0 ? {} : { projectPath }) },
    }),
  );
  const model: PowerhouseDocumentModel | null = query.data ?? null;

  if (query.error !== null && model === null) {
    return (
      <PowerhousePanelState
        title="This document model could not be loaded"
        description={query.error}
        tone="error"
        action={{ label: "Try again", onClick: query.refresh }}
        secondaryAction={{ label: "Back to models", onClick: onBack }}
      />
    );
  }
  if (model === null) {
    return <PowerhousePanelLoading label="Loading document model…" />;
  }

  const specIndex = resolveSpecificationIndex(model, selectedSpecIndex);
  const specification = specIndex === null ? null : model.specifications[specIndex];
  const specificationOptions = visibleSpecifications(model.specifications, specIndex);
  const moduleProjection = renderedModules(specification?.modules ?? []);
  const visibleChangeLog = specification?.changeLog.slice(0, MAX_RENDERED_CHANGELOG_ENTRIES) ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-4 @[32rem]:px-5">
        <div className="rounded-xl border border-border/70 bg-card/60 p-3 shadow-xs/5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button size="xs" variant="ghost-muted" onClick={onBack}>
              <ArrowLeft aria-hidden />
              All models
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Reload model"
              aria-label="Reload document model"
              onClick={query.refresh}
            >
              <RefreshCw aria-hidden />
            </Button>
          </div>
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/50 text-muted-foreground">
              <Braces aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <h2 className="min-w-0 truncate text-base font-semibold">{model.name}</h2>
                {displayModelExtension(model.extension).length > 0 ? (
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[.65rem] text-muted-foreground">
                    {displayModelExtension(model.extension)}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 font-mono text-[.65rem] break-all text-muted-foreground">
                {model.id}
              </p>
              {model.description.length > 0 ? (
                <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  {model.description}
                </p>
              ) : null}
              {model.author !== null && model.author.name.length > 0 ? (
                <p className="mt-1 text-[.65rem] text-muted-foreground">By {model.author.name}</p>
              ) : null}
            </div>
          </div>
        </div>

        {query.error === null ? null : (
          <PowerhouseInlineNotice tone="error">
            Refresh failed. Showing the most recent model. {query.error}
          </PowerhouseInlineNotice>
        )}

        {model.specifications.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-muted/30 p-1">
            {withOccurrenceKeys(
              specificationOptions,
              (entry) => `version:${entry.specification.version ?? "none"}`,
            ).map(({ item: entry, key }) => (
              <button
                key={key}
                type="button"
                aria-pressed={entry.sourceIndex === specIndex}
                onClick={() => onSelectSpec(entry.sourceIndex)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  entry.sourceIndex === specIndex
                    ? "border-border/70 bg-background text-foreground shadow-xs dark:bg-input/64"
                    : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {specificationLabel(entry.specification, entry.sourceIndex)}
              </button>
            ))}
          </div>
        ) : null}

        {specificationOptions.length < model.specifications.length ? (
          <PowerhouseInlineNotice>
            This model has {model.specifications.length} versions. Showing the selected version and
            the newest {MAX_VERSION_CONTROLS - 1} to keep the panel responsive.
          </PowerhouseInlineNotice>
        ) : null}

        {specification === undefined || specification === null ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              This model declares no specifications yet.
            </p>
          </div>
        ) : (
          <>
            <ModelSchemaView title="Global state" code={specification.globalSchema} collapsible />
            {specification.localSchema.trim().length > 0 ? (
              <ModelSchemaView
                title="Local state"
                code={specification.localSchema}
                defaultOpen={false}
              />
            ) : null}
            {moduleProjection.modulesTruncated ? (
              <PowerhouseInlineNotice>
                This version has more than {MAX_RENDERED_MODULES} modules. Only the first{" "}
                {MAX_RENDERED_MODULES} are shown.
              </PowerhouseInlineNotice>
            ) : null}
            {moduleProjection.operationsTruncated ? (
              <PowerhouseInlineNotice>
                Operation rendering is limited to {MAX_RENDERED_OPERATIONS} entries across this
                version.
              </PowerhouseInlineNotice>
            ) : null}
            {withOccurrenceKeys(
              moduleProjection.modules,
              (entry) => `module:${entry.module.name}`,
            ).map(({ item: entry, key }) => {
              const module = entry.module;
              return (
                <PowerhouseDisclosure
                  key={key}
                  title={module.name || "Module"}
                  meta={`${module.operations.length} operation${
                    module.operations.length === 1 ? "" : "s"
                  }`}
                  defaultOpen={false}
                >
                  {module.description !== null && module.description.length > 0 ? (
                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                      {module.description}
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2.5">
                    {withOccurrenceKeys(
                      entry.operations,
                      (operation) => `operation:${operation.name}`,
                    ).map(({ item: operation, key: operationKey }) => (
                      <div
                        key={operationKey}
                        className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5"
                      >
                        <span className="font-mono text-xs font-medium">
                          {operation.name || "Operation"}
                        </span>
                        {operation.description !== null && operation.description.length > 0 ? (
                          <span className="text-xs leading-relaxed text-muted-foreground">
                            {operation.description}
                          </span>
                        ) : null}
                        {operation.schema === null ||
                        operation.schema.trim().length === 0 ? null : (
                          <CodeSurface code={operation.schema} language="graphql" />
                        )}
                      </div>
                    ))}
                    {module.operations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No operations.</p>
                    ) : null}
                    {entry.operationsTruncated ? (
                      <PowerhouseInlineNotice>
                        {module.operations.length - entry.operations.length} more operation
                        {module.operations.length - entry.operations.length === 1 ? "" : "s"}{" "}
                        omitted.
                      </PowerhouseInlineNotice>
                    ) : null}
                  </div>
                </PowerhouseDisclosure>
              );
            })}
            {specification.changeLog.length > 0 ? (
              <PowerhouseDisclosure
                title="Change log"
                meta={`${specification.changeLog.length}`}
                defaultOpen={false}
              >
                <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
                  {withOccurrenceKeys(visibleChangeLog, (entry) => `change:${entry}`).map(
                    ({ item: entry, key }) => (
                      <li key={key}>{entry}</li>
                    ),
                  )}
                </ul>
                {visibleChangeLog.length < specification.changeLog.length ? (
                  <div className="mt-3">
                    <PowerhouseInlineNotice>
                      {specification.changeLog.length - visibleChangeLog.length} older change-log
                      entries omitted.
                    </PowerhouseInlineNotice>
                  </div>
                ) : null}
              </PowerhouseDisclosure>
            ) : null}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
