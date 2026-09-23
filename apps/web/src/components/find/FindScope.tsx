import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
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

import { findSegmentMatches, MAX_FIND_MATCHES } from "./findScope.logic";

const MATCH_HIGHLIGHT_NAME = "vetra-find-match";
const CURRENT_MATCH_HIGHLIGHT_NAME = "vetra-find-current-match";
const DECORATIVE_TEXT_SELECTOR = '[aria-hidden="true"]';
// Chromium hit-tests up to a pixel into the neighbouring inline box at a span boundary.
const HIT_TEST_INSET_PX = 2;

interface FoundMatches {
  readonly query: string;
  readonly ranges: ReadonlyArray<Range>;
  readonly truncated: boolean;
}

const NO_MATCHES: FoundMatches = { query: "", ranges: [], truncated: false };

function searchableTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      return parent !== null &&
        parent.checkVisibility() &&
        parent.closest(DECORATIVE_TEXT_SELECTOR) === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function findMatches(root: Element, query: string): FoundMatches {
  const nodes = searchableTextNodes(root);
  const { matches, truncated } = findSegmentMatches(
    nodes.map((node) => node.data),
    query,
  );
  const ranges = matches.map(({ start, end }) => {
    const range = document.createRange();
    range.setStart(nodes[start.segment]!, start.offset);
    range.setEnd(nodes[end.segment]!, end.offset);
    return range;
  });
  return { query, ranges, truncated };
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

function rangeOwner(range: Range): Element | null {
  const ancestor = range.commonAncestorContainer;
  return ancestor instanceof Element ? ancestor : ancestor.parentElement;
}

/** Hit-tests both ends, so a sticky gutter or the find bar painted over the match counts as hidden. */
function isRangeUnobscured(range: Range, owner: Element): boolean {
  const target = range.getBoundingClientRect();
  const middle = target.top + target.height / 2;
  const inset = Math.min(HIT_TEST_INSET_PX, target.width / 2);
  return [target.left + inset, target.right - inset].every((x) => {
    const hit = document.elementFromPoint(x, middle);
    return hit !== null && owner.contains(hit);
  });
}

function revealRange(range: Range) {
  const owner = rangeOwner(range);
  if (owner === null || isRangeUnobscured(range, owner)) return;
  range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "center" });
}

function isFindShortcut(event: KeyboardEvent): boolean {
  const mod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
  return mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f";
}

function matchSummary(current: number, found: FoundMatches): string {
  if (found.ranges.length === 0) return "No results";
  const total = found.truncated ? `${MAX_FIND_MATCHES}+` : `${found.ranges.length}`;
  return `${current + 1} of ${total}`;
}

/** Editor-style find (mod+F) over the text rendered in `children` while focus is inside. */
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundMatches>(NO_MATCHES);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);

  const searching = open && query.length > 0;
  const shownMatches = searching && found.query === query ? found : NO_MATCHES;
  const current = Math.min(currentIndex, Math.max(shownMatches.ranges.length - 1, 0));

  useEffect(() => {
    const content = contentRef.current;
    if (!searching || content === null) return;
    let frame = 0;
    const collect = () => {
      frame = 0;
      setFound(findMatches(content, query));
    };
    collect();
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(collect);
    });
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [query, searching]);

  useEffect(() => {
    const matchHighlight = sharedHighlight(MATCH_HIGHLIGHT_NAME, 0);
    const currentHighlight = sharedHighlight(CURRENT_MATCH_HIGHLIGHT_NAME, 1);
    const currentRange = shownMatches.ranges[current];
    if (matchHighlight === null || currentHighlight === null) return;
    for (const range of shownMatches.ranges) matchHighlight.add(range);
    if (currentRange !== undefined) currentHighlight.add(currentRange);
    return () => {
      for (const range of shownMatches.ranges) matchHighlight.delete(range);
      if (currentRange !== undefined) currentHighlight.delete(currentRange);
    };
  }, [current, shownMatches]);

  useEffect(() => {
    const currentRange = shownMatches.ranges[current];
    if (!revealPendingRef.current || currentRange === undefined) return;
    revealPendingRef.current = false;
    revealRange(currentRange);
  }, [current, shownMatches]);

  useLayoutEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const step = (direction: 1 | -1) => {
    const count = shownMatches.ranges.length;
    if (count === 0) return;
    revealPendingRef.current = true;
    setCurrentIndex((current + direction + count) % count);
  };

  const close = () => {
    setOpen(false);
    setFound(NO_MATCHES);
    scopeRef.current?.focus({ preventScroll: true });
  };

  const onScopeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isFindShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open && query.length > 0) revealPendingRef.current = true;
      setOpen(true);
      setFocusRequest((request) => request + 1);
    } else if (open && event.key === "Escape") {
      event.preventDefault();
      close();
    }
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
              "min-w-16 px-1 text-[.65rem] whitespace-nowrap tabular-nums",
              query.length > 0 && shownMatches.ranges.length === 0
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
            disabled={shownMatches.ranges.length === 0}
            onClick={() => step(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Next match (Enter)"
            aria-label="Next match"
            disabled={shownMatches.ranges.length === 0}
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
      <div ref={contentRef} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
