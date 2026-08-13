export const DIFF_FILE_TREE_WIDTH_STORAGE_KEY = "vetra.diffFileTreeWidth";
export const DIFF_FILE_TREE_DEFAULT_WIDTH = 20 * 16;
export const DIFF_FILE_TREE_MIN_WIDTH = 12 * 16;
export const DIFF_FILE_TREE_MAX_FRACTION = 0.4;

export const FILE_EXPLORER_WIDTH_STORAGE_KEY = "vetra.fileExplorerWidth";
export const FILE_EXPLORER_DEFAULT_WIDTH = 22 * 16;
export const FILE_EXPLORER_MIN_WIDTH = 16 * 16;
export const FILE_EXPLORER_MAX_FRACTION = 0.46;

export function fileTreePaneResizeEdge(side: "left" | "right"): "left" | "right" {
  return side === "left" ? "right" : "left";
}

/**
 * Caps a file-tree column at a fraction of its split container. Before the
 * container is measured, skip the cap so the stored/default width can paint.
 */
export function resolveFileTreePaneMaxWidth(
  containerWidth: number,
  maxFraction: number,
  minWidth: number,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(minWidth, Math.floor(containerWidth * maxFraction));
}
