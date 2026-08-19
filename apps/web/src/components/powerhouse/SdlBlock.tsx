import { Suspense, use, useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

interface SdlBlockProps {
  code: string;
  /** Shiki language; unsupported ones fall back to plain text inside the highlighter. */
  language: "graphql" | "json";
  className?: string | undefined;
}

const MAX_HIGHLIGHTED_CODE_LENGTH = 100_000;
const CODE_LENGTH_FORMATTER = new Intl.NumberFormat();

function displayableCode(code: string): { readonly value: string; readonly truncated: boolean } {
  if (code.length <= MAX_HIGHLIGHTED_CODE_LENGTH) return { value: code, truncated: false };
  let end = MAX_HIGHLIGHTED_CODE_LENGTH;
  const finalCodeUnit = code.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return { value: code.slice(0, end), truncated: true };
}

function HighlightedBlock({ code, language }: SdlBlockProps) {
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
        "overflow-x-auto font-mono text-[length:var(--font-size-code,0.8125rem)] leading-5",
        "[&_.shiki]:m-0 [&_.shiki]:w-max [&_.shiki]:min-w-full [&_.shiki]:bg-transparent!",
        "[&_.shiki]:px-3 [&_.shiki]:py-2.5 [&_.shiki]:font-mono [&_.shiki]:leading-5",
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PlainBlock({ code }: { code: string }) {
  return (
    <pre className="m-0 w-max min-w-full overflow-x-auto bg-transparent px-3 py-2.5 font-mono text-[length:var(--font-size-code,0.8125rem)] leading-5 whitespace-pre">
      <code>{code}</code>
    </pre>
  );
}

/**
 * Read-only highlighted code. It shares the diff/file theme and code-surface
 * tokens without mounting their virtualization and editing machinery.
 */
export function SdlBlock({ code, language, className }: SdlBlockProps) {
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
      <Suspense fallback={<PlainBlock code={display.value} />}>
        <HighlightedBlock code={display.value} language={language} />
      </Suspense>
      {display.truncated ? (
        <p className="border-t border-border/60 px-3 py-2 text-[.65rem] text-muted-foreground">
          Preview limited to the first {CODE_LENGTH_FORMATTER.format(MAX_HIGHLIGHTED_CODE_LENGTH)}{" "}
          characters for performance.
        </p>
      ) : null}
    </div>
  );
}
