import type { ProjectEntry, VcsStatusResult } from "@t3tools/contracts";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";

import { fileTreeAncestorDirectoryPaths } from "./filePath";

type WorkingTreeFile = VcsStatusResult["workingTree"]["files"][number];

function normalizeTreePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

/**
 * Maps working-tree changes onto tree status entries. Changed paths are kept
 * even when their directory has not been loaded yet: the tree marks every
 * ancestor of a status path, so collapsed folders show their changes.
 */
export function buildFileTreeGitStatus(
  entries: ReadonlyArray<ProjectEntry>,
  changedFiles: ReadonlyArray<WorkingTreeFile>,
): readonly GitStatusEntry[] {
  const entryKindByPath = new Map(entries.map((entry) => [entry.path, entry.kind] as const));
  const statusByPath = new Map<string, GitStatus>();
  const untrackedDirectoryPaths = new Set<string>();

  for (const changedFile of changedFiles) {
    const normalizedPath = normalizeTreePath(changedFile.path);
    const path = normalizedPath.replace(/\/$/, "");
    if (path.length === 0) continue;
    const status = changedFile.status ?? (normalizedPath.endsWith("/") ? "untracked" : "modified");
    if (status === "deleted") continue;
    if (normalizedPath.endsWith("/") || entryKindByPath.get(path) === "directory") {
      if (status === "untracked") untrackedDirectoryPaths.add(`${path}/`);
      continue;
    }
    if (!statusByPath.has(path)) statusByPath.set(path, status);
  }

  const gitStatus: GitStatusEntry[] = [...untrackedDirectoryPaths].map((path) => ({
    path,
    status: "untracked",
  }));
  for (const [path, status] of statusByPath) gitStatus.push({ path, status });
  for (const entry of entries) {
    if (entry.kind !== "file" || entry.ignored || statusByPath.has(entry.path)) continue;
    if (
      fileTreeAncestorDirectoryPaths(entry.path).some((path) => untrackedDirectoryPaths.has(path))
    ) {
      gitStatus.push({ path: entry.path, status: "untracked" });
    }
  }

  return gitStatus;
}
