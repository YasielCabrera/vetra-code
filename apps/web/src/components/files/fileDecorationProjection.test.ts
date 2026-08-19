import type { VcsFileBlameResult, VcsFileLineChangesResult } from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectFileLineDecorations } from "./fileDecorationProjection";
import {
  blameCommitIndexAtLine,
  buildFileLineDecorationIndex,
  deletionCountAfterLine,
  FILE_CHANGE_ADDED,
  FILE_CHANGE_MODIFIED,
  fileChangeAtLine,
  UNCOMMITTED_BLAME_OID,
} from "./fileLineDecorations";

const committedOid = "1111111111111111111111111111111111111111";
const lineChanges: VcsFileLineChangesResult = {
  state: "modified",
  headOid: committedOid,
  lineCount: 5,
  addedRanges: [2, 1],
  modifiedRanges: [4, 1],
  deletionMarkers: [5, 1],
};
const blame: VcsFileBlameResult = {
  firstLine: 1,
  lineCount: 5,
  headOid: committedOid,
  commits: [
    {
      oid: committedOid,
      author: "Pierre",
      authorEmail: "pierre@example.com",
      authorTime: 1_700_000_000,
      summary: "Base",
    },
  ],
  runs: [5, 0],
  localIdentity: null,
};

const makeIndex = () => buildFileLineDecorationIndex(5, lineChanges, blame);

describe("projectFileLineDecorations", () => {
  it("marks inserted lines added and shifts later decorations", () => {
    const projected = projectFileLineDecorations(makeIndex(), {
      startLine: 3,
      removedLineCount: 0,
      insertedLineCount: 2,
    });

    expect(projected.lineCount).toBe(7);
    expect(fileChangeAtLine(projected, 2)).toBe(FILE_CHANGE_ADDED);
    expect(fileChangeAtLine(projected, 3)).toBe(FILE_CHANGE_ADDED);
    expect(fileChangeAtLine(projected, 4)).toBe(FILE_CHANGE_ADDED);
    expect(fileChangeAtLine(projected, 6)).toBe(FILE_CHANGE_MODIFIED);
    expect(deletionCountAfterLine(projected, 7)).toBe(1);
  });

  it("marks replacements modified and assigns optimistic blame", () => {
    const projected = projectFileLineDecorations(makeIndex(), {
      startLine: 2,
      removedLineCount: 1,
      insertedLineCount: 2,
    });

    expect(projected.lineCount).toBe(6);
    expect(fileChangeAtLine(projected, 2)).toBe(FILE_CHANGE_MODIFIED);
    expect(fileChangeAtLine(projected, 3)).toBe(FILE_CHANGE_MODIFIED);
    const optimisticIndex = blameCommitIndexAtLine(projected, 2);
    expect(optimisticIndex).not.toBeNull();
    expect(projected.commits[optimisticIndex!]?.oid).toBe(UNCOMMITTED_BLAME_OID);
    expect(blameCommitIndexAtLine(projected, 4)).toBe(0);
  });

  it("synthesizes and merges deletion markers for net removals", () => {
    const projected = projectFileLineDecorations(makeIndex(), {
      startLine: 4,
      removedLineCount: 2,
      insertedLineCount: 0,
    });

    expect(projected.lineCount).toBe(3);
    expect(deletionCountAfterLine(projected, 3)).toBe(3);
  });

  it("projects an in-place character edit without changing line count", () => {
    const projected = projectFileLineDecorations(makeIndex(), {
      startLine: 3,
      removedLineCount: 0,
      insertedLineCount: 0,
    });

    expect(projected.lineCount).toBe(5);
    expect(fileChangeAtLine(projected, 3)).toBe(FILE_CHANGE_MODIFIED);
    const commitIndex = blameCommitIndexAtLine(projected, 3);
    expect(projected.commits[commitIndex!]?.oid).toBe(UNCOMMITTED_BLAME_OID);
  });
});
