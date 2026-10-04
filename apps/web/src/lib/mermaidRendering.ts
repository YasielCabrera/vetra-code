import { LRUCache } from "./lruCache";

export type MermaidTheme = "light" | "dark";

export type MermaidOutcome =
  | { readonly kind: "diagram"; readonly svg: string }
  | { readonly kind: "error"; readonly message: string };

type Mermaid = typeof import("mermaid").default;

export const MAX_CACHED_MERMAID_DIAGRAMS = 64;
const MAX_CACHED_MERMAID_BYTES = 16 * 1024 * 1024;

// Caches the promise itself: React's use() marks it settled in place, so a block
// the virtualized timeline remounts reads its diagram without suspending.
const diagramCache = new LRUCache<Promise<MermaidOutcome>>(
  MAX_CACHED_MERMAID_DIAGRAMS,
  MAX_CACHED_MERMAID_BYTES,
);

let mermaidPromise: Promise<Mermaid> | null = null;
let renderTail: Promise<unknown> = Promise.resolve();
let nextDiagramId = 0;

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then(
    (module) => module.default,
    (error: unknown) => {
      mermaidPromise = null;
      throw error;
    },
  );
  return mermaidPromise;
}

async function renderSvg(mermaid: Mermaid, source: string, theme: MermaidTheme): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // A diagram's own config could set either to CSS that escapes the diagram's
    // scope and restyles the app (a global @keyframes, for one).
    secure: [...(mermaid.mermaidAPI.defaultConfig.secure ?? []), "themeCSS", "fontFamily"],
    suppressErrorRendering: true,
    theme: theme === "dark" ? "dark" : "default",
  });
  nextDiagramId += 1;
  const { svg } = await mermaid.render(`vetra-mermaid-${nextDiagramId}`, source);
  return svg;
}

function errorOutcome(error: unknown): MermaidOutcome {
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}

/** Renders `source` once per theme; the promise never rejects. */
export function renderMermaidDiagram(source: string, theme: MermaidTheme): Promise<MermaidOutcome> {
  const key = `${theme}\n${source}`;
  const cached = diagramCache.get(key);
  if (cached) return cached;

  const outcome = loadMermaid().then(
    (mermaid) => {
      // initialize() is global, so a render must finish before the next one sets its theme.
      const svg = renderTail.then(() => renderSvg(mermaid, source, theme));
      renderTail = svg.catch(() => undefined);
      return svg.then((rendered): MermaidOutcome => {
        diagramCache.set(key, outcome, (key.length + rendered.length) * 2);
        return { kind: "diagram", svg: rendered };
      }, errorOutcome);
    },
    (error: unknown) => {
      // A chunk that failed to load says nothing about this diagram, so the next render retries.
      diagramCache.delete(key);
      return errorOutcome(error);
    },
  );
  diagramCache.set(key, outcome, key.length * 2);
  return outcome;
}
