import type { EnvironmentId } from "@t3tools/contracts";
import { AlertTriangle, Braces, ChevronRight, RefreshCw } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useEnvironmentQuery } from "~/state/query";
import { powerhouseEnvironment } from "~/state/powerhouse";

import { describeModelFailure, displayModelExtension } from "../PowerhousePanel.logic";
import {
  POWERHOUSE_ROW_BUTTON_CLASS,
  PowerhouseInlineNotice,
  PowerhousePanelLoading,
  PowerhousePanelState,
} from "../PowerhousePanelPrimitives";
import { powerhouseModelMention, powerhouseRowDragProps } from "../powerhouseDragMention";
import { ModelDetail } from "./ModelDetail";

interface ModelsViewProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  selectedModel: string | null;
  selectedSpecIndex: number | null;
  onSelectModel: (directoryName: string | null) => void;
  onSelectSpec: (index: number) => void;
}

/**
 * Document models declared on disk. This is the mode that works with nothing
 * running, so it never depends on a reactor being reachable.
 */
export function ModelsView({
  environmentId,
  cwd,
  projectPath,
  selectedModel,
  selectedSpecIndex,
  onSelectModel,
  onSelectSpec,
}: ModelsViewProps) {
  const query = useEnvironmentQuery(
    powerhouseEnvironment.documentModels({
      environmentId,
      input: { cwd, ...(projectPath.length === 0 ? {} : { projectPath }) },
    }),
  );

  if (selectedModel !== null) {
    return (
      <ModelDetail
        environmentId={environmentId}
        cwd={cwd}
        projectPath={projectPath}
        directoryName={selectedModel}
        selectedSpecIndex={selectedSpecIndex}
        onSelectSpec={onSelectSpec}
        onBack={() => onSelectModel(null)}
      />
    );
  }

  const listing = query.data ?? null;

  if (listing === null && query.isPending) {
    return <PowerhousePanelLoading label="Loading document models…" />;
  }

  if (listing === null) {
    // The error already says which of the honest failure modes this is —
    // no config, or a models directory that is not there.
    const failure = query.error ?? "Failed to read document models.";
    return (
      <PowerhousePanelState
        title="Document models could not be loaded"
        description={failure}
        tone="error"
        action={{ label: "Try again", onClick: query.refresh }}
      />
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-4 @[32rem]:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">Document models</h2>
            <p className="truncate font-mono text-3xs text-muted-foreground">
              {listing.documentModelsDir}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Reload models"
            aria-label="Reload document models"
            onClick={query.refresh}
          >
            <RefreshCw aria-hidden />
          </Button>
        </div>

        {query.error === null ? null : (
          <PowerhouseInlineNotice tone="error">
            Refresh failed. Showing the most recent model list. {query.error}
          </PowerhouseInlineNotice>
        )}

        {listing.truncated ? (
          <PowerhouseInlineNotice>
            This project has more than 500 model directories. Showing the first 500 by directory
            name.
          </PowerhouseInlineNotice>
        ) : null}

        {listing.failures.length > 0 ? (
          <PowerhouseInlineNotice>
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 font-medium">
                <AlertTriangle aria-hidden className="size-3 shrink-0 text-warning" />
                {listing.failures.length} model
                {listing.failures.length === 1 ? "" : "s"} could not be read
              </span>
              {listing.failures.map((failure) => (
                <span
                  key={failure.directoryName}
                  className="font-mono text-3xs break-all text-muted-foreground"
                >
                  {describeModelFailure(failure)}
                </span>
              ))}
            </div>
          </PowerhouseInlineNotice>
        ) : null}

        {listing.models.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              No document models in {listing.documentModelsDir} yet.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-xs/5">
            {listing.models.map((model) => (
              <li
                key={model.directoryName}
                className="p-1 [contain-intrinsic-block-size:72px] [content-visibility:auto]"
              >
                <button
                  type="button"
                  onClick={() => onSelectModel(model.directoryName)}
                  aria-label={`Open ${model.name}`}
                  className={POWERHOUSE_ROW_BUTTON_CLASS}
                  {...powerhouseRowDragProps(
                    powerhouseModelMention({
                      projectPath,
                      documentModelsDir: listing.documentModelsDir,
                      directoryName: model.directoryName,
                    }),
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground group-hover:text-foreground">
                    <Braces aria-hidden className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">{model.name}</span>
                      {displayModelExtension(model.extension).length > 0 ? (
                        <span className="shrink-0 font-mono text-3xs text-muted-foreground">
                          {displayModelExtension(model.extension)}
                        </span>
                      ) : null}
                    </span>
                    {model.description.length > 0 ? (
                      <span className="line-clamp-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                        {model.description}
                      </span>
                    ) : null}
                    <span className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-3xs text-muted-foreground">
                      <span>
                        {model.latestVersion === null ? "No version" : `v${model.latestVersion}`}
                      </span>
                      {model.specCount > 1 ? <span>{model.specCount} versions</span> : null}
                      <span>
                        {model.moduleCount} module{model.moduleCount === 1 ? "" : "s"}
                      </span>
                      <span>
                        {model.operationCount} operation{model.operationCount === 1 ? "" : "s"}
                      </span>
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
