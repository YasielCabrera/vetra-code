import {
  COMPOSER_MENTION_DRAG_TYPE,
  composerMentionFromTreePath,
} from "~/components/chat/composerMentionDrag";

interface FileTreeDragTransfer {
  setData(format: string, data: string): void;
}

export interface FileTreeDragStartEvent {
  readonly dataTransfer: FileTreeDragTransfer | null;
  composedPath(): ReadonlyArray<unknown>;
}

export interface FileTreeDragMentionHost {
  /** The path a dragged row mentions; defaults to the tree path itself. */
  mentionPath?(treePath: string): string;
}

export interface FileTreeDragMentionController {
  isDragInProgress(): boolean;
  handleSelectionChange(selectedPaths: ReadonlyArray<string>): void;
  handleDragStart(event: FileTreeDragStartEvent): void;
  handleDragEnd(deselect: (treePath: string) => void): void;
}

const itemPathOf = (node: unknown): string | null => {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const element = node as { getAttribute?: (name: string) => string | null };
  return typeof element.getAttribute === "function" ? element.getAttribute("data-item-path") : null;
};

/**
 * Tree path of the row an event originated on, or null off-row. Rows render in
 * the tree's open shadow DOM, so callers must read the composed event path.
 */
export const fileTreeEventItemPath = (eventPath: ReadonlyArray<unknown>): string | null => {
  for (const node of eventPath) {
    const itemPath = itemPathOf(node);
    if (itemPath !== null) {
      return itemPath;
    }
  }
  return null;
};

/**
 * Tags file-tree drags with the composer mention payload and keeps the drag
 * from acting like a click: while the drag runs, selection changes are
 * suppressed, and when it ends the dragged rows are deselected so nothing is
 * left highlighted and a later click on them still fires a selection change.
 */
export function createFileTreeDragMentionController(
  host: FileTreeDragMentionHost,
): FileTreeDragMentionController {
  let selection: ReadonlyArray<string> = [];
  let draggedPaths: ReadonlyArray<string> = [];
  return {
    isDragInProgress: () => draggedPaths.length > 0,
    handleSelectionChange(selectedPaths) {
      selection = selectedPaths;
    },
    handleDragStart(event) {
      if (event.dataTransfer === null) {
        return;
      }
      // Only drags that originate on a tree row are mentions; a text/plain
      // fallback would also tag drags of selected text from the panel chrome.
      const itemPath = fileTreeEventItemPath(event.composedPath());
      if (itemPath === null) {
        return;
      }
      const dragged = selection.includes(itemPath) ? selection : [itemPath];
      const mentions = dragged
        .map((path) => {
          const treePath = path.replace(/\/+$/, "");
          return composerMentionFromTreePath(
            treePath && host.mentionPath ? host.mentionPath(treePath) : path,
          );
        })
        .filter((mention): mention is string => mention !== null);
      if (mentions.length === 0) {
        return;
      }
      draggedPaths = dragged;
      event.dataTransfer.setData(COMPOSER_MENTION_DRAG_TYPE, mentions.join(" "));
    },
    handleDragEnd(deselect) {
      if (draggedPaths.length === 0) {
        return;
      }
      for (const path of draggedPaths) {
        deselect(path);
      }
      draggedPaths = [];
    },
  };
}
