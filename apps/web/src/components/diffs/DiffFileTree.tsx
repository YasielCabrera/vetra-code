import type { GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSelector } from "@pierre/trees/react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";

import { createFileTreeDragMentionController } from "../files/fileTreeDragMention";
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "../files/fileTreeExpansion";
import { Button } from "../ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildDiffFileTreeUpdates,
  compareDiffFileTreeEntries,
  collectDirectoryPaths,
  diffFileTreeModel,
  diffFileTreePositions,
  type DiffFileTreeEntry,
} from "./diffFileTree.logic";

export type { DiffFileTreeEntry } from "./diffFileTree.logic";

interface DiffFileTreeProps {
  readonly entries: ReadonlyArray<DiffFileTreeEntry>;
  readonly onSelectFile: (path: string) => void;
  readonly selectedPath?: string | null;
  readonly revealRequestId?: number;
  readonly ariaLabel: string;
  readonly headerAccessory?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

export function DiffFileTree({
  entries,
  onSelectFile,
  selectedPath = null,
  revealRequestId = 0,
  ariaLabel,
  headerAccessory,
  footer,
  className,
}: DiffFileTreeProps) {
  const { resolvedTheme } = useTheme();
  const paths = entries.map((entry) => entry.path);
  const presented = diffFileTreeModel(paths);
  const modelPaths = presented.paths;
  const icons = presented.icons;
  const directoryPaths = collectDirectoryPaths(modelPaths);
  const positions = diffFileTreePositions(modelPaths);
  const [ordering] = useState(() => {
    let currentPositions: ReadonlyMap<string, number> = new Map();
    return {
      sort: compareDiffFileTreeEntries(() => currentPositions),
      update: (nextPositions: ReadonlyMap<string, number>) => {
        currentPositions = nextPositions;
      },
    };
  });
  const gitStatus: ReadonlyArray<GitStatusEntry> = entries.map((entry) => ({
    path: presented.modelPath(entry.path),
    status: entry.status,
  }));
  const syncingSelectionRef = useRef(false);
  const handledRevealRef = useRef<{
    path: string;
    revealRequestId: number;
  } | null>(null);
  const mountedPresentationRef = useRef<ReturnType<typeof diffFileTreeModel> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const treeModelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);
  const selectedPathRef = useRef(selectedPath);
  const presentedRef = useRef(presented);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
    presentedRef.current = presented;
  }, [presented, selectedPath]);

  // Tree paths can carry the collision suffix; a mention must name the real file.
  const mentionPath = useStableCallback((path: string) => presented.selectionPath(path));
  const dragMention = createFileTreeDragMentionController({ mentionPath });

  // The tree model keeps the first selection handler it was given.
  const handleSelectionChange = useStableCallback((selectedPaths: ReadonlyArray<string>) => {
    // The drag controller mirrors selection so a drag that starts on an
    // already-selected row carries every selected file.
    dragMention.handleSelectionChange(selectedPaths);
    if (syncingSelectionRef.current) return;
    // Starting a drag selects the dragged row; that is a side effect of the
    // gesture, not a request to show that file.
    if (dragMention.isDragInProgress()) return;
    const modelPath = selectedPaths.at(-1);
    if (modelPath && modelPaths.includes(modelPath)) {
      onSelectFile(presented.selectionPath(modelPath));
    }
  });

  const { model } = useFileTree({
    density: "compact",
    // Rows only need to be draggable so files can be dropped into the chat
    // composer; rearranging a diff's files means nothing, so dropping stays off.
    dragAndDrop: { canDrop: () => false },
    flattenEmptyDirectories: true,
    initialExpansion: "open",
    icons,
    onSelectionChange: handleSelectionChange,
    paths: [],
    search: false,
    sort: ordering.sort,
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
  });
  const allDirectoriesExpanded = useFileTreeSelector(model, (currentModel) =>
    areAllDirectoriesExpanded(currentModel, directoryPaths),
  );

  useEffect(() => {
    model.setIcons(icons);
  }, [icons, model]);

  useEffect(() => {
    ordering.update(positions);
    const mounted = mountedPresentationRef.current;
    if (mounted?.paths === modelPaths) return;
    mountedPresentationRef.current = presented;
    if (mounted === null) {
      model.resetPaths(modelPaths);
    } else if (mounted.paths.every((path, index) => modelPaths[index] === path)) {
      const updates = buildDiffFileTreeUpdates(mounted.paths, modelPaths);
      if (updates.length > 0) model.batch(updates);
    } else {
      // A reset can turn a file path into a directory. Carry selection and focus
      // through real paths so paging keeps the same file without revealing it again.
      const focusedPath = model.getFocusedPath();
      const nextFocusedPath =
        focusedPath === null ? null : presented.modelPath(mounted.selectionPath(focusedPath));
      const selectedPaths = model
        .getSelectedPaths()
        .map((path) => presented.modelPath(mounted.selectionPath(path)))
        .filter((path) => path.endsWith("/") || modelPaths.includes(path));
      const collapsedDirectories = directoryPaths.filter((path) => {
        const directory = model.getItem(path);
        return directory !== null && "isExpanded" in directory && !directory.isExpanded();
      });
      syncingSelectionRef.current = true;
      model.resetPaths(modelPaths);
      for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
      for (const path of selectedPaths) model.getItem(path)?.select();
      queueMicrotask(() => {
        syncingSelectionRef.current = false;
      });
      for (const path of collapsedDirectories) {
        const directory = model.getItem(path);
        if (directory !== null && "collapse" in directory) directory.collapse();
      }
      if (
        nextFocusedPath !== null &&
        (modelPaths.includes(nextFocusedPath) || directoryPaths.includes(nextFocusedPath))
      ) {
        model.focusPath(nextFocusedPath);
      }
    }
    model.setGitStatus(gitStatus);
  }, [directoryPaths, gitStatus, model, modelPaths, ordering, positions, presented]);

  useEffect(() => {
    treeModelRef.current = model;
  }, [model]);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const handleDragStart = (event: DragEvent) => dragMention.handleDragStart(event);
    const handleDragEnd = () => {
      const selected = selectedPathRef.current;
      const viewedPath = selected === null ? null : presentedRef.current.modelPath(selected);
      dragMention.handleDragEnd((path) => {
        if (path !== viewedPath) treeModelRef.current?.getItem(path)?.deselect();
      });
      // The tree hands selection to the row it picked up, so put it back on the
      // file the diff is showing instead of leaving nothing highlighted.
      const tree = treeModelRef.current;
      if (viewedPath === null || tree === null) return;
      if (tree.getSelectedPaths().includes(viewedPath)) return;
      const item = tree.getItem(viewedPath);
      if (item === null || item.isDirectory()) return;
      syncingSelectionRef.current = true;
      item.select();
      queueMicrotask(() => {
        syncingSelectionRef.current = false;
      });
    };
    // Capture: the tree's own drag start moves selection, and the controller has
    // to know a drag is running before that selection change arrives.
    panel.addEventListener("dragstart", handleDragStart, true);
    panel.addEventListener("dragend", handleDragEnd);
    return () => {
      panel.removeEventListener("dragstart", handleDragStart, true);
      panel.removeEventListener("dragend", handleDragEnd);
    };
  }, [dragMention]);

  useEffect(() => {
    if (selectedPath === null) {
      handledRevealRef.current = null;
      return;
    }
    const modelPath = presented.modelPath(selectedPath);
    const item = model.getItem(modelPath);
    if (item === null || item.isDirectory()) {
      handledRevealRef.current = null;
      return;
    }
    const handled = handledRevealRef.current;
    if (handled?.path === selectedPath && handled.revealRequestId === revealRequestId) {
      return;
    }
    handledRevealRef.current = { path: selectedPath, revealRequestId };
    syncingSelectionRef.current = true;
    for (const path of model.getSelectedPaths()) {
      if (path !== modelPath) model.getItem(path)?.deselect();
    }
    let ancestor = "";
    for (const segment of modelPath.split("/").slice(0, -1)) {
      ancestor += `${segment}/`;
      const directory = model.getItem(ancestor);
      if (directory !== null && "expand" in directory) directory.expand();
    }
    item.select();
    model.scrollToPath(modelPath, { offset: "nearest" });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [model, presented, revealRequestId, selectedPath]);

  return (
    <div ref={panelRef} className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}>
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 text-xs text-muted-foreground in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <span className="px-1 font-medium text-foreground">Files</span>
        <span className="ml-auto tabular-nums">{entries.length}</span>
        {headerAccessory}
        {directoryPaths.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"
                  }
                  onClick={() =>
                    setAllDirectoriesExpanded(model, directoryPaths, !allDirectoriesExpanded)
                  }
                />
              }
            >
              <MorphIcon
                className="size-3.5"
                icon={allDirectoriesExpanded ? ChevronsDownUp : ChevronsUpDown}
              />
            </TooltipTrigger>
            <TooltipPopup>
              {allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <FileTree
        model={model}
        aria-label={ariaLabel}
        onClickCapture={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          // Pierre does not emit a selection change for its sole selected row.
          // Read selection before the row handles the click so new selections reveal only once.
          const selected = model.getSelectedPaths();
          const path = selected.length === 1 ? selected[0] : undefined;
          if (!path || !modelPaths.includes(path)) return;
          const clickedSelectedRow = event.nativeEvent
            .composedPath()
            .some(
              (node) => node instanceof HTMLElement && node.getAttribute("data-item-path") === path,
            );
          if (clickedSelectedRow) onSelectFile(presented.selectionPath(path));
        }}
        className="min-h-0 flex-1 overflow-hidden"
        style={pierreTreeStyle(resolvedTheme)}
      />
      {footer}
    </div>
  );
}
