import type { FileDiffMetadata, SelectionSide } from "@pierre/diffs";

/** One line a diff renders, addressed the way Pierre's `scrollTo` and `data-line` address it. */
export interface DiffFindLine {
  readonly side: SelectionSide;
  readonly lineNumber: number;
  readonly text: string;
}

function lineText(line: string | undefined): string {
  return (line ?? "").replace(/\r?\n$/, "");
}

/**
 * The hunk lines of a diff in unified reading order. Context lines count once, on the
 * additions side, because split view shows them on both. Collapsed context is not included.
 */
export function diffFindLines(fileDiff: FileDiffMetadata): DiffFindLine[] {
  const lines: DiffFindLine[] = [];
  const push = (side: SelectionSide, lineNumber: number, text: string | undefined) => {
    lines.push({ side, lineNumber, text: lineText(text) });
  };
  for (const hunk of fileDiff.hunks) {
    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          push(
            "additions",
            additionLineNumber + offset,
            fileDiff.additionLines[content.additionLineIndex + offset],
          );
        }
        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
        continue;
      }
      for (let offset = 0; offset < content.deletions; offset += 1) {
        push(
          "deletions",
          deletionLineNumber + offset,
          fileDiff.deletionLines[content.deletionLineIndex + offset],
        );
      }
      for (let offset = 0; offset < content.additions; offset += 1) {
        push(
          "additions",
          additionLineNumber + offset,
          fileDiff.additionLines[content.additionLineIndex + offset],
        );
      }
      deletionLineNumber += content.deletions;
      additionLineNumber += content.additions;
    }
  }
  return lines;
}

/** Source lines as Pierre numbers them: `\r\n`, `\r`, and `\n` each end a line. */
export function fileFindLines(contents: string): string[] {
  return contents.split(/\r\n|\r|\n/);
}
