import {
  memo,
  Suspense,
  use,
  useDeferredValue,
  useMemo,
  type MouseEvent,
  type ReactNode,
} from "react";

import { renderMermaidDiagram, type MermaidTheme } from "../lib/mermaidRendering";

/**
 * Shows a Mermaid diagram in place of `children`, the block's highlighted source.
 * The source stays visible until `enabled` and while Mermaid loads, and comes back
 * with the error underneath when the diagram does not parse.
 */
export function MermaidBlock({
  source,
  theme,
  enabled,
  children,
}: {
  source: string;
  theme: MermaidTheme;
  enabled: boolean;
  children: ReactNode;
}) {
  // Deferred so a newly closed fence, an edit, or a theme switch keeps the current
  // view on screen until the next diagram is ready.
  const deferredSource = useDeferredValue(enabled ? source : null);
  const deferredTheme = useDeferredValue(theme);
  return (
    <Suspense fallback={children}>
      {deferredSource === null ? (
        children
      ) : (
        <MermaidDiagram source={deferredSource} theme={deferredTheme}>
          {children}
        </MermaidDiagram>
      )}
    </Suspense>
  );
}

function MermaidDiagram({
  source,
  theme,
  children,
}: {
  source: string;
  theme: MermaidTheme;
  children: ReactNode;
}) {
  // Pinned per instance so a mounted diagram never suspends again after cache eviction.
  const outcome = use(useMemo(() => renderMermaidDiagram(source, theme), [source, theme]));
  if (outcome.kind === "error") {
    return (
      <>
        {children}
        <div className="border-t border-border/70 px-3.5 py-2 font-mono text-2xs whitespace-pre-wrap text-destructive">
          {outcome.message}
        </div>
      </>
    );
  }
  return <MermaidSvg svg={outcome.svg} />;
}

// A diagram's `click` links are inert: they would navigate the app's own tab.
function preventLinkActivation(event: MouseEvent<HTMLDivElement>) {
  if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
}

const MermaidSvg = memo(function MermaidSvg({ svg }: { svg: string }) {
  return (
    <div
      className="overflow-x-auto px-3.5 py-3 [overflow-wrap:normal] [scrollbar-width:thin] [word-break:normal] [&_*]:animate-none!"
      onClick={preventLinkActivation}
      onAuxClick={preventLinkActivation}
      // Mermaid sanitizes the SVG under securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
