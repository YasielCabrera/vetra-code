import {
  TICKET_PLAN_ANCHOR_SOURCE_CONTEXT_MAX_CHARS as SOURCE_CONTEXT_MAX_CHARS,
  TICKET_PLAN_ANCHOR_SOURCE_MAX_CHARS as SOURCE_MAX_CHARS,
  type TicketPlanAnchor,
  type TicketPlanComment,
  type TicketPlanCommentId,
} from "@t3tools/contracts";

import { contextFits, matchQuote, type SearchText, searchText } from "./quoteMatch.ts";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const RENDERED_MARKERS = new Set(["*", "`", "~"]);
const LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const BLOCK_MARKERS = /^[ \t]*(?:(?:>|(?:[-*+]|\d{1,9}[.)]|#{1,6})(?=[ \t]|$))[ \t]*)+/gm;
const UNDERSCORES = /_+/g;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** A [start, end) range of a plan body. */
export interface PlanSourceSpan {
  readonly start: number;
  readonly end: number;
}

export type PlanAnchorLocation =
  | { readonly status: "current" | "moved"; readonly start: number; readonly end: number }
  | { readonly status: "outdated" };

/**
 * Top-level Markdown blocks of a plan body as [start, end) offsets. Blank lines separate blocks,
 * except inside a fenced code block, which is one block from its opening fence to its closing one.
 * A scanner, not a parser: it only has to find the passage around a quote.
 */
export function planSourceBlocks(body: string): Array<PlanSourceSpan> {
  const blocks: Array<PlanSourceSpan> = [];
  let start = -1;
  let end = 0;
  let fence = "";
  const close = () => {
    if (start !== -1) blocks.push({ start, end });
    start = -1;
  };
  let lineStart = 0;
  for (const line of body.split("\n")) {
    const lineEnd = lineStart + line.length;
    if (fence !== "") {
      end = lineEnd;
      const closing = FENCE_CLOSE.exec(line)?.[1];
      if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length) {
        close();
        fence = "";
      }
    } else if (/\S/.test(line)) {
      fence = FENCE_OPEN.exec(line)?.[1] ?? "";
      if (fence !== "") close();
      if (start === -1) start = lineStart;
      end = lineEnd;
    } else {
      close();
    }
    lineStart = lineEnd + 1;
  }
  close();
  return blocks;
}

/**
 * Anchors a comment to `quote`, text an agent copied from the plan's Markdown source. The stored
 * quote is that range as it renders, without Markdown markers, so the web can find it in the
 * rendered plan; a quote of markup alone stores none. It carries no prefix or suffix, and the web
 * resolves a unique quote without them. When the quote is not in the body exactly once, returns
 * how many places it matches instead, so the agent can quote more of the passage.
 */
export function anchorFromSourceQuote(
  body: string,
  quote: string,
  revision: number,
): TicketPlanAnchor | { readonly matches: number } {
  let matches = 0;
  if (/\S/.test(quote)) {
    for (let at = body.indexOf(quote); at !== -1; at = body.indexOf(quote, at + 1)) matches += 1;
  }
  if (matches !== 1) return { matches };
  const at = body.indexOf(quote);
  const end = at + quote.length;
  const covering = planSourceBlocks(body).filter((block) => block.start < end && block.end > at);
  const span = {
    start: Math.min(at, covering[0]?.start ?? at),
    end: Math.max(end, covering.at(-1)?.end ?? end),
  };
  const text = searchText(body.slice(at, end), markupMask(body).subarray(at, end)).text.trim();
  return {
    ...(text === "" ? {} : { quote: { text, prefix: "", suffix: "" } }),
    ...sourceWindow(body, span, { start: at, end }),
    revision,
  };
}

/**
 * Anchors a comment to a passage selected in the rendered plan. `span` runs from the first to the
 * last top-level block the selection touches, as offsets into `body`. `quote` is the selected
 * text, and is absent for a comment on a whole diagram, image or code block.
 */
export function anchorFromRenderedSelection(
  body: string,
  span: PlanSourceSpan,
  quote: TicketPlanAnchor["quote"],
  revision: number,
): TicketPlanAnchor {
  let focus = { start: span.start, end: span.start };
  if (quote !== undefined) {
    const found = quoteFinder(body)(quote);
    if (found !== null && found.start >= span.start && found.end <= span.end) {
      focus = found;
    } else {
      const local = quoteFinder(body.slice(span.start, span.end))(quote);
      if (local !== null) focus = { start: span.start + local.start, end: span.start + local.end };
    }
  }
  return {
    ...(quote === undefined ? {} : { quote }),
    ...sourceWindow(body, span, focus),
    revision,
  };
}

/** `span` of `body`, cut to the source limit around `focus` when it is longer. */
function sourceWindow(body: string, span: PlanSourceSpan, focus: PlanSourceSpan) {
  const margin = Math.max(0, Math.floor((SOURCE_MAX_CHARS - (focus.end - focus.start)) / 2));
  const start =
    span.end - span.start <= SOURCE_MAX_CHARS
      ? span.start
      : Math.min(Math.max(focus.start - margin, span.start), span.end - SOURCE_MAX_CHARS);
  const end = Math.min(span.end, start + SOURCE_MAX_CHARS);
  const source = body.slice(start, end);
  const repeated = source.length > 0 && body.indexOf(source) !== body.lastIndexOf(source);
  return {
    source,
    ...(repeated
      ? {
          sourceContext: {
            prefix: body.slice(Math.max(0, start - SOURCE_CONTEXT_MAX_CHARS), start),
            suffix: body.slice(end, end + SOURCE_CONTEXT_MAX_CHARS),
          },
        }
      : {}),
  };
}

/**
 * Finds a comment's passage in the current body. The web and the agent tools both call this, so
 * they agree on which comments are outdated; `start` orders comments by their place in the
 * document. A uniquely identified unchanged source block is "current". A unique quote, matched
 * across whitespace and Markdown formatting, is "moved" and spans the raw text. Changed blocks
 * without a quote and ambiguous matches are "outdated". Callers locating many anchors share
 * one `findQuote`.
 */
export function locatePlanAnchor(
  body: string,
  anchor: TicketPlanAnchor,
  findQuote = quoteFinder(body),
): PlanAnchorLocation {
  const source = locateSource(body, anchor);
  if (source !== null) return { status: "current", ...source };
  const found = anchor.quote === undefined ? null : findQuote(anchor.quote);
  return found === null ? { status: "outdated" } : { status: "moved", ...found };
}

function locateSource(body: string, anchor: TicketPlanAnchor): PlanSourceSpan | null {
  const { source, sourceContext } = anchor;
  if (source === "") return null;
  let found: PlanSourceSpan | null = null;
  for (let start = body.indexOf(source); start !== -1; start = body.indexOf(source, start + 1)) {
    const end = start + source.length;
    if (sourceContext !== undefined && !contextFits(body, start, end, sourceContext)) continue;
    if (found !== null) return null;
    found = { start, end };
  }
  return found;
}

function quoteFinder(
  body: string,
): (quote: NonNullable<TicketPlanAnchor["quote"]>) => PlanSourceSpan | null {
  let searched: ReadonlyArray<SearchText> | undefined;
  return (quote) => {
    searched ??= [searchText(body), searchText(body, markupMask(body))];
    return matchQuote(searched, quote, ({ offsets }, start, end) => ({
      start: offsets[start]!,
      end: offsets[end - 1]! + 1,
    }));
  };
}

/**
 * Marks the characters of `body` that render as formatting rather than text: `*`, `` ` ``, `~`,
 * link syntax around a link's text, `_` at a word's edge (not inside snake_case), and list,
 * heading and blockquote markers at a line start.
 */
function markupMask(body: string): Uint8Array {
  const hidden = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index += 1) {
    if (RENDERED_MARKERS.has(body[index]!)) hidden[index] = 1;
  }
  for (const link of body.matchAll(LINK)) {
    hidden[link.index] = 1;
    hidden.fill(1, link.index + 1 + link[1]!.length, link.index + link[0].length);
  }
  for (const marker of body.matchAll(BLOCK_MARKERS)) {
    hidden.fill(1, marker.index, marker.index + marker[0].length);
  }
  for (const run of body.matchAll(UNDERSCORES)) {
    const end = run.index + run[0].length;
    const inWord =
      WORD_CHARACTER.test(body[run.index - 1] ?? "") && WORD_CHARACTER.test(body[end] ?? "");
    if (!inWord) hidden.fill(1, run.index, end);
  }
  return hidden;
}

export interface PlanCommentThread {
  /** A top-level comment. */
  readonly comment: TicketPlanComment;
  /** Where its passage is in the body now; null for a comment on the whole plan. */
  readonly location: PlanAnchorLocation | null;
  /** Oldest first. */
  readonly replies: ReadonlyArray<TicketPlanComment>;
}

/**
 * A plan's flat comment list (oldest first) as threads in document order: anchored comments by
 * where their passage is now, then outdated and whole-plan comments oldest first. Agents read and
 * the web lists comments in this one order.
 */
export function orderPlanCommentThreads(
  body: string,
  comments: ReadonlyArray<TicketPlanComment>,
): Array<PlanCommentThread> {
  const replies = new Map<TicketPlanCommentId, Array<TicketPlanComment>>();
  for (const comment of comments) {
    if (comment.parentId === null) continue;
    const thread = replies.get(comment.parentId);
    if (thread === undefined) replies.set(comment.parentId, [comment]);
    else thread.push(comment);
  }
  const findQuote = quoteFinder(body);
  const place = ({ location }: PlanCommentThread) =>
    location === null || location.status === "outdated" ? Infinity : location.start;
  // The sort is stable, so the comments without a place stay last in creation order.
  return comments
    .filter((comment) => comment.parentId === null)
    .map((comment) => ({
      comment,
      location: comment.anchor === null ? null : locatePlanAnchor(body, comment.anchor, findQuote),
      replies: replies.get(comment.id) ?? [],
    }))
    .sort((left, right) => {
      const from = place(left);
      const to = place(right);
      return from === to ? 0 : from - to;
    });
}
