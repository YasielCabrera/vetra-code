import { ChevronDown, ChevronRight } from "lucide-react";
import { Suspense, use, useId, useMemo, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

import { sdlFoldRanges, type SdlFoldRange } from "./sdlFolding";
import { countCodeLines, lineNumberGutterText } from "./sdlLineNumbers";

interface CodeProps {
  code: string;
  /** Shiki language; unsupported ones fall back to plain text inside the highlighter. */
  language: "graphql" | "json";
}

interface SdlBlockProps extends CodeProps {
  className?: string | undefined;
  /** Adds a sticky gutter so readers can cite a line by number elsewhere. */
  lineNumbers?: boolean;
  /** Adds per-declaration fold controls to the GraphQL line-number gutter. */
  collapsible?: boolean;
}

const MAX_HIGHLIGHTED_CODE_LENGTH = 100_000;
const CODE_LENGTH_FORMATTER = new Intl.NumberFormat();
const CODE_TEXT_CLASS = "font-mono text-(length:--font-size-code,0.8125rem) leading-5";

function displayableCode(code: string): { readonly value: string; readonly truncated: boolean } {
  if (code.length <= MAX_HIGHLIGHTED_CODE_LENGTH) return { value: code, truncated: false };
  let end = MAX_HIGHLIGHTED_CODE_LENGTH;
  const finalCodeUnit = code.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return { value: code.slice(0, end), truncated: true };
}

/** Stays put while the code scrolls sideways so a number always names its line. */
function LineNumberGutter({ code }: { code: string }) {
  const text = useMemo(() => lineNumberGutterText(countCodeLines(code)), [code]);
  return (
    <pre
      aria-hidden
      data-slot="powerhouse-code-gutter"
      className={cn(
        "sticky left-0 m-0 shrink-0 border-r border-border/60 bg-code",
        "py-2.5 pr-2 pl-3 text-right whitespace-pre select-none",
        "text-code-foreground/45",
        CODE_TEXT_CLASS,
      )}
    >
      {text}
    </pre>
  );
}

function HighlightedCode({ code, language }: CodeProps) {
  const { resolvedTheme } = useTheme();
  const themeName = resolveDiffThemeName(resolvedTheme);
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const html = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: themeName });
    } catch {
      return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
    }
  }, [code, highlighter, language, themeName]);

  return (
    <div
      className={cn(
        "flex-1 [&_.shiki]:m-0 [&_.shiki]:w-max [&_.shiki]:min-w-full [&_.shiki]:bg-transparent!",
        "[&_.shiki]:px-3 [&_.shiki]:py-2.5 [&_.shiki]:font-mono [&_.shiki]:leading-5",
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PlainCode({ code }: { code: string }) {
  return (
    <pre className={cn("m-0 flex-1 bg-transparent px-3 py-2.5 whitespace-pre", CODE_TEXT_CLASS)}>
      <code>{code}</code>
    </pre>
  );
}

function StaticCodeView({
  code,
  language,
  lineNumbers,
  plain = false,
}: CodeProps & { lineNumbers: boolean; plain?: boolean }) {
  return (
    <div className={cn("flex overflow-x-auto", CODE_TEXT_CLASS)}>
      {lineNumbers ? <LineNumberGutter code={code} /> : null}
      {plain ? <PlainCode code={code} /> : <HighlightedCode code={code} language={language} />}
    </div>
  );
}

function isHiddenFoldLine(line: number, collapsedRanges: ReadonlyArray<SdlFoldRange>): boolean {
  return collapsedRanges.some((range) => line > range.startLine && line <= range.endLine);
}

function CollapsibleLineNumberGutter({
  lineCount,
  ranges,
  collapsedIds,
  onToggle,
}: {
  lineCount: number;
  ranges: ReadonlyArray<SdlFoldRange>;
  collapsedIds: ReadonlySet<string>;
  onToggle: (range: SdlFoldRange) => void;
}) {
  const rangeByStartLine = useMemo(
    () => new Map(ranges.map((range) => [range.startLine, range])),
    [ranges],
  );
  const collapsedRanges = useMemo(
    () => ranges.filter((range) => collapsedIds.has(range.id)),
    [collapsedIds, ranges],
  );
  const rows = [];
  for (let line = 1; line <= lineCount; line += 1) {
    if (isHiddenFoldLine(line, collapsedRanges)) continue;
    const range = rangeByStartLine.get(line);
    const collapsed = range === undefined ? false : collapsedIds.has(range.id);
    const action = collapsed ? "Expand" : "Collapse";
    rows.push(
      <div key={line} className="flex h-5 items-center justify-end gap-0.5">
        {range === undefined ? (
          <span aria-hidden className="size-4 shrink-0" />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`${action} ${range.label}, lines ${range.startLine} through ${range.endLine}`}
                  aria-expanded={!collapsed}
                  onClick={() => onToggle(range)}
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm text-code-foreground/55 outline-none hover:bg-accent/60 hover:text-code-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              {collapsed ? (
                <ChevronRight aria-hidden className="size-3" />
              ) : (
                <ChevronDown aria-hidden className="size-3" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="right">
              {action} {range.label}
            </TooltipPopup>
          </Tooltip>
        )}
        <span aria-hidden className="min-w-[3ch] text-right tabular-nums">
          {line}
        </span>
      </div>,
    );
  }

  return (
    <div
      data-slot="powerhouse-code-gutter"
      className={cn(
        "sticky left-0 z-10 m-0 shrink-0 border-r border-border/60 bg-code",
        "py-2.5 pr-2 pl-2 whitespace-nowrap select-none",
        "text-code-foreground/45",
        CODE_TEXT_CLASS,
      )}
    >
      {rows}
    </div>
  );
}

function collapsedFoldCss(scopeId: string, ranges: ReadonlyArray<SdlFoldRange>): string {
  if (ranges.length === 0) return "";
  const scope = `[data-fold-scope=${JSON.stringify(scopeId)}] .shiki code > .line`;
  return ranges
    .map(
      (range) => `${scope}:nth-child(n+${range.startLine + 1}):nth-child(-n+${range.endLine}) {
  display: none;
}
${scope}:nth-child(${range.startLine})::after {
  color: color-mix(in srgb, var(--code-foreground) 62%, transparent);
  content: " … }";
}`,
    )
    .join("\n");
}

function CollapsibleCodeView({ code, language }: CodeProps) {
  const scopeId = useId();
  const ranges = useMemo(() => sdlFoldRanges(code), [code]);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const collapsedRanges = useMemo(
    () => ranges.filter((range) => collapsedIds.has(range.id)),
    [collapsedIds, ranges],
  );
  const foldCss = useMemo(
    () => collapsedFoldCss(scopeId, collapsedRanges),
    [collapsedRanges, scopeId],
  );
  const toggle = (range: SdlFoldRange) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(range.id)) next.delete(range.id);
      else next.add(range.id);
      return next;
    });
  };

  if (ranges.length === 0) {
    return <StaticCodeView code={code} language={language} lineNumbers />;
  }

  return (
    <div
      data-fold-scope={scopeId}
      className={cn(
        "flex overflow-x-auto [&_.shiki_.line]:min-h-5 [&_.shiki_code]:flex [&_.shiki_code]:flex-col",
        CODE_TEXT_CLASS,
      )}
    >
      {foldCss.length === 0 ? null : <style>{foldCss}</style>}
      <CollapsibleLineNumberGutter
        lineCount={countCodeLines(code)}
        ranges={ranges}
        collapsedIds={collapsedIds}
        onToggle={toggle}
      />
      <HighlightedCode code={code} language={language} />
    </div>
  );
}

/**
 * Read-only highlighted code. It shares the diff/file theme and code-surface
 * tokens without mounting their virtualization and editing machinery.
 */
export function SdlBlock({
  code,
  language,
  className,
  lineNumbers = false,
  collapsible = false,
}: SdlBlockProps) {
  if (code.trim().length === 0) return null;
  const display = displayableCode(code);
  const canCollapse = collapsible && lineNumbers && language === "graphql";
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border/60 bg-code text-code-foreground",
        className,
      )}
      data-slot="powerhouse-code-block"
      data-language={language}
    >
      <Suspense
        fallback={
          <StaticCodeView
            code={display.value}
            language={language}
            lineNumbers={lineNumbers}
            plain
          />
        }
      >
        {canCollapse ? (
          <CollapsibleCodeView key={display.value} code={display.value} language={language} />
        ) : (
          <StaticCodeView code={display.value} language={language} lineNumbers={lineNumbers} />
        )}
      </Suspense>
      {display.truncated ? (
        <p className="border-t border-border/60 px-3 py-2 text-3xs text-muted-foreground">
          Preview limited to the first {CODE_LENGTH_FORMATTER.format(MAX_HIGHLIGHTED_CODE_LENGTH)}{" "}
          characters for performance.
        </p>
      ) : null}
    </div>
  );
}
