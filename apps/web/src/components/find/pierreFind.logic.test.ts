import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { diffFindLines, fileFindLines } from "./pierreFind.logic";

function parseDiff(lines: ReadonlyArray<string>) {
  return parsePatchFiles(lines.join("\n"), "find-test")[0]!.files[0]!;
}

describe("diffFindLines", () => {
  it("numbers each side the way the diff renders it", () => {
    const fileDiff = parseDiff([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,4 +10,5 @@",
      " const one = 1;",
      "-const two = 2;",
      "+const two = 22;",
      "+const extra = 0;",
      " const three = 3;",
      " const four = 4;",
    ]);

    expect(diffFindLines(fileDiff)).toEqual([
      { side: "additions", lineNumber: 10, text: "const one = 1;" },
      { side: "deletions", lineNumber: 11, text: "const two = 2;" },
      { side: "additions", lineNumber: 11, text: "const two = 22;" },
      { side: "additions", lineNumber: 12, text: "const extra = 0;" },
      { side: "additions", lineNumber: 13, text: "const three = 3;" },
      { side: "additions", lineNumber: 14, text: "const four = 4;" },
    ]);
  });

  it("restarts numbering at every hunk", () => {
    const fileDiff = parseDiff([
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,2 @@",
      "-alpha",
      "+ALPHA",
      " beta",
      "@@ -40,2 +40,1 @@",
      " omega",
      "-tail",
    ]);

    expect(
      diffFindLines(fileDiff).map(({ side, lineNumber }) => `${side[0]}${lineNumber}`),
    ).toEqual(["d1", "a1", "a2", "a40", "d41"]);
  });
});

describe("fileFindLines", () => {
  it("splits on every line ending Pierre counts", () => {
    expect(fileFindLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });
});
