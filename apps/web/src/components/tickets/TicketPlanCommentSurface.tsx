import type { TicketPlanAnchor, TicketPlanCommentId } from "@t3tools/contracts";
import {
  anchorFromRenderedSelection,
  type PlanCommentThread,
  type PlanSourceSpan,
} from "@t3tools/shared/ticketPlanAnchors";
import { MessageSquarePlusIcon } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  captureAssistantTextSelection,
  resolveAssistantCitationRanges,
} from "../../lib/assistantTextSelection";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "../../lib/selectionActions";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import type { PlanBlockKind } from "./TicketPlanDocument";

const DOCUMENT_SELECTOR = "[data-plan-document]";
const SOURCE_SELECTOR = "[data-plan-source-start]";
const QUOTE_MAX_CHARS = 8_000;
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

function sourceSpanOf(element: Element): PlanSourceSpan {
  return {
    start: Number(element.getAttribute("data-plan-source-start")),
    end: Number(element.getAttribute("data-plan-source-end")),
  };
}

/** The top-level block holding `node`, or for the line break between blocks, the one after it. */
function blockOf(node: Node, after: boolean): Element | null {
  const block = (node instanceof Element ? node : node.parentElement)?.closest(SOURCE_SELECTOR);
  if (block) return block;
  // A triple-click ends on the line break react-markdown leaves after the paragraph.
  const next = (sibling: Node) => (after ? sibling.nextSibling : sibling.previousSibling);
  for (let sibling = next(node); sibling !== null; sibling = next(sibling)) {
    if (!(sibling instanceof Element)) continue;
    return sibling.matches(SOURCE_SELECTOR) ? sibling : sibling.querySelector(SOURCE_SELECTOR);
  }
  return null;
}

/** The source of every top-level block a selection touches, or null outside the blocks. */
function selectionSpan(range: Range): PlanSourceSpan | null {
  const first = blockOf(range.startContainer, true);
  const last = blockOf(range.endContainer, false);
  if (!first || !last) return null;
  const from = sourceSpanOf(first);
  const to = sourceSpanOf(last);
  return {
    start: Math.min(from.start, to.start),
    end: Math.max(from.end, to.end),
  };
}

function blockAt(root: HTMLElement, offset: number): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(SOURCE_SELECTOR)) {
    const span = sourceSpanOf(element);
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
  readonly onFocusThread: (id: TicketPlanCommentId) => void;
  readonly children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const [ranges, setRanges] = useState<ReadonlyMap<TicketPlanCommentId, Range>>(new Map());
  const [blocks, setBlocks] = useState<ReadonlyArray<PlanBlock>>([]);
  const [hovered, setHovered] = useState<Element | null>(null);
  const quoted = useMemo(
    () =>
      threads.flatMap(({ comment }) => {
        const quote = comment.anchor?.quote;
        return quote === undefined ? [] : [{ comment, quote }];
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
      setRanges(next);
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
    const { comment, location } = thread;
    if (comment.anchor?.quote !== undefined || location === null) return;
    if (location.status === "outdated") return;
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
        if (hits.length === 0) return;
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
            "absolute -left-6 hover:opacity-100 focus-within:opacity-100 lg:-left-7",
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
                  sourceSpanOf(element),
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
      <PlanSelectionCommentButton
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

type CapturedSelection = NonNullable<ReturnType<typeof captureAssistantTextSelection>> & {
  readonly span: PlanSourceSpan;
};

/** The floating Comment button over a text selection in the plan. */
function PlanSelectionCommentButton(props: {
  readonly documentRef: RefObject<HTMLDivElement | null>;
  readonly onComment: (captured: CapturedSelection) => void;
}) {
  const { documentRef, onComment } = props;
  const [selection, setSelection] = useState<{
    captured: CapturedSelection;
    position: SelectionActionPoint;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    const root = documentRef.current;
    if (root === null) return;
    // The scroll container, so scrolling the page dismisses the button.
    const viewport =
      root.closest<HTMLElement>("[data-slot=scroll-area-viewport]") ?? root.parentElement ?? root;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const captured = captureAssistantTextSelection(
        root,
        window.getSelection(),
        DOCUMENT_SELECTOR,
      );
      const span = captured === null ? null : selectionSpan(captured.range);
      const rect = captured?.range.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      if (
        !captured ||
        !span ||
        !rect ||
        rect.width === 0 ||
        rect.bottom < bounds.top ||
        rect.top > bounds.bottom
      ) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      setSelection({
        captured: { ...captured, span },
        position: resolveSelectionActionPosition({
          bounds,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusButton = (event: KeyboardEvent) => {
      const button = toolbarRef.current?.querySelector<HTMLButtonElement>("button:enabled");
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !button ||
        toolbarRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      button.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusButton, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusButton, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [documentRef]);

  if (!selection) return null;
  const tooLong = selection.captured.selector.text.length > QUOTE_MAX_CHARS;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] gap-1"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={tooLong}
        aria-label={tooLong ? "Selection is too long to comment on" : "Comment on the selection"}
        onClick={() => {
          if (tooLong) return;
          onComment(selection.captured);
          window.getSelection()?.removeAllRanges();
          dismiss();
        }}
      >
        <MessageSquarePlusIcon aria-hidden className="size-3.5" />
        {tooLong ? "Shorten selection" : "Comment"}
      </Button>
    </div>,
    document.body,
  );
}
