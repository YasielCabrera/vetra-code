import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn, isMacPlatform } from "~/lib/utils";

import { MAX_FIND_MATCHES } from "./findScope.logic";
import {
  CURRENT_MATCH_HIGHLIGHT_NAME,
  isRangeUnobscured,
  MATCH_HIGHLIGHT_NAME,
  textNodeRanges,
  type FindResult,
  type FindSource,
} from "./findSource";

const DECORATIVE_TEXT_SELECTOR = '[aria-hidden="true"]';
const OBSERVED_MUTATIONS = { childList: true, subtree: true, characterData: true };

type RegisterFindSource = (host: Element, source: FindSource) => () => void;

const FindSourceContext = createContext<RegisterFindSource | null>(null);

interface FoundMatches {
  readonly query: string;
  /** DOM text runs and registered sources, in reading order. */
  readonly parts: ReadonlyArray<FindResult>;
  readonly count: number;
  readonly truncated: boolean;
}

const NO_MATCHES: FoundMatches = { query: "", parts: [], count: 0, truncated: false };

function domTextResult(nodes: ReadonlyArray<Text>, query: string, limit: number): FindResult {
  const { ranges, truncated } = textNodeRanges(nodes, query, limit);
  return {
    count: ranges.length,
    truncated,
    ranges: () => ranges,
    reveal: (index) => {
      const range = ranges[index];
      if (range === undefined || isRangeUnobscured(range)) return;
      range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "center" });
    },
  };
}

/** Walks rendered text in reading order and lets each registered host's source search itself. */
function findMatches(
  root: Element,
  sources: ReadonlyMap<Element, FindSource>,
  query: string,
): FoundMatches {
  const parts: FindResult[] = [];
  let count = 0;
  let truncated = false;
  let run: Text[] = [];
  const add = (part: FindResult) => {
    parts.push(part);
    count += part.count;
    truncated ||= part.truncated;
  };
  const flushRun = () => {
    if (run.length > 0 && !truncated) add(domTextResult(run, query, MAX_FIND_MATCHES - count));
    run = [];
  };
  const visit = (parent: Element) => {
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
      if (truncated) return;
      if (node.nodeType === Node.TEXT_NODE) {
        run.push(node as Text);
      } else if (node instanceof Element) {
        const source = sources.get(node);
        if (source !== undefined) {
          flushRun();
          if (!truncated) add(source.find(node, query, MAX_FIND_MATCHES - count));
        } else if (node.checkVisibility() && !node.matches(DECORATIVE_TEXT_SELECTOR)) {
          visit(node);
        }
      }
    }
  };
  visit(root);
  flushRun();
  return { query, parts, count, truncated };
}

function locateMatch(found: FoundMatches, index: number) {
  let offset = index;
  for (const part of found.parts) {
    if (offset < part.count) return { part, index: offset };
    offset -= part.count;
  }
  return null;
}

/** One registry entry per name, shared so several open scopes can highlight at once. */
function sharedHighlight(name: string, priority: number): Highlight | null {
  if (typeof CSS === "undefined" || CSS.highlights === undefined) return null;
  const existing = CSS.highlights.get(name);
  if (existing !== undefined) return existing;
  const created = new Highlight();
  created.priority = priority;
  CSS.highlights.set(name, created);
  return created;
}

function isFindShortcut(event: KeyboardEvent): boolean {
  const mod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
  return mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f";
}

function matchSummary(current: number, found: FoundMatches): string {
  if (found.count === 0) return "No results";
  const total = found.truncated ? `${MAX_FIND_MATCHES}+` : `${found.count}`;
  return `${current + 1} of ${total}`;
}

/**
 * Hands the text under `children` to `source` instead of the scope's DOM walk. Use it around
 * virtualized surfaces, whose DOM holds only the rendered window of their text. It renders
 * no box, so it can wrap a surface without changing its layout.
 */
export function FindSourceHost({
  source,
  children,
}: {
  source: FindSource | null;
  children: ReactNode;
}) {
  const register = useContext(FindSourceContext);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (register === null || host === null || source === null) return;
    return register(host, source);
  }, [host, register, source]);
  return (
    <div ref={setHost} className="contents">
      {children}
    </div>
  );
}

/**
 * Editor-style find (mod+F) over the text rendered in `children` while focus is inside.
 * The shortcut is taken in the capture phase so editors inside do not open their own panel.
 */
export function FindScope({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealPendingRef = useRef(false);
  const [sources, setSources] = useState<ReadonlyMap<Element, FindSource>>(() => new Map());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundMatches>(NO_MATCHES);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);

  const searching = open && query.length > 0;
  const shownMatches = searching && found.query === query ? found : NO_MATCHES;
  const current = Math.min(currentIndex, Math.max(shownMatches.count - 1, 0));

  const registerSource = useCallback<RegisterFindSource>((host, source) => {
    setSources((previous) => new Map(previous).set(host, source));
    return () =>
      setSources((previous) => {
        if (previous.get(host) !== source) return previous;
        const next = new Map(previous);
        next.delete(host);
        return next;
      });
  }, []);

  // Text changes outside a source re-run the search. A source rendering a different window of
  // the same text only needs repainting, which a new identity for the same matches triggers.
  useEffect(() => {
    const content = contentRef.current;
    if (!searching || content === null) return;
    let collectFrame = 0;
    let paintFrame = 0;
    const collect = () => {
      collectFrame = 0;
      setFound(findMatches(content, sources, query));
    };
    const repaint = () => {
      if (paintFrame !== 0) return;
      paintFrame = requestAnimationFrame(() => {
        paintFrame = 0;
        setFound((previous) => ({ ...previous }));
      });
    };
    const isInsideSource = (node: Node) => {
      for (let ancestor: Node | null = node; ancestor !== content; ancestor = ancestor.parentNode) {
        if (ancestor === null) return false;
        if (ancestor instanceof Element && sources.has(ancestor)) return true;
      }
      return false;
    };
    collect();
    const observer = new MutationObserver((records) => {
      if (records.every((record) => isInsideSource(record.target))) repaint();
      else if (collectFrame === 0) collectFrame = requestAnimationFrame(collect);
    });
    observer.observe(content, OBSERVED_MUTATIONS);
    const stopSources = Array.from(sources, ([host, source]) => source.observe?.(host, repaint));
    return () => {
      observer.disconnect();
      for (const stop of stopSources) stop?.();
      cancelAnimationFrame(collectFrame);
      cancelAnimationFrame(paintFrame);
    };
  }, [query, searching, sources]);

  useEffect(() => {
    const matchHighlight = sharedHighlight(MATCH_HIGHLIGHT_NAME, 0);
    const currentHighlight = sharedHighlight(CURRENT_MATCH_HIGHLIGHT_NAME, 1);
    if (matchHighlight === null || currentHighlight === null) return;
    const painted: Range[] = [];
    let currentRange: Range | null = null;
    let offset = 0;
    for (const part of shownMatches.parts) {
      for (const [index, range] of part.ranges().entries()) {
        if (range === null) continue;
        painted.push(range);
        if (offset + index === current) currentRange = range;
      }
      offset += part.count;
    }
    for (const range of painted) matchHighlight.add(range);
    if (currentRange !== null) currentHighlight.add(currentRange);
    return () => {
      for (const range of painted) matchHighlight.delete(range);
      if (currentRange !== null) currentHighlight.delete(currentRange);
    };
  }, [current, shownMatches]);

  useEffect(() => {
    const match = locateMatch(shownMatches, current);
    if (!revealPendingRef.current || match === null) return;
    revealPendingRef.current = false;
    match.part.reveal(match.index);
  }, [current, shownMatches]);

  useLayoutEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const step = (direction: 1 | -1) => {
    const count = shownMatches.count;
    if (count === 0) return;
    revealPendingRef.current = true;
    setCurrentIndex((current + direction + count) % count);
  };

  const close = () => {
    setOpen(false);
    setFound(NO_MATCHES);
    scopeRef.current?.focus({ preventScroll: true });
  };

  const onScopeKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isFindShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!open && query.length > 0) revealPendingRef.current = true;
    setOpen(true);
    setFocusRequest((request) => request + 1);
  };

  const onScopeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    close();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  };

  return (
    <div
      ref={scopeRef}
      tabIndex={-1}
      onKeyDownCapture={onScopeKeyDownCapture}
      onKeyDown={onScopeKeyDown}
      className={cn("relative flex min-h-0 flex-col outline-none", className)}
    >
      {open ? (
        <div
          role="search"
          className="absolute top-2 right-4 z-30 flex items-center gap-1 rounded-lg border border-border/70 bg-popover p-1 shadow-md"
        >
          <Input
            ref={inputRef}
            size="compact"
            type="search"
            aria-label="Find"
            placeholder="Find"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              revealPendingRef.current = true;
              setCurrentIndex(0);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={onInputKeyDown}
            className="w-44"
          />
          <span
            aria-live="polite"
            className={cn(
              "min-w-16 px-1 text-3xs whitespace-nowrap tabular-nums",
              query.length > 0 && shownMatches.count === 0
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {query.length === 0 ? "" : matchSummary(current, shownMatches)}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            disabled={shownMatches.count === 0}
            onClick={() => step(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Next match (Enter)"
            aria-label="Next match"
            disabled={shownMatches.count === 0}
            onClick={() => step(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Close (Escape)"
            aria-label="Close find"
            onClick={close}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}
      <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
        <FindSourceContext value={registerSource}>{children}</FindSourceContext>
      </div>
    </div>
  );
}
