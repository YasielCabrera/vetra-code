import type { FileDiffMetadata } from "@pierre/diffs/types";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";

export interface DiffFileTreeEntry {
  readonly path: string;
  readonly type: FileDiffMetadata["type"];
}

export interface DiffFileTreeModel {
  readonly paths: readonly string[];
  readonly gitStatus: readonly GitStatusEntry[];
}

export function gitStatusForFileDiffType(type: FileDiffMetadata["type"]): GitStatus {
  switch (type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
  }
}

export function buildDiffFileTreeModel(files: ReadonlyArray<DiffFileTreeEntry>): DiffFileTreeModel {
  const paths: string[] = [];
  const gitStatus: GitStatusEntry[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const path = file.path.replaceAll("\\", "/").replace(/^\/+/, "");
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    gitStatus.push({ path, status: gitStatusForFileDiffType(file.type) });
  }

  return { paths, gitStatus };
}
