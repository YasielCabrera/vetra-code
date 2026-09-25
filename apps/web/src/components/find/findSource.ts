import { findSegmentMatches } from "./findScope.logic";

export const MATCH_HIGHLIGHT_NAME = "vetra-find-match";
export const CURRENT_MATCH_HIGHLIGHT_NAME = "vetra-find-current-match";

/**
 * Document styles do not reach into shadow roots, so surfaces that render there (Pierre)
 * add this to their shadow stylesheet. Matches `index.css`.
 */
export const FIND_HIGHLIGHT_UNSAFE_CSS = `::highlight(${MATCH_HIGHLIGHT_NAME}) {
  background-color: color-mix(in oklab, var(--warning) 30%, transparent);
}
::highlight(${CURRENT_MATCH_HIGHLIGHT_NAME}) {
  background-color: color-mix(in oklab, var(--warning) 70%, transparent);
}`;

// Chromium hit-tests up to a pixel into the neighbouring inline box at a span boundary.
const HIT_TEST_INSET_PX = 2;

/** Matches one surface found, in reading order. */
export interface FindResult {
  readonly count: number;
  readonly truncated: boolean;
  /** The painted text of each match, or null where the surface has not rendered it. */
  ranges(): ReadonlyArray<Range | null>;
  /** Bring one match on screen, rendering it first when the surface is virtualized. */
  reveal(index: number): void;
}

/**
 * A surface that renders only part of its text, so the scope searches the surface's own
 * text model instead of walking the DOM under `host`.
 */
export interface FindSource {
  find(host: Element, query: string, limit: number): FindResult;
  /** Calls back when the surface renders where the scope cannot observe, e.g. a shadow root. */
  observe?(host: Element, onRender: () => void): () => void;
}

function textNodesUnder(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

/** Ranges over consecutive text nodes, allowing a match to span the spans a highlighter split. */
export function textNodeRanges(
  nodes: ReadonlyArray<Text>,
  query: string,
  limit?: number,
): { readonly ranges: Range[]; readonly truncated: boolean } {
  const { matches, truncated } = findSegmentMatches(
    nodes.map((node) => node.data),
    query,
    limit,
  );
  const ranges = matches.map(({ start, end }) => {
    const range = document.createRange();
    range.setStart(nodes[start.segment]!, start.offset);
    range.setEnd(nodes[end.segment]!, end.offset);
    return range;
  });
  return { ranges, truncated };
}

/** Every match inside one rendered line, for surfaces that locate matches by line. */
export function lineRanges(line: Element, query: string): Range[] {
  return textNodeRanges(textNodesUnder(line), query).ranges;
}

/**
 * Hit-tests both ends, so a sticky header or the find bar painted over the match counts as
 * hidden. Shadow-rendered text hit-tests against its own shadow root.
 */
export function isRangeUnobscured(range: Range): boolean {
  const ancestor = range.commonAncestorContainer;
  const owner = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  if (owner === null) return false;
  const root = owner.getRootNode();
  const hitTarget = root instanceof ShadowRoot ? root : document;
  const target = range.getBoundingClientRect();
  const middle = target.top + target.height / 2;
  const inset = Math.min(HIT_TEST_INSET_PX, target.width / 2);
  return [target.left + inset, target.right - inset].every((x) => {
    const hit = hitTarget.elementFromPoint(x, middle);
    return hit !== null && owner.contains(hit);
  });
}
