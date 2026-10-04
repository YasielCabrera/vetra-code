import type { TicketPlanAnchor } from "@t3tools/contracts";

const SOURCE_MAX_CHARS = 4_000;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const RENDERED_MARKERS = new Set(["*", "`", "~"]);
const LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const BLOCK_MARKERS = /^[ \t]*(?:(?:>|(?:[-*+]|\d{1,9}[.)]|#{1,6})(?=[ \t]|$))[ \t]*)+/gm;
const UNDERSCORES = /_+/g;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;

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
 * Anchors a comment to `quote`, text an agent copied from the plan's Markdown source. The quote
 * carries no prefix or suffix: those describe rendered text, which the source cannot give, and the
 * web resolves a unique quote without them. When the quote is not in the body exactly once, returns
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
  return {
    quote: { text: quote, prefix: "", suffix: "" },
    source: sourceWindow(body, span, { start: at, end }),
    revision,
  };
}

/** `span` of `body`, cut to the source limit around `focus` when it is longer. */
function sourceWindow(body: string, span: PlanSourceSpan, focus: PlanSourceSpan): string {
  if (span.end - span.start <= SOURCE_MAX_CHARS) return body.slice(span.start, span.end);
  // Centered on the focus; a focus longer than the window keeps its start.
  const margin = Math.max(0, Math.floor((SOURCE_MAX_CHARS - (focus.end - focus.start)) / 2));
  const start = Math.min(Math.max(focus.start - margin, span.start), span.end - SOURCE_MAX_CHARS);
  return body.slice(start, start + SOURCE_MAX_CHARS);
}

/**
 * Finds a comment's passage in the current body. The web and the agent tools both call this, so
 * they agree on which comments are outdated; `start` orders comments by their place in the
 * document. The unchanged source block is "current". Failing that, the quote found with
 * whitespace runs treated as equal, in the raw body or in its text without Markdown markup, is
 * "moved" and spans the raw text. Anything else, including a quote-less anchor whose block
 * changed, is "outdated". Callers locating many anchors in one body share one `findQuote`.
 */
export function locatePlanAnchor(
  body: string,
  anchor: TicketPlanAnchor,
  findQuote = quoteFinder(body),
): PlanAnchorLocation {
  const at = anchor.source === "" ? -1 : body.indexOf(anchor.source);
  if (at !== -1) return { status: "current", start: at, end: at + anchor.source.length };
  const found = anchor.quote === undefined ? null : findQuote(anchor.quote.text);
  return found === null ? { status: "outdated" } : { status: "moved", ...found };
}

/**
 * Finds quotes in `body`, first in the raw text, then in its text without Markdown markup. Each
 * searched text is built on the first search that needs it and reused by the later ones.
 */
function quoteFinder(body: string): (quote: string) => PlanSourceSpan | null {
  let raw: SearchText | undefined;
  let rendered: SearchText | undefined;
  return (quote) => {
    const words = quote.replace(/\s+/g, " ").trim();
    if (words === "") return null;
    raw ??= searchText(body);
    return spanOf(raw, words) ?? spanOf((rendered ??= searchText(body, markupMask(body))), words);
  };
}

/** Text a quote is searched in: `text[i]` comes from `body[offsets[i]]`. */
interface SearchText {
  readonly text: string;
  readonly offsets: ReadonlyArray<number>;
}

/** `body` without the characters `hidden` marks, each whitespace run as one space. */
function searchText(body: string, hidden?: Uint8Array): SearchText {
  const characters: Array<string> = [];
  const offsets: Array<number> = [];
  for (let index = 0; index < body.length; index += 1) {
    if (hidden?.[index] === 1) continue;
    const space = WHITESPACE.test(body[index]!);
    if (space && characters.at(-1) === " ") continue;
    characters.push(space ? " " : body[index]!);
    offsets.push(index);
  }
  return { text: characters.join(""), offsets };
}

/** The raw span of `words`, a whitespace-normalized quote, in `searched`. */
function spanOf(searched: SearchText, words: string): PlanSourceSpan | null {
  const at = searched.text.indexOf(words);
  if (at === -1) return null;
  return { start: searched.offsets[at]!, end: searched.offsets[at + words.length - 1]! + 1 };
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
