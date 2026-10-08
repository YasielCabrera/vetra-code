import { DIFFS_TAG_NAME, VirtualizedFile } from "@pierre/diffs";
import type { FileOptions } from "@pierre/diffs/react";
import { useCallback, useMemo } from "react";

import { resolveCenteredFileLineScrollTop } from "~/components/files/fileLineReveal";

import { findLineOccurrences } from "./findScope.logic";
import { isRangeUnobscured, lineRanges, type FindResult, type FindSource } from "./findSource";
import { fileFindLines } from "./pierreFind.logic";

const OBSERVED_MUTATIONS = { childList: true, subtree: true, characterData: true };

interface LineHit {
  /** Identifies the rendered `[data-line]` element that holds the match. */
  readonly key: string;
  readonly occurrence: number;
}

/** Pierre renders into shadow roots, including ones it adds while scrolling; watch them all. */
function observePierreRenders(host: Element, onRender: () => void): () => void {
  const observed = new WeakSet<ShadowRoot>();
  const observer = new MutationObserver(() => {
    observeShadowRoots();
    onRender();
  });
  function observeShadowRoots() {
    for (const element of host.querySelectorAll(DIFFS_TAG_NAME)) {
      const root = element.shadowRoot;
      if (root === null || observed.has(root)) continue;
      observed.add(root);
      observer.observe(root, OBSERVED_MUTATIONS);
    }
  }
  observer.observe(host, { childList: true, subtree: true });
  observeShadowRoots();
  return () => observer.disconnect();
}

function paintLineHits(
  hits: ReadonlyArray<LineHit>,
  lineElements: ReadonlyMap<string, Element>,
  query: string,
): Array<Range | null> {
  const rangesByLine = new Map<Element, Range[]>();
  return hits.map(({ key, occurrence }) => {
    const element = lineElements.get(key);
    if (element === undefined) return null;
    let ranges = rangesByLine.get(element);
    if (ranges === undefined) {
      ranges = lineRanges(element, query);
      rangesByLine.set(element, ranges);
    }
    return ranges[occurrence] ?? null;
  });
}

function lineResult<Hit extends LineHit>(
  hits: ReadonlyArray<Hit>,
  truncated: boolean,
  query: string,
  renderedLines: () => ReadonlyMap<string, Element>,
  scrollToLine: (hit: Hit) => void,
): FindResult {
  return {
    count: hits.length,
    truncated,
    ranges: () => paintLineHits(hits, renderedLines(), query),
    reveal: (index) => {
      const hit = hits[index];
      if (hit === undefined) return;
      const [range] = paintLineHits([hit], renderedLines(), query);
      if (range != null && isRangeUnobscured(range)) return;
      scrollToLine(hit);
    },
  };
}

/** The file each Pierre container last rendered, which places lines not in the DOM yet. */
const renderedFiles = new WeakMap<Element, VirtualizedFile<unknown, undefined>>();

/** Searches a file Pierre renders in a `Virtualizer`, rendered with `usePierreFileFindSource`. */
function pierreFileFindSource(contents: string): FindSource {
  // Split on the first search: an edited file remakes its source on every keystroke.
  let lines: string[] | undefined;
  return {
    observe: observePierreRenders,
    find: (host, query, limit) => {
      lines ??= fileFindLines(contents);
      const { matches, truncated } = findLineOccurrences(lines, query, limit);
      const hits = matches.map(({ line, occurrence }) => ({ key: `${line + 1}`, occurrence }));
      const renderedLines = () => {
        const root = host.querySelector(DIFFS_TAG_NAME)?.shadowRoot;
        const elements = new Map<string, Element>();
        for (const element of root?.querySelectorAll("[data-code] [data-line]") ?? []) {
          elements.set(element.getAttribute("data-line") ?? "", element);
        }
        return elements;
      };
      return lineResult(hits, truncated, query, renderedLines, ({ key }) => {
        const container = host.querySelector<HTMLElement>(DIFFS_TAG_NAME);
        const file = container === null ? undefined : renderedFiles.get(container);
        const root = file?.getEditorViewport();
        const scroller = root instanceof Document ? root.documentElement : root;
        const line = file?.getLinePosition(Number(key));
        if (container === null || scroller === undefined || line === undefined) return;
        const viewport = scroller.getBoundingClientRect();
        scroller.scrollTop = resolveCenteredFileLineScrollTop({
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          viewportTop: viewport.top,
          viewportHeight: scroller.clientHeight,
          fileTop: scroller.scrollTop + container.getBoundingClientRect().top - viewport.top,
          estimatedLine: line,
        });
      });
    },
  };
}

type FilePostRender<LAnnotation> = NonNullable<FileOptions<LAnnotation, undefined>["onPostRender"]>;

/**
 * Find for a Pierre file surface: host its `Virtualizer` in `FindSourceHost` with `source`,
 * and render the file with the returned `onPostRender`, which chains `onPostRender`.
 */
export function usePierreFileFindSource<LAnnotation>(
  contents: string,
  onPostRender?: FilePostRender<LAnnotation>,
) {
  const source = useMemo(() => pierreFileFindSource(contents), [contents]);
  const trackPostRender = useCallback<FilePostRender<LAnnotation>>(
    (container, instance, phase) => {
      if (phase !== "unmount" && instance instanceof VirtualizedFile) {
        renderedFiles.set(container, instance);
      } else {
        renderedFiles.delete(container);
      }
      onPostRender?.(container, instance, phase);
    },
    [onPostRender],
  );
  return { source, onPostRender: trackPostRender };
}
