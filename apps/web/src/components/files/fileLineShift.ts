import { countTextLines } from "@t3tools/shared/fileRevision";

export interface FileLineShift {
  readonly startLine: number;
  readonly removedLineCount: number;
  readonly insertedLineCount: number;
}

function countLineBreaks(value: string, start = 0, end = value.length): number {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    const character = value.charCodeAt(index);
    if (character === 13) {
      count += 1;
      if (index + 1 < end && value.charCodeAt(index + 1) === 10) index += 1;
    } else if (character === 10) {
      count += 1;
    }
  }
  return count;
}

function lineAtOffset(value: string, offset: number): number {
  return countLineBreaks(value, 0, offset) + 1;
}

function countTextLinesInRange(value: string, start: number, end: number): number {
  if (start >= end) return 0;
  const breaks = countLineBreaks(value, start, end);
  const finalCharacter = value.charCodeAt(end - 1);
  return 1 + breaks - (finalCharacter === 10 || finalCharacter === 13 ? 1 : 0);
}

/** Returns null when the buffers are identical. */
export function computeLineShift(previous: string, next: string): FileLineShift | null {
  if (previous === next) return null;

  const sharedLength = Math.min(previous.length, next.length);
  let prefixLength = 0;
  while (
    prefixLength < sharedLength &&
    previous.charCodeAt(prefixLength) === next.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }
  // Never split a CRLF pair across the shared prefix and changed region.
  if (
    prefixLength > 0 &&
    previous.charCodeAt(prefixLength - 1) === 13 &&
    (previous.charCodeAt(prefixLength) === 10 || next.charCodeAt(prefixLength) === 10)
  ) {
    prefixLength -= 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previous.length - prefixLength &&
    suffixLength < next.length - prefixLength &&
    previous.charCodeAt(previous.length - suffixLength - 1) ===
      next.charCodeAt(next.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }

  const previousChangedEnd = previous.length - suffixLength;
  const nextChangedEnd = next.length - suffixLength;
  const removedTextIsEmpty = prefixLength === previousChangedEnd;
  const insertedTextIsEmpty = prefixLength === nextChangedEnd;
  let removedLineCount = countTextLinesInRange(previous, prefixLength, previousChangedEnd);
  let insertedLineCount = countTextLinesInRange(next, prefixLength, nextChangedEnd);

  // Reconcile each changed slice with the shared whole-buffer line-count rule.
  const expectedDelta = countTextLines(next) - countTextLines(previous);
  const correction = expectedDelta - (insertedLineCount - removedLineCount);
  if (correction > 0) {
    const cancelledRemovals = Math.min(removedLineCount, correction);
    removedLineCount -= cancelledRemovals;
    insertedLineCount += correction - cancelledRemovals;
  } else if (correction < 0) {
    const magnitude = -correction;
    const cancelledInsertions = Math.min(insertedLineCount, magnitude);
    insertedLineCount -= cancelledInsertions;
    removedLineCount += magnitude - cancelledInsertions;
  }

  let startLine = lineAtOffset(previous, prefixLength);
  const prefixEndsAtLineBoundary =
    prefixLength === 0 ||
    previous.charCodeAt(prefixLength - 1) === 10 ||
    previous.charCodeAt(prefixLength - 1) === 13;
  const beginsWithLineBreak = (value: string, offset: number) => {
    const first = value.charCodeAt(offset);
    return first === 10 || first === 13;
  };
  const shiftsAtLeadingLineBreak =
    !prefixEndsAtLineBoundary &&
    (removedLineCount > 0 || insertedLineCount > 0) &&
    ((removedTextIsEmpty && beginsWithLineBreak(next, prefixLength)) ||
      (insertedTextIsEmpty && beginsWithLineBreak(previous, prefixLength)));
  if (shiftsAtLeadingLineBreak) {
    const suffixStartsAtLineBoundary =
      suffixLength === 0 ||
      (previousChangedEnd > 0 &&
        nextChangedEnd > 0 &&
        (previous.charCodeAt(previousChangedEnd - 1) === 10 ||
          previous.charCodeAt(previousChangedEnd - 1) === 13) &&
        (next.charCodeAt(nextChangedEnd - 1) === 10 || next.charCodeAt(nextChangedEnd - 1) === 13));
    if (suffixStartsAtLineBoundary) {
      startLine += 1;
    } else {
      // Splitting or joining a line changes the surviving line as well as the
      // net line count. Keep both sides in the projected modified region.
      removedLineCount += 1;
      insertedLineCount += 1;
    }
  }

  return {
    startLine,
    removedLineCount,
    insertedLineCount,
  };
}
