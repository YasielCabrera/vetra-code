import { Suspense, use, useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

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
}

const MAX_HIGHLIGHTED_CODE_LENGTH = 100_000;
const CODE_LENGTH_FORMATTER = new Intl.NumberFormat();
const CODE_TEXT_CLASS = "font-mono text-[length:var(--font-size-code,0.8125rem)] leading-5";

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
        "sticky left-0 m-0 shrink-0 border-r border-border/60 bg-[var(--code-background)]",
        "py-2.5 pr-2 pl-3 text-right whitespace-pre select-none",
        "text-[color-mix(in_srgb,var(--code-foreground)_45%,transparent)]",
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

/**
 * Read-only highlighted code. It shares the diff/file theme and code-surface
 * tokens without mounting their virtualization and editing machinery.
 */
export function SdlBlock({ code, language, className, lineNumbers = false }: SdlBlockProps) {
  if (code.trim().length === 0) return null;
  const display = displayableCode(code);
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border/60 bg-[var(--code-background)] text-[var(--code-foreground)]",
        className,
      )}
      data-slot="powerhouse-code-block"
      data-language={language}
    >
      <div className={cn("flex overflow-x-auto", CODE_TEXT_CLASS)}>
        {lineNumbers ? <LineNumberGutter code={display.value} /> : null}
        <Suspense fallback={<PlainCode code={display.value} />}>
          <HighlightedCode code={display.value} language={language} />
        </Suspense>
      </div>
      {display.truncated ? (
        <p className="border-t border-border/60 px-3 py-2 text-[.65rem] text-muted-foreground">
          Preview limited to the first {CODE_LENGTH_FORMATTER.format(MAX_HIGHLIGHTED_CODE_LENGTH)}{" "}
          characters for performance.
        </p>
      ) : null}
    </div>
  );
}
