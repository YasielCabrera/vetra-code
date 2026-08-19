import { describe, expect, it } from "vite-plus/test";

import { countTextLines, fileContentRevision } from "./fileRevision.ts";

describe("fileContentRevision", () => {
  it("changes for same-length edits", () => {
    expect(fileContentRevision("nodeVersion")).not.toBe(fileContentRevision("nodeVeasdrs"));
  });

  it("is stable for identical contents", () => {
    expect(fileContentRevision("contents")).toBe(fileContentRevision("contents"));
  });
});

describe("countTextLines", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\nb\n", 2],
    ["a\r\nb", 2],
    ["a\rb\r", 2],
  ])("counts %j as %i lines", (contents, expected) => {
    expect(countTextLines(contents)).toBe(expected);
  });
});
