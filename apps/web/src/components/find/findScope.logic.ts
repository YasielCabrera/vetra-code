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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  for (const match of text.matchAll(new RegExp(escapeRegExp(query), "giu"))) {
    if (matches.length === limit) return { matches, truncated: true };
    const start = locate(match.index, false);
    const end = locate(match.index + match[0].length, true);
    matches.push({ start, end });
  }
  return { matches, truncated: false };
}
