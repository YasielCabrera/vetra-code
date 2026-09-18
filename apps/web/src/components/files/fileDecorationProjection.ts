import type { VcsFileBlameCommit } from "@t3tools/contracts";

import type { FileLineShift } from "./fileLineShift";
import {
  FILE_CHANGE_ADDED,
  FILE_CHANGE_MODIFIED,
  UNCOMMITTED_BLAME_OID,
  type FileLineDecorationIndex,
} from "./fileLineDecorations";

const OPTIMISTIC_COMMIT: VcsFileBlameCommit = {
  oid: UNCOMMITTED_BLAME_OID,
  author: "",
  authorEmail: "",
  authorTime: null,
  summary: "",
};

interface BlameSegment {
  readonly startLine: number;
  readonly endLine: number;
  readonly commitIndex: number;
}

function blameSegments(index: FileLineDecorationIndex): BlameSegment[] {
  const segments: BlameSegment[] = [];
  let startLine = 1;
  for (let runIndex = 0; runIndex < index.blameEndLines.length; runIndex += 1) {
    const endLine = index.blameEndLines[runIndex] ?? startLine - 1;
    segments.push({
      startLine,
      endLine,
      commitIndex: index.blameCommitIndexes[runIndex] ?? 0,
    });
    startLine = endLine + 1;
  }
  return segments;
}

function pushBlameSegment(target: BlameSegment[], segment: BlameSegment): void {
  if (segment.endLine < segment.startLine) return;
  const previous = target.at(-1);
  if (previous?.commitIndex === segment.commitIndex && previous.endLine + 1 === segment.startLine) {
    target[target.length - 1] = { ...previous, endLine: segment.endLine };
  } else {
    target.push(segment);
  }
}

function projectBlame(
  index: FileLineDecorationIndex,
  shift: FileLineShift,
): Pick<
  FileLineDecorationIndex,
  "blameEndLines" | "blameCommitIndexes" | "commits" | "localIdentity"
> {
  if (index.blameEndLines.length === 0) {
    return {
      blameEndLines: index.blameEndLines,
      blameCommitIndexes: index.blameCommitIndexes,
      commits: index.commits,
      localIdentity: index.localIdentity,
    };
  }

  const commits = [...index.commits];
  let optimisticCommitIndex = commits.findIndex((commit) => commit.oid === UNCOMMITTED_BLAME_OID);
  if (optimisticCommitIndex < 0) {
    optimisticCommitIndex = commits.length;
    commits.push(OPTIMISTIC_COMMIT);
  }

  const isInPlaceEdit = shift.removedLineCount === 0 && shift.insertedLineCount === 0;
  const removedForBlame = isInPlaceEdit ? 1 : shift.removedLineCount;
  const insertedForBlame = isInPlaceEdit ? 1 : shift.insertedLineCount;
  const oldRegionStart = shift.startLine;
  const oldRegionEnd = shift.startLine + removedForBlame - 1;
  const delta = insertedForBlame - removedForBlame;
  const projected: BlameSegment[] = [];
  for (const segment of blameSegments(index)) {
    const beforeEnd = Math.min(segment.endLine, oldRegionStart - 1);
    pushBlameSegment(projected, { ...segment, endLine: beforeEnd });

    const afterStart = Math.max(segment.startLine, oldRegionEnd + 1);
    if (afterStart <= segment.endLine) {
      pushBlameSegment(projected, {
        startLine: afterStart + delta,
        endLine: segment.endLine + delta,
        commitIndex: segment.commitIndex,
      });
    }
  }

  const optimisticLineCount =
    insertedForBlame > 0 && index.lineCount - removedForBlame + insertedForBlame > 0
      ? insertedForBlame
      : 0;
  if (optimisticLineCount > 0) {
    projected.push({
      startLine: shift.startLine,
      endLine: shift.startLine + optimisticLineCount - 1,
      commitIndex: optimisticCommitIndex,
    });
    projected.sort((left, right) => left.startLine - right.startLine);
    const coalesced: BlameSegment[] = [];
    for (const segment of projected) pushBlameSegment(coalesced, segment);
    projected.splice(0, projected.length, ...coalesced);
  }

  return {
    blameEndLines: Uint32Array.from(projected.map((segment) => segment.endLine)),
    blameCommitIndexes: Uint32Array.from(projected.map((segment) => segment.commitIndex)),
    commits,
    localIdentity: index.localIdentity,
  };
}

function projectDeletionMarkers(
  index: FileLineDecorationIndex,
  shift: FileLineShift,
): { deletionAfterLines: Uint32Array; deletionLineCounts: Uint32Array } {
  const markerCounts = new Map<number, number>();
  const oldRegionEnd = shift.startLine + shift.removedLineCount - 1;
  const delta = shift.insertedLineCount - shift.removedLineCount;
  for (let markerIndex = 0; markerIndex < index.deletionAfterLines.length; markerIndex += 1) {
    const oldAfterLine = index.deletionAfterLines[markerIndex] ?? 0;
    const projectedAfterLine =
      oldAfterLine < shift.startLine
        ? oldAfterLine
        : oldAfterLine >= oldRegionEnd
          ? Math.max(0, oldAfterLine + delta)
          : Math.max(0, shift.startLine + shift.insertedLineCount - 1);
    markerCounts.set(
      projectedAfterLine,
      (markerCounts.get(projectedAfterLine) ?? 0) + (index.deletionLineCounts[markerIndex] ?? 0),
    );
  }

  const removedSurplus = shift.removedLineCount - shift.insertedLineCount;
  if (removedSurplus > 0) {
    const afterLine = Math.max(0, shift.startLine + shift.insertedLineCount - 1);
    markerCounts.set(afterLine, (markerCounts.get(afterLine) ?? 0) + removedSurplus);
  }

  const sorted = [...markerCounts.entries()].toSorted(([left], [right]) => left - right);
  return {
    deletionAfterLines: Uint32Array.from(sorted.map(([afterLine]) => afterLine)),
    deletionLineCounts: Uint32Array.from(sorted.map(([, lineCount]) => lineCount)),
  };
}

export function projectFileLineDecorations(
  index: FileLineDecorationIndex,
  shift: FileLineShift,
): FileLineDecorationIndex {
  const nextLineCount = Math.max(
    0,
    index.lineCount - shift.removedLineCount + shift.insertedLineCount,
  );
  const changes = new Uint8Array(nextLineCount);
  const beforeCount = Math.min(index.lineCount, Math.max(0, shift.startLine - 1));
  changes.set(index.changes.subarray(0, beforeCount), 0);

  const oldAfterIndex = Math.min(
    index.lineCount,
    beforeCount + Math.max(0, shift.removedLineCount),
  );
  const newAfterIndex = Math.min(nextLineCount, beforeCount + shift.insertedLineCount);
  changes.set(index.changes.subarray(oldAfterIndex), newAfterIndex);

  if (shift.insertedLineCount > 0) {
    changes.fill(
      shift.removedLineCount === 0 ? FILE_CHANGE_ADDED : FILE_CHANGE_MODIFIED,
      beforeCount,
      newAfterIndex,
    );
  } else if (shift.removedLineCount === 0 && beforeCount < nextLineCount) {
    changes[beforeCount] = FILE_CHANGE_MODIFIED;
  }

  return {
    lineCount: nextLineCount,
    changes,
    ...projectDeletionMarkers(index, shift),
    ...projectBlame(index, shift),
  };
}
