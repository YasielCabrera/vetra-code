export interface FileBreadcrumb {
  label: string;
  path: string;
  kind: "project" | "directory" | "file";
}

export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[] {
  const parts = relativePath.split("/").filter(Boolean);
  return [
    { label: projectName, path: "", kind: "project" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
      kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
    })),
  ];
}

/**
 * Ancestor directories of a workspace-relative file, in Pierre tree form
 * (trailing slash). Used to expand the path to an open file without opening
 * sibling folders.
 */
export function fileTreeAncestorDirectoryPaths(relativePath: string): string[] {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length < 2) return [];
  const ancestors: string[] = [];
  let ancestorPath = "";
  for (const segment of segments.slice(0, -1)) {
    ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
    ancestors.push(`${ancestorPath}/`);
  }
  return ancestors;
}
