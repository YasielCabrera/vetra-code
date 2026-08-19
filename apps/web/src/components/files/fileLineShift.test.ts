import { describe, expect, it } from "vite-plus/test";

import { computeLineShift } from "./fileLineShift";

describe("computeLineShift", () => {
  it("returns null for identical buffers", () => {
    expect(computeLineShift("same\n", "same\n")).toBeNull();
  });

  it("finds a whole-line insertion and deletion", () => {
    expect(computeLineShift("a\nb", "a\nx\nb")).toEqual({
      startLine: 2,
      removedLineCount: 0,
      insertedLineCount: 1,
    });
    expect(computeLineShift("a\nx\nb", "a\nb")).toEqual({
      startLine: 2,
      removedLineCount: 1,
      insertedLineCount: 0,
    });
  });

  it("finds same-line and whole-buffer replacements", () => {
    expect(computeLineShift("a\nb", "a\nx")).toEqual({
      startLine: 2,
      removedLineCount: 1,
      insertedLineCount: 1,
    });
    expect(computeLineShift("a\nb", "x\ny")).toEqual({
      startLine: 1,
      removedLineCount: 2,
      insertedLineCount: 2,
    });
  });

  it("places a new EOF line after the surviving line", () => {
    expect(computeLineShift("a", "a\nb")).toEqual({
      startLine: 2,
      removedLineCount: 0,
      insertedLineCount: 1,
    });
  });

  it("treats splitting and joining a line as replacements", () => {
    expect(computeLineShift("ab", "a\nb")).toEqual({
      startLine: 1,
      removedLineCount: 1,
      insertedLineCount: 2,
    });
    expect(computeLineShift("a\nb", "ab")).toEqual({
      startLine: 1,
      removedLineCount: 2,
      insertedLineCount: 1,
    });
  });

  it("treats a trailing newline change as an in-place edit", () => {
    expect(computeLineShift("a", "a\n")).toEqual({
      startLine: 1,
      removedLineCount: 0,
      insertedLineCount: 0,
    });
    expect(computeLineShift("a\n", "a")).toEqual({
      startLine: 1,
      removedLineCount: 0,
      insertedLineCount: 0,
    });
  });

  it("keeps CRLF pairs intact", () => {
    expect(computeLineShift("a\r\nb", "a\r\nx\r\nb")).toEqual({
      startLine: 2,
      removedLineCount: 0,
      insertedLineCount: 1,
    });
  });

  it("handles empty buffers in both directions", () => {
    expect(computeLineShift("", "a")).toEqual({
      startLine: 1,
      removedLineCount: 0,
      insertedLineCount: 1,
    });
    expect(computeLineShift("a", "")).toEqual({
      startLine: 1,
      removedLineCount: 1,
      insertedLineCount: 0,
    });
  });

  it("does not invent a line shift for an inline insertion", () => {
    expect(computeLineShift("ab", "axb")).toEqual({
      startLine: 1,
      removedLineCount: 0,
      insertedLineCount: 0,
    });
  });
});
