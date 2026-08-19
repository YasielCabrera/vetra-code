import CodeMirror from "@uiw/react-codemirror";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { squashAtomCommandFailure } from "@vetra-code/client-runtime/state/runtime";
import type {
  EnvironmentId,
  PowerhouseDatabaseCatalogResult,
  PowerhouseDatabaseQueryResult,
  PowerhouseDatabaseRowLimit,
  PowerhouseDatabaseTargetId,
} from "@vetra-code/contracts";
import { CircleAlert, Clock3, Play, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useComposerHandleContext } from "~/composerHandleContext";
import { useTheme } from "~/hooks/useTheme";
import { powerhouseEnvironment } from "~/state/powerhouse";
import { useAtomCommand } from "~/state/use-atom-command";

import { DatabaseResultTable } from "./DatabaseResultTable";
import {
  formatPowerhouseResultChatContext,
  makePowerhouseSqlCompletionSchema,
} from "./databaseViewLogic";

const rowLimits = [50, 100, 200] as const;
const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The database query failed.";

export default function DatabaseSqlConsole({
  environmentId,
  cwd,
  projectPath,
  target,
  catalog,
  draft,
  history,
  rowLimit,
  onDraftChange,
  onRecordQuery,
  onRowLimitChange,
  onClose,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  target: PowerhouseDatabaseTargetId;
  catalog: PowerhouseDatabaseCatalogResult;
  draft: string;
  history: ReadonlyArray<string>;
  rowLimit: PowerhouseDatabaseRowLimit;
  onDraftChange: (value: string) => void;
  onRecordQuery: (value: string) => void;
  onRowLimitChange: (value: PowerhouseDatabaseRowLimit) => void;
  onClose: () => void;
}) {
  const execute = useAtomCommand(powerhouseEnvironment.databaseExecute, { reportFailure: false });
  const composerRef = useComposerHandleContext();
  const { resolvedTheme } = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<{
    readonly sql: string;
    readonly result: PowerhouseDatabaseQueryResult;
  } | null>(null);
  const extensions = useMemo(
    () => [
      sql({
        dialect: PostgreSQL,
        schema: makePowerhouseSqlCompletionSchema(catalog),
        upperCaseKeywords: true,
      }),
    ],
    [catalog],
  );

  const run = async () => {
    if (pending || draft.trim().length === 0) return;
    setPending(true);
    setError(null);
    const executedSql = draft.trim();
    const settled = await execute({
      environmentId,
      input: {
        cwd,
        ...(projectPath.length === 0 ? {} : { projectPath }),
        target,
        sql: executedSql,
        limit: rowLimit,
      },
    });
    setPending(false);
    if (settled._tag === "Failure") {
      setError(errorMessage(squashAtomCommandFailure(settled)));
      return;
    }
    setExecution({ sql: executedSql, result: settled.value.result });
    onRecordQuery(executedSql);
  };

  const addResultToChat = () => {
    if (execution === null) return;
    const composer = composerRef?.current;
    if (composer === undefined || composer === null) {
      toastManager.add({
        type: "error",
        title: "Unable to add query result",
        description: "Open a chat for this project and try again.",
      });
      return;
    }
    const inserted = composer.insertTextAtEnd(
      formatPowerhouseResultChatContext({ target, ...execution }),
      { ensureLeadingBoundary: true },
    );
    if (inserted) {
      composer.focusAtEnd();
      toastManager.add({ type: "success", title: "Query result added to chat" });
    } else {
      toastManager.add({
        type: "error",
        title: "Unable to add query result",
        description: "The active composer could not accept database context.",
      });
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div>
          <h2 className="text-xs font-medium">SQL console</h2>
          <p className="text-[.66rem] text-muted-foreground">
            Read-only · one statement · transaction always rolled back
          </p>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Close SQL console" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 @[42rem]:p-4">
        <div className="mx-auto max-w-5xl space-y-3">
          <div
            className="overflow-hidden rounded-lg border border-border/70 bg-card/50 focus-within:ring-2 focus-within:ring-ring/24"
            onKeyDownCapture={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void run();
              }
            }}
          >
            <CodeMirror
              value={draft}
              height="190px"
              theme={resolvedTheme}
              extensions={extensions}
              onChange={onDraftChange}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: false,
              }}
              aria-label="PostgreSQL query"
              className="text-xs [&_.cm-editor]:bg-transparent [&_.cm-gutters]:bg-muted/35"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[.68rem] text-muted-foreground">
                Rows
                <select
                  value={rowLimit}
                  onChange={(event) =>
                    onRowLimitChange(Number(event.target.value) as PowerhouseDatabaseRowLimit)
                  }
                  className="h-7 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {rowLimits.map((limit) => (
                    <option key={limit} value={limit}>
                      {limit}
                    </option>
                  ))}
                </select>
              </label>
              {history.length === 0 ? null : (
                <label className="flex min-w-0 items-center gap-1.5 text-[.68rem] text-muted-foreground">
                  <Clock3 aria-hidden className="size-3" />
                  <span className="sr-only">Query history</span>
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value.length > 0) onDraftChange(event.target.value);
                    }}
                    className="h-7 max-w-56 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">History</option>
                    {history.map((query) => (
                      <option key={query} value={query}>
                        {query.replaceAll(/\s+/g, " ").slice(0, 80)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Button size="sm" onClick={() => void run()} disabled={pending || draft.trim() === ""}>
              <Play aria-hidden className="size-3" />
              {pending ? "Running…" : "Run"}
              <kbd className="ml-1 hidden rounded border border-primary-foreground/25 px-1 font-mono text-[.58rem] opacity-75 sm:inline">
                {typeof navigator !== "undefined" && navigator.platform.includes("Mac")
                  ? "⌘"
                  : "Ctrl"}
                +Enter
              </kbd>
            </Button>
          </div>

          {error === null ? null : (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/6 px-3 py-2 text-xs text-destructive"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words font-mono">{error}</span>
            </div>
          )}

          {execution === null ? null : (
            <DatabaseResultTable
              result={execution.result}
              onAddToChat={addResultToChat}
              className="max-h-[60dvh]"
            />
          )}
        </div>
      </div>
    </section>
  );
}
