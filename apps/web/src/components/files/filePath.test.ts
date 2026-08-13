import { describe, expect, it } from "vite-plus/test";

import { fileBreadcrumbs, fileTreeAncestorDirectoryPaths } from "./filePath";

describe("fileBreadcrumbs", () => {
  it("builds project, directory, and file crumbs", () => {
    expect(fileBreadcrumbs("vetra-code", "apps/web/src/main.tsx")).toEqual([
      { label: "vetra-code", path: "", kind: "project" },
      { label: "apps", path: "apps", kind: "directory" },
      { label: "web", path: "apps/web", kind: "directory" },
      { label: "src", path: "apps/web/src", kind: "directory" },
      { label: "main.tsx", path: "apps/web/src/main.tsx", kind: "file" },
    ]);
  });

  it("normalizes repeated separators", () => {
    expect(fileBreadcrumbs("workspace", "/src//index.ts").map((crumb) => crumb.label)).toEqual([
      "workspace",
      "src",
      "index.ts",
    ]);
  });
});

describe("fileTreeAncestorDirectoryPaths", () => {
  it("returns every ancestor directory with a trailing slash", () => {
    expect(fileTreeAncestorDirectoryPaths("apps/web/src/main.tsx")).toEqual([
      "apps/",
      "apps/web/",
      "apps/web/src/",
    ]);
  });

  it("returns nothing for a top-level file", () => {
    expect(fileTreeAncestorDirectoryPaths("README.md")).toEqual([]);
  });

  it("ignores empty segments from leading or repeated separators", () => {
    expect(fileTreeAncestorDirectoryPaths("/src//index.ts")).toEqual(["src/"]);
  });
});
