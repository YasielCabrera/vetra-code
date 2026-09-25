import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorView, type StateEffect } from "@uiw/react-codemirror";

import { findSegmentMatches } from "./findScope.logic";
import { isRangeUnobscured, type FindSource } from "./findSource";

interface TextSpan {
  readonly from: number;
  readonly to: number;
}

/** The match's DOM text while CodeMirror draws it: inside its viewport and not folded away. */
function renderedRange(view: EditorView, span: TextSpan): Range | null {
  if (!view.visibleRanges.some(({ from, to }) => span.from >= from && span.to <= to)) return null;
  const start = view.domAtPos(span.from);
  const end = view.domAtPos(span.to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function reveal(view: EditorView, span: TextSpan) {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(span.from, span.to, (from, to) => {
    if (from < span.to && to > span.from) effects.push(unfoldEffect.of({ from, to }));
  });
  const range = effects.length === 0 ? renderedRange(view, span) : null;
  if (range !== null && isRangeUnobscured(range)) return;
  effects.push(EditorView.scrollIntoView(span.from, { y: "center" }));
  view.dispatch({ effects });
}

/**
 * Searches the whole document `view` shows, since CodeMirror only draws the lines near the
 * viewport. `text` is the document the view was given, so a new text makes a new source.
 */
export function codeMirrorFindSource(view: EditorView, text: string): FindSource {
  return {
    find: (_host, query, limit) => {
      const { matches, truncated } = findSegmentMatches([text], query, limit);
      const spans = matches.map(({ start, end }) => ({ from: start.offset, to: end.offset }));
      return {
        count: spans.length,
        truncated,
        ranges: () => spans.map((span) => renderedRange(view, span)),
        reveal: (index) => {
          const span = spans[index];
          if (span !== undefined) reveal(view, span);
        },
      };
    },
  };
}
