import type {
  VcsFileBlameCommit,
  VcsFileBlameResult,
  VcsFileLineChangesResult,
} from "@vetra-code/contracts";

export const FILE_CHANGE_NONE = 0;
export const FILE_CHANGE_ADDED = 1;
export const FILE_CHANGE_MODIFIED = 2;
export type FileChangeKind =
  | typeof FILE_CHANGE_NONE
  | typeof FILE_CHANGE_ADDED
  | typeof FILE_CHANGE_MODIFIED;

export const UNCOMMITTED_BLAME_OID = "0000000000000000000000000000000000000000";

export interface FileLineDecorationIndex {
  readonly lineCount: number;
  readonly changes: Uint8Array;
  readonly deletionAfterLines: Uint32Array;
  readonly deletionLineCounts: Uint32Array;
  readonly blameEndLines: Uint32Array;
  readonly blameCommitIndexes: Uint32Array;
  readonly commits: ReadonlyArray<VcsFileBlameCommit>;
  readonly localIdentity: VcsFileBlameResult["localIdentity"];
}

function applyRanges(
  target: Uint8Array,
  ranges: ReadonlyArray<number>,
  kind: FileChangeKind,
): void {
  for (let index = 0; index < ranges.length; index += 2) {
    const startLine = ranges[index] ?? 0;
    const lineCount = ranges[index + 1] ?? 0;
    const startIndex = Math.max(0, startLine - 1);
    const endIndex = Math.min(target.length, startIndex + lineCount);
    target.fill(kind, startIndex, endIndex);
  }
}

export function buildFileLineDecorationIndex(
  lineCount: number,
  lineChanges: VcsFileLineChangesResult | null,
  blame: VcsFileBlameResult | null,
): FileLineDecorationIndex {
  const changes = new Uint8Array(lineCount);
  const compatibleChanges = lineChanges?.lineCount === lineCount ? lineChanges : null;
  if (compatibleChanges) {
    applyRanges(changes, compatibleChanges.addedRanges, FILE_CHANGE_ADDED);
    applyRanges(changes, compatibleChanges.modifiedRanges, FILE_CHANGE_MODIFIED);
  }

  const deletionAfterLines: number[] = [];
  const deletionLineCounts: number[] = [];
  if (compatibleChanges) {
    for (let index = 0; index < compatibleChanges.deletionMarkers.length; index += 2) {
      deletionAfterLines.push(compatibleChanges.deletionMarkers[index] ?? 0);
      deletionLineCounts.push(compatibleChanges.deletionMarkers[index + 1] ?? 0);
    }
  }

  const compatibleBlame =
    blame?.lineCount === lineCount &&
    (compatibleChanges === null || blame.headOid === compatibleChanges.headOid)
      ? blame
      : null;
  const blameEndLines: number[] = [];
  const blameCommitIndexes: number[] = [];
  if (compatibleBlame) {
    let endLine = compatibleBlame.firstLine - 1;
    for (let index = 0; index < compatibleBlame.runs.length; index += 2) {
      endLine += compatibleBlame.runs[index] ?? 0;
      blameEndLines.push(endLine);
      blameCommitIndexes.push(compatibleBlame.runs[index + 1] ?? 0);
    }
  }

  return {
    lineCount,
    changes,
    deletionAfterLines: Uint32Array.from(deletionAfterLines),
    deletionLineCounts: Uint32Array.from(deletionLineCounts),
    blameEndLines: Uint32Array.from(blameEndLines),
    blameCommitIndexes: Uint32Array.from(blameCommitIndexes),
    commits: compatibleBlame?.commits ?? [],
    localIdentity: compatibleBlame?.localIdentity ?? null,
  };
}

function lowerBound(values: Uint32Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function fileChangeAtLine(index: FileLineDecorationIndex, line: number): FileChangeKind {
  return (index.changes[line - 1] ?? FILE_CHANGE_NONE) as FileChangeKind;
}

export function deletionCountAfterLine(index: FileLineDecorationIndex, line: number): number {
  const markerIndex = lowerBound(index.deletionAfterLines, line);
  return index.deletionAfterLines[markerIndex] === line
    ? (index.deletionLineCounts[markerIndex] ?? 0)
    : 0;
}

export function blameCommitIndexAtLine(
  index: FileLineDecorationIndex,
  line: number,
): number | null {
  if (line < 1 || line > index.lineCount) return null;
  const runIndex = lowerBound(index.blameEndLines, line);
  return runIndex < index.blameCommitIndexes.length
    ? (index.blameCommitIndexes[runIndex] ?? null)
    : null;
}

export function isCurrentBlameAuthor(
  commit: VcsFileBlameCommit,
  localIdentity: VcsFileBlameResult["localIdentity"],
): boolean {
  if (commit.oid === UNCOMMITTED_BLAME_OID) return true;
  if (!localIdentity) return false;
  if (commit.authorEmail && localIdentity.authorEmail) {
    return commit.authorEmail.toLowerCase() === localIdentity.authorEmail.toLowerCase();
  }
  return commit.author.length > 0 && commit.author === localIdentity.author;
}
