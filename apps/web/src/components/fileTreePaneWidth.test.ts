import { describe, expect, it } from "vite-plus/test";

import {
  DIFF_FILE_TREE_DEFAULT_WIDTH,
  DIFF_FILE_TREE_MIN_WIDTH,
  FILE_EXPLORER_DEFAULT_WIDTH,
  FILE_EXPLORER_MIN_WIDTH,
  fileTreePaneResizeEdge,
  resolveFileTreePaneMaxWidth,
} from "./fileTreePaneWidth";

describe("fileTreePaneResizeEdge", () => {
  it("puts the handle on the inner edge of the split", () => {
    expect(fileTreePaneResizeEdge("left")).toBe("right");
    expect(fileTreePaneResizeEdge("right")).toBe("left");
  });
});

describe("resolveFileTreePaneMaxWidth", () => {
  it("uses a fraction of the container once it is known", () => {
    expect(resolveFileTreePaneMaxWidth(1000, 0.4, DIFF_FILE_TREE_MIN_WIDTH)).toBe(400);
    expect(resolveFileTreePaneMaxWidth(1000, 0.46, FILE_EXPLORER_MIN_WIDTH)).toBe(460);
  });

  it("does not go below the minimum even when the fraction would", () => {
    expect(resolveFileTreePaneMaxWidth(400, 0.4, DIFF_FILE_TREE_MIN_WIDTH)).toBe(
      DIFF_FILE_TREE_MIN_WIDTH,
    );
  });

  it("does not clamp before the container is measured", () => {
    expect(resolveFileTreePaneMaxWidth(0, 0.4, DIFF_FILE_TREE_MIN_WIDTH)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("keeps the shipped defaults above the minimums", () => {
    expect(DIFF_FILE_TREE_DEFAULT_WIDTH).toBeGreaterThan(DIFF_FILE_TREE_MIN_WIDTH);
    expect(FILE_EXPLORER_DEFAULT_WIDTH).toBeGreaterThan(FILE_EXPLORER_MIN_WIDTH);
  });
});
