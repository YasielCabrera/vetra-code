import { Braces, Network } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Skeleton } from "~/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import { PowerhouseDisclosure } from "../PowerhousePanelPrimitives";
import { SdlBlock } from "../SdlBlock";

const LazySchemaDiagram = lazy(() =>
  import("./SchemaDiagram").then(({ SchemaDiagram }) => ({ default: SchemaDiagram })),
);

type SchemaViewMode = "sdl" | "diagram";

const VIEWS: ReadonlyArray<{
  readonly id: SchemaViewMode;
  readonly label: string;
  readonly Icon: typeof Braces;
}> = [
  { id: "sdl", label: "SDL", Icon: Braces },
  { id: "diagram", label: "Diagram", Icon: Network },
];

function SchemaViewControl({
  value,
  onChange,
}: {
  value: SchemaViewMode;
  onChange: (value: SchemaViewMode) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5"
      role="group"
      aria-label="Schema presentation"
    >
      {VIEWS.map(({ id, label, Icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Show ${label}`}
                aria-pressed={value === id}
                onClick={() => onChange(id)}
                className={cn(
                  "flex h-6 items-center gap-1 rounded-md px-1.5 text-[.65rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  value === id
                    ? "bg-background text-foreground shadow-xs dark:bg-input/64"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              />
            }
          >
            <Icon aria-hidden className="size-3" />
            <span className="hidden @[25rem]:inline">{label}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">Show {label}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}

function DiagramFallback() {
  return (
    <div
      className="flex h-[clamp(24rem,62vh,44rem)] items-center justify-center bg-[var(--code-background)]"
      role="status"
      aria-label="Preparing schema diagram"
    >
      <div className="flex w-44 flex-col items-center gap-2.5">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-2.5 w-24" />
        <span className="sr-only">Preparing schema diagram…</span>
      </div>
    </div>
  );
}

export function ModelSchemaView({
  title,
  code,
  defaultOpen = true,
}: {
  title: string;
  code: string;
  defaultOpen?: boolean;
}) {
  const [view, setView] = useState<SchemaViewMode>("sdl");
  const hasSchema = code.trim().length > 0;
  return (
    <PowerhouseDisclosure
      title={title}
      meta="GraphQL"
      defaultOpen={defaultOpen}
      contentClassName="p-0"
      action={hasSchema ? <SchemaViewControl value={view} onChange={setView} /> : undefined}
    >
      {!hasSchema ? (
        <p className="p-3 text-xs text-muted-foreground">No {title.toLocaleLowerCase()} schema.</p>
      ) : view === "sdl" ? (
        <SdlBlock code={code} language="graphql" className="rounded-none border-0" lineNumbers />
      ) : (
        <Suspense fallback={<DiagramFallback />}>
          <LazySchemaDiagram source={code} label={title} />
        </Suspense>
      )}
    </PowerhouseDisclosure>
  );
}
