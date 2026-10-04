const WHITESPACE = /\s/;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** Text a quote is searched in: `text[i]` comes from `source[offsets[i]]`. */
export interface SearchText {
  readonly text: string;
  readonly offsets: ReadonlyArray<number>;
}

export function searchText(source: string, hidden?: Uint8Array): SearchText {
  const characters: Array<string> = [];
  const offsets: Array<number> = [];
  for (let index = 0; index < source.length; index += 1) {
    if (hidden?.[index] === 1) continue;
    const space = WHITESPACE.test(source[index]!);
    if (space && characters.at(-1) === " ") continue;
    characters.push(space ? " " : source[index]!);
    offsets.push(index);
  }
  return { text: characters.join(""), offsets };
}

export interface QuoteContext {
  readonly prefix: string;
  readonly suffix: string;
}

export interface QuoteSelector extends QuoteContext {
  readonly text: string;
}

export interface QuoteSpan {
  readonly start: number;
  readonly end: number;
}

export function contextFits(
  text: string,
  start: number,
  end: number,
  { prefix, suffix }: QuoteContext,
): boolean {
  return (
    text.slice(Math.max(0, start - prefix.length), start) === prefix &&
    text.slice(end, end + suffix.length) === suffix
  );
}

/**
 * Finds `selector.text` in `texts`, case-sensitively, after collapsing whitespace in the selector
 * as `normalizeWhitespace` does; each text must already be normalized. Positions and context
 * lengths are UTF-16 units in that normalized text. `place` maps an occurrence to the span
 * returned, and occurrences it places at one span count once. The match is the one span whose
 * prefix and suffix fit, or else the only span the quote occurs at. Repeated quotes without a
 * single fitting span are ambiguous and return null, so no caller guesses between them.
 */
export function matchQuote<Text extends { readonly text: string }>(
  texts: ReadonlyArray<Text>,
  selector: QuoteSelector,
  place: (text: Text, start: number, end: number) => QuoteSpan = (_text, start, end) => ({
    start,
    end,
  }),
): QuoteSpan | null {
  const quote = normalizeWhitespace(selector.text);
  if (quote.trim() === "") return null;
  const context = {
    prefix: normalizeWhitespace(selector.prefix),
    suffix: normalizeWhitespace(selector.suffix),
  };
  const sameSpan = (left: QuoteSpan, right: QuoteSpan) =>
    left.start === right.start && left.end === right.end;
  let only: QuoteSpan | null = null;
  let repeated = false;
  let fitting: QuoteSpan | null = null;
  for (const searched of texts) {
    const { text } = searched;
    for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) {
      const end = start + quote.length;
      const span = place(searched, start, end);
      only ??= span;
      repeated ||= !sameSpan(only, span);
      if (!contextFits(text, start, end, context)) continue;
      if (fitting !== null && !sameSpan(fitting, span)) return null;
      fitting = span;
    }
  }
  return fitting ?? (repeated ? null : only);
}
