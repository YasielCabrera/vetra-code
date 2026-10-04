import type { TicketPlanAnchor, TicketPlanCommentId } from "@t3tools/contracts";
import {
  anchorFromRenderedSelection,
  type PlanCommentThread,
} from "@t3tools/shared/ticketPlanAnchors";
import { MessageSquarePlusIcon } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { resolveAssistantCitationRanges } from "../../lib/assistantTextSelection";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { type PlanBlockKind, PLAN_SOURCE_SELECTOR, planSourceSpan } from "./TicketMarkdownBody";
import { TicketPlanSelectionComment } from "./TicketPlanSelectionComment";

const OPEN_HIGHLIGHT = "vetra-plan-comment";
const FOCUSED_HIGHLIGHT = "vetra-plan-comment-focused";

export const PLAN_BLOCK_LABELS: Record<PlanBlockKind, string> = {
  diagram: "diagram",
  code: "code block",
  image: "image",
};

export interface PlanCommentDraft {
  readonly anchor: TicketPlanAnchor;
  readonly range: Range | null;
  /** Set when the comment is about a whole block. */
  readonly kind: PlanBlockKind | null;
}

export interface PlanCommentSurfaceHandle {
  /** Scrolls the plan to a thread's passage, or to its block when the passage is not marked. */
  readonly scrollToThread: (thread: PlanCommentThread) => void;
}

type PlanBlock = {
  readonly element: HTMLElement;
  readonly kind: PlanBlockKind;
  readonly top: number;
};

function measureBlocks(surface: HTMLElement, root: HTMLElement): Array<PlanBlock> {
  const top = surface.getBoundingClientRect().top;
  return (
    [...root.querySelectorAll<HTMLElement>("[data-plan-block]")]
      // A code block still loading also marks its placeholder inside.
      .filter((element) => element.parentElement?.closest("[data-plan-block]") === null)
      .map((element) => ({
        element,
        kind: element.getAttribute("data-plan-block") as PlanBlockKind,
        top: element.getBoundingClientRect().top - top,
      }))
  );
}

function blockAt(root: HTMLElement, offset: number): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(PLAN_SOURCE_SELECTOR)) {
    const span = planSourceSpan(element);
    if (span.start <= offset && offset < span.end) return element;
  }
  return null;
}

function contentsRange(element: Element): Range {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return range;
}

function containsPoint(range: Range, x: number, y: number): boolean {
  for (const rect of range.getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
  }
  return false;
}

function sameRanges(
  previous: ReadonlyMap<TicketPlanCommentId, Range>,
  next: ReadonlyMap<TicketPlanCommentId, Range>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [id, range] of next) {
    const kept = previous.get(id);
    if (
      kept === undefined ||
      kept.startContainer !== range.startContainer ||
      kept.startOffset !== range.startOffset ||
      kept.endContainer !== range.endContainer ||
      kept.endOffset !== range.endOffset
    ) {
      return false;
    }
  }
  return true;
}

/** One named highlight holding `ranges`, removed again on cleanup. */
function showHighlight(name: string, ranges: ReadonlyArray<Range>, priority: number) {
  if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) {
    return () => {};
  }
  const highlight = new Highlight(...ranges);
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
  return () => {
    if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
  };
}

/**
 * The rendered plan with its comments on it: a Comment button for a text selection, a margin
 * button on each diagram, code block and image, and a highlight on each open comment's passage.
 * Clicking a highlight focuses its thread.
 */
export function TicketPlanCommentSurface({
  ref,
  body,
  revision,
  threads,
  focusedId,
  draft,
  onDraft,
  onFocusThread,
  children,
}: {
  readonly ref: Ref<PlanCommentSurfaceHandle>;
  /** The body the document renders; source offsets point into it. */
  readonly body: string;
  readonly revision: number;
  /** Open threads, in document order. */
  readonly threads: ReadonlyArray<PlanCommentThread>;
  readonly focusedId: TicketPlanCommentId | null;
  readonly draft: PlanCommentDraft | null;
  readonly onDraft: (draft: PlanCommentDraft) => void;
  /** A click on a passage focuses its thread; a click elsewhere in the plan passes null. */
  readonly onFocusThread: (id: TicketPlanCommentId | null) => void;
  readonly children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const [ranges, setRanges] = useState<ReadonlyMap<TicketPlanCommentId, Range>>(new Map());
  const [blocks, setBlocks] = useState<ReadonlyArray<PlanBlock>>([]);
  const [hovered, setHovered] = useState<Element | null>(null);
  const quoted = useMemo(
    () =>
      threads.flatMap(({ comment, location }) => {
        const quote = comment.anchor?.quote;
        return quote === undefined || location?.status === "outdated" ? [] : [{ comment, quote }];
      }),
    [threads],
  );

  // Rendering settles after the first paint (highlighted code, diagrams, a theme change, a new
  // body), so passages resolve and blocks are measured again when the document's DOM changes,
  // at most once a frame, and blocks again when its size changes.
  useEffect(() => {
    const surface = surfaceRef.current;
    const root = documentRef.current;
    if (surface === null || root === null) return;
    let frame: number | null = null;
    const measure = () => {
      const next = measureBlocks(surface, root);
      setBlocks((previous) =>
        previous.length === next.length &&
        previous.every(
          (block, index) =>
            block.element === next[index]!.element && block.top === next[index]!.top,
        )
          ? previous
          : next,
      );
    };
    const sync = () => {
      frame = null;
      const resolved = resolveAssistantCitationRanges(
        root,
        quoted.map(({ quote }) => ({ ...quote, start: -1, end: -1 })),
      );
      const next = new Map<TicketPlanCommentId, Range>();
      quoted.forEach(({ comment }, index) => {
        const range = resolved[index];
        if (range) next.set(comment.id, range);
      });
      setRanges((previous) => (sameRanges(previous, next) ? previous : next));
      measure();
    };
    sync();
    const mutations = new MutationObserver(() => {
      frame ??= requestAnimationFrame(sync);
    });
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    const resizes = new ResizeObserver(measure);
    resizes.observe(root);
    return () => {
      mutations.disconnect();
      resizes.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [quoted]);

  useEffect(() => showHighlight(OPEN_HIGHLIGHT, [...ranges.values()], 0), [ranges]);

  useEffect(() => {
    const root = documentRef.current;
    if (draft !== null)
      return showHighlight(FOCUSED_HIGHLIGHT, draft.range ? [draft.range] : [], 1);
    const thread = threads.find(({ comment }) => comment.id === focusedId);
    if (root === null || thread === undefined) return;
    const range = ranges.get(thread.comment.id);
    if (range !== undefined) return showHighlight(FOCUSED_HIGHLIGHT, [range], 1);
    const { location } = thread;
    if (location === null || location.status === "outdated") return;
    const block = blockAt(root, location.start);
    return block === null ? undefined : showHighlight(FOCUSED_HIGHLIGHT, [contentsRange(block)], 1);
  }, [draft, focusedId, ranges, threads]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToThread: ({ comment, location }) => {
        const root = documentRef.current;
        const range = ranges.get(comment.id);
        const target =
          range !== undefined
            ? range.startContainer.parentElement
            : root === null || location === null || location.status === "outdated"
              ? null
              : blockAt(root, location.start);
        target?.scrollIntoView({ block: "center" });
      },
    }),
    [ranges],
  );

  return (
    <div
      ref={surfaceRef}
      className="relative"
      onPointerOver={(event) => setHovered((event.target as Element).closest("[data-plan-block]"))}
      onPointerLeave={() => setHovered(null)}
      onClick={(event) => {
        if (window.getSelection()?.isCollapsed === false) return;
        if ((event.target as Element).closest("a, button, input, summary")) return;
        const hits = quoted.filter(({ comment }) => {
          const range = ranges.get(comment.id);
          return range !== undefined && containsPoint(range, event.clientX, event.clientY);
        });
        if (hits.length === 0) {
          onFocusThread(null);
          return;
        }
        // Overlapping passages take turns, starting after the thread already in focus.
        const current = hits.findIndex(({ comment }) => comment.id === focusedId);
        event.stopPropagation();
        onFocusThread(hits[(current + 1) % hits.length]!.comment.id);
      }}
    >
      <div ref={documentRef} data-plan-document="">
        {children}
      </div>
      {blocks.map(({ element, kind, top }, index) => (
        <div
          key={element.getAttribute("data-plan-source-start")}
          className={cn(
            "absolute -left-6 hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 lg:-left-7",
            hovered !== null && element.contains(hovered) ? "opacity-100" : "opacity-0",
          )}
          style={{ top }}
        >
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Comment on ${PLAN_BLOCK_LABELS[kind]} ${
              blocks.slice(0, index + 1).filter((block) => block.kind === kind).length
            }`}
            onClick={() =>
              // Read at click time: an edit can move the block's source without moving the block.
              onDraft({
                anchor: anchorFromRenderedSelection(
                  body,
                  planSourceSpan(element),
                  undefined,
                  revision,
                ),
                range: contentsRange(element),
                kind,
              })
            }
          >
            <MessageSquarePlusIcon aria-hidden />
          </Button>
        </div>
      ))}
      <TicketPlanSelectionComment
        documentRef={documentRef}
        onComment={({ selector: { text, prefix, suffix }, range, span }) =>
          onDraft({
            anchor: anchorFromRenderedSelection(
              body,
              span,
              // Blocks leave blank lines between them; quotes match with whitespace runs equal.
              { text: text.replace(/\n(?:[ \t]*\n)+/g, "\n"), prefix, suffix },
              revision,
            ),
            range,
            kind: null,
          })
        }
      />
    </div>
  );
}
