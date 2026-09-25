export const MAX_FIND_MATCHES = 2000;

export interface SegmentPosition {
  readonly segment: number;
  readonly offset: number;
}

export interface SegmentMatch {
  readonly start: SegmentPosition;
  readonly end: SegmentPosition;
}

export interface SegmentMatches {
  readonly matches: ReadonlyArray<SegmentMatch>;
  readonly truncated: boolean;
}

export interface LineOccurrence {
  /** Index into the searched lines. */
  readonly line: number;
  /** Which match on that line, counting from zero. */
  readonly occurrence: number;
}

export interface LineOccurrences {
  readonly matches: ReadonlyArray<LineOccurrence>;
  readonly truncated: boolean;
}

function queryPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

/** Case-insensitive literal matches that may span consecutive segments. */
export function findSegmentMatches(
  segments: ReadonlyArray<string>,
  query: string,
  limit: number = MAX_FIND_MATCHES,
): SegmentMatches {
  if (query.length === 0 || segments.length === 0) return { matches: [], truncated: false };

  const starts: number[] = [];
  let text = "";
  for (const segment of segments) {
    starts.push(text.length);
    text += segment;
  }
  const segmentEnd = (segment: number) => starts[segment]! + segments[segment]!.length;

  let segment = 0;
  const locate = (index: number, isEnd: boolean): SegmentPosition => {
    while (
      segment < segments.length - 1 &&
      (isEnd ? index > segmentEnd(segment) : index >= segmentEnd(segment))
    ) {
      segment += 1;
    }
    return { segment, offset: index - starts[segment]! };
  };

  const matches: SegmentMatch[] = [];
  for (const match of text.matchAll(queryPattern(query))) {
    if (matches.length === limit) return { matches, truncated: true };
    const start = locate(match.index, false);
    const end = locate(match.index + match[0].length, true);
    matches.push({ start, end });
  }
  return { matches, truncated: false };
}

/**
 * The same matching as `findSegmentMatches`, over a text model instead of the DOM, so a
 * virtualized surface can count and order matches on lines it has not rendered.
 */
export function findLineOccurrences(
  lines: ReadonlyArray<string>,
  query: string,
  limit: number = MAX_FIND_MATCHES,
): LineOccurrences {
  if (query.length === 0) return { matches: [], truncated: false };
  const pattern = queryPattern(query);
  const matches: LineOccurrence[] = [];
  for (const [line, text] of lines.entries()) {
    let occurrence = 0;
    for (const _match of text.matchAll(pattern)) {
      if (matches.length === limit) return { matches, truncated: true };
      matches.push({ line, occurrence });
      occurrence += 1;
    }
  }
  return { matches, truncated: false };
}
