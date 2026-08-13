import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { useEffect, useMemo, useRef } from "react";

import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { useTheme } from "~/hooks/useTheme";
import { buildDiffFileTreeModel, type DiffFileTreeEntry } from "~/lib/diffFileTree";
import { VETRA_PIERRE_ICONS } from "~/pierre-icons";

interface DiffFileTreePanelProps {
  files: ReadonlyArray<DiffFileTreeEntry>;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onSelectFile: (path: string) => void;
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
    --trees-padding-inline-override: 8px;
    --trees-status-added-override: var(--success);
    --trees-status-deleted-override: var(--destructive);
  }
  button[data-type='item'] { border-radius: 5px; }
`;

function FilterFilesField(props: {
  ariaLabel: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1 rounded-md">
      <InputGroupInput
        type="search"
        name="diff-files-filter"
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder="Filter files..."
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onClose();
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}

export function DiffFileTreePanel({
  files,
  selectedPath,
  selectedPathRevealId,
  onSelectFile,
}: DiffFileTreePanelProps) {
  const { resolvedTheme } = useTheme();
  const treeModel = useMemo(() => buildDiffFileTreeModel(files), [files]);
  const filePathsRef = useRef(new Set(treeModel.paths));
  const onSelectFileRef = useRef(onSelectFile);
  const previousTreePathsKeyRef = useRef<string | null>(null);
  const syncingSelectionRef = useRef(false);
  const treeSelectionPathRef = useRef<string | null>(null);
  const handledRevealRef = useRef<{ path: string; revealId: number } | null>(null);
  const treePathsKey = treeModel.paths.join("\u0000");

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  });
  useEffect(() => {
    filePathsRef.current = new Set(treeModel.paths);
  }, [treeModel.paths]);

  const { model } = useFileTree({
    density: "compact",
    dragAndDrop: false,
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    gitStatus: treeModel.gitStatus,
    icons: VETRA_PIERRE_ICONS,
    initialExpansion: "open",
    onSelectionChange: (selectedPaths) => {
      if (syncingSelectionRef.current) return;
      const nextPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (!nextPath || !filePathsRef.current.has(nextPath)) return;
      treeSelectionPathRef.current = nextPath;
      onSelectFileRef.current(nextPath);
    },
    paths: [],
    renaming: false,
    search: false,
    unsafeCSS: TREE_UNSAFE_CSS,
  });
  const search = useFileTreeSearch(model);
  const handleSearchValueChange = (value: string) => {
    if (value.trim().length === 0) {
      search.close();
      return;
    }
    search.setValue(value);
  };

  useEffect(() => {
    if (previousTreePathsKeyRef.current === treePathsKey) {
      model.setGitStatus(treeModel.gitStatus);
      return;
    }
    previousTreePathsKeyRef.current = treePathsKey;
    model.resetPaths(treeModel.paths);
    model.setGitStatus(treeModel.gitStatus);
  }, [model, treeModel.gitStatus, treeModel.paths, treePathsKey]);

  useEffect(() => {
    if (!selectedPath) {
      handledRevealRef.current = null;
      return;
    }
    const revealRequest = { path: selectedPath, revealId: selectedPathRevealId };
    const handledReveal = handledRevealRef.current;
    if (
      handledReveal?.path === revealRequest.path &&
      handledReveal.revealId === revealRequest.revealId
    ) {
      return;
    }
    const selectedItem = model.getItem(selectedPath);
    if (!selectedItem || selectedItem.isDirectory()) return;

    const selectedInTree = model
      .getSelectedPaths()
      .some((path) => path.replace(/\/$/, "") === selectedPath);
    if (selectedInTree && treeSelectionPathRef.current === selectedPath) {
      treeSelectionPathRef.current = null;
      handledRevealRef.current = revealRequest;
      return;
    }
    treeSelectionPathRef.current = null;
    handledRevealRef.current = revealRequest;

    syncingSelectionRef.current = true;
    model.closeSearch();
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }

    const segments = selectedPath.split("/");
    let ancestorPath = "";
    for (const segment of segments.slice(0, -1)) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
      const item = model.getItem(`${ancestorPath}/`) ?? model.getItem(ancestorPath);
      if (item && "expand" in item) item.expand();
    }

    selectedItem.select();
    model.scrollToPath(selectedPath, { offset: "center" });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [model, selectedPath, selectedPathRevealId, treePathsKey]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" data-diff-file-tree>
      <div className="surface-subheader gap-1 px-2" data-surface-subheader>
        <FilterFilesField
          ariaLabel="Filter changed files"
          value={search.value}
          onValueChange={handleSearchValueChange}
          onClose={search.close}
        />
      </div>
      <FileTree
        model={model}
        aria-label="Changed files"
        className="min-h-0 flex-1 overflow-hidden"
        style={{
          colorScheme: resolvedTheme,
          ["--trees-fg-override" as string]: "var(--foreground)",
        }}
      />
    </div>
  );
}
