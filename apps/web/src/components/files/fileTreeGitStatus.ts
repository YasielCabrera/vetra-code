import type { ProjectEntry, VcsStatusResult } from "@t3tools/contracts";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";

import { fileTreeAncestorDirectoryPaths } from "./filePath";

type WorkingTreeFile = VcsStatusResult["workingTree"]["files"][number];

function normalizeTreePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function buildFileTreeGitStatus(
  entries: ReadonlyArray<ProjectEntry>,
  changedFiles: ReadonlyArray<WorkingTreeFile>,
): readonly GitStatusEntry[] {
  const entryKindByPath = new Map(entries.map((entry) => [entry.path, entry.kind] as const));
  const exactStatusByPath = new Map<string, GitStatus>();
  const untrackedDirectoryPaths = new Set<string>();

  for (const changedFile of changedFiles) {
    const normalizedPath = normalizeTreePath(changedFile.path);
    const path = normalizedPath.replace(/\/$/, "");
    if (path.length === 0) continue;
    const status = changedFile.status ?? (normalizedPath.endsWith("/") ? "untracked" : "modified");
    if (status === "deleted") continue;
    if (
      status === "untracked" &&
      (normalizedPath.endsWith("/") || entryKindByPath.get(path) === "directory")
    ) {
      untrackedDirectoryPaths.add(`${path}/`);
      continue;
    }
    if (entryKindByPath.get(path) === "file" && !exactStatusByPath.has(path)) {
      exactStatusByPath.set(path, status);
    }
  }

  const gitStatus: GitStatusEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const exactStatus = exactStatusByPath.get(entry.path);
    if (exactStatus) {
      gitStatus.push({ path: entry.path, status: exactStatus });
      continue;
    }
    if (
      fileTreeAncestorDirectoryPaths(entry.path).some((path) => untrackedDirectoryPaths.has(path))
    ) {
      gitStatus.push({ path: entry.path, status: "untracked" });
    }
  }

  return gitStatus;
}
