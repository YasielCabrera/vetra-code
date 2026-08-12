import type { ProjectId } from "@vetra-studio/contracts";

import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  normalizeProjectPathForDispatch,
} from "./projectPaths";

export const DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY = "~/Vetra Studio Projects";

const MAX_PROJECT_TITLE_LENGTH = 72;
const MAX_PROJECT_FOLDER_STEM_LENGTH = 48;

function normalizedTitleSeed(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function derivePendingProjectTitle(prompt: string): string {
  const seed = normalizedTitleSeed(prompt);
  if (seed.length === 0) {
    return "Untitled project";
  }
  return seed.length <= MAX_PROJECT_TITLE_LENGTH
    ? seed
    : `${seed.slice(0, MAX_PROJECT_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function derivePendingProjectFolderName(
  prompt: string,
  projectId: ProjectId,
  customFolderName = "",
): string {
  const requestedStem = normalizedTitleSeed(customFolderName || derivePendingProjectTitle(prompt))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PROJECT_FOLDER_STEM_LENGTH)
    .replace(/-+$/g, "");
  const stem = requestedStem || "untitled-project";
  const suffix =
    projectId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 6)
      .toLowerCase() || "new";
  return `${stem}-${suffix}`;
}

export function resolvePendingProjectLocation(input: {
  parentDirectory: string;
  customFolderName: string;
  prompt: string;
  projectId: ProjectId;
}): {
  title: string;
  folderName: string;
  workspaceRoot: string;
} {
  const parentDirectory =
    normalizeProjectPathForDispatch(input.parentDirectory) || DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY;
  const folderName = derivePendingProjectFolderName(
    input.prompt,
    input.projectId,
    input.customFolderName,
  );
  return {
    title: derivePendingProjectTitle(input.prompt),
    folderName,
    workspaceRoot: normalizeProjectPathForDispatch(
      appendBrowsePathSegment(ensureBrowseDirectoryPath(parentDirectory), folderName),
    ),
  };
}
