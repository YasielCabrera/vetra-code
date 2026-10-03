import type { PowerhouseDatabaseQueryResult } from "@t3tools/contracts";
import { MessageSquarePlus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

function withOccurrenceKeys<T>(items: ReadonlyArray<T>, signature: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const value = signature(item);
    const occurrence = occurrences.get(value) ?? 0;
    occurrences.set(value, occurrence + 1);
    return { item, key: `${value}\0${occurrence}` };
  });
}

export function DatabaseResultTable({
  result,
  onAddToChat,
  className,
}: {
  result: PowerhouseDatabaseQueryResult;
  onAddToChat?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const columns = withOccurrenceKeys(
    result.columns,
    (column) => `${column.name}\0${column.dataType}`,
  );
  const rows = withOccurrenceKeys(result.rows, (row) => JSON.stringify(row));

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {result.rows.length.toLocaleString()} row{result.rows.length === 1 ? "" : "s"} ·{" "}
          {result.elapsedMs.toLocaleString()} ms
        </span>
        {onAddToChat === undefined ? null : (
          <Button size="xs" variant="ghost" onClick={onAddToChat}>
            <MessageSquarePlus aria-hidden className="size-3" />
            Add result to chat
          </Button>
        )}
      </div>
      <div className="min-h-0 max-w-full flex-1 overflow-auto rounded-lg border border-border/70">
        <table className="w-max min-w-full border-collapse font-mono text-2xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="sticky top-0 z-10 w-10 border-r border-b border-border/60 bg-muted px-2 py-1.5 text-right font-normal">
                #
              </th>
              {columns.map(({ item: column, key }, index) => (
                <th
                  key={key}
                  className="sticky top-0 z-10 min-w-28 border-r border-b border-border/60 bg-muted px-2.5 py-1.5 font-medium last:border-r-0"
                >
                  <span className="block max-w-64 truncate text-foreground">
                    {column.name || `(column ${index + 1})`}
                  </span>
                  <span className="block max-w-64 truncate text-3xs font-normal opacity-70">
                    {column.dataType}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item: row, key }, rowIndex) => (
              <tr
                key={key}
                className="odd:bg-muted/15 hover:bg-accent/35 [content-visibility:auto]"
              >
                <td className="border-r border-b border-border/45 px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                  {rowIndex + 1}
                </td>
                {columns.map(({ item: column, key: columnKey }, columnIndex) => {
                  const value = row[columnIndex] ?? null;
                  return (
                    <td
                      key={columnKey}
                      className="max-w-96 border-r border-b border-border/45 p-0 last:border-r-0"
                    >
                      {value === null ? (
                        <span className="block truncate px-2.5 py-1.5 italic text-muted-foreground/65">
                          NULL
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="block w-full truncate px-2.5 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          aria-label={`Copy ${column.name || `column ${columnIndex + 1}`} cell`}
                          onClick={() => void writeTextToClipboard(value, "database cell")}
                        >
                          {value}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated ? (
        <p className="shrink-0 text-2xs text-warning-foreground">
          Showing the first {result.rowLimit} rows. Increase the row limit or narrow the query.
        </p>
      ) : null}
    </div>
  );
}
