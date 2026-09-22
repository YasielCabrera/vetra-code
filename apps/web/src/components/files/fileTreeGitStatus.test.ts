import { describe, expect, it } from "vite-plus/test";

import { buildFileTreeGitStatus } from "./fileTreeGitStatus";

const entries = [
  { path: "src", kind: "directory" as const },
  { path: "src/changed.ts", kind: "file" as const },
  { path: "src/legacy.ts", kind: "file" as const },
  { path: "src/deleted.ts", kind: "file" as const },
  { path: "new folder", kind: "directory" as const },
  { path: "new folder/first.ts", kind: "file" as const },
  { path: "new folder/nested", kind: "directory" as const },
  { path: "new folder/nested/second.ts", kind: "file" as const },
  { path: "new folder/node_modules", kind: "directory" as const, ignored: true },
  { path: "new folder/node_modules/dep.js", kind: "file" as const, ignored: true },
  { path: "unchanged.ts", kind: "file" as const },
];

describe("buildFileTreeGitStatus", () => {
  it("keeps statuses, drops deletions, and falls back for legacy entries", () => {
    expect(
      buildFileTreeGitStatus(entries, [
        { path: "src/changed.ts", insertions: 1, deletions: 0, status: "added" },
        { path: "src/legacy.ts", insertions: 1, deletions: 1 },
        { path: "src/deleted.ts", insertions: 0, deletions: 3, status: "deleted" },
        { path: "missing.ts", insertions: 1, deletions: 0, status: "modified" },
      ]),
    ).toEqual([
      { path: "src/changed.ts", status: "added" },
      { path: "src/legacy.ts", status: "modified" },
      { path: "missing.ts", status: "modified" },
    ]);
  });

  it("keeps changes inside directories that have not been loaded", () => {
    expect(
      buildFileTreeGitStatus(entries, [
        { path: "apps/web/src/index.ts", insertions: 1, deletions: 0, status: "modified" },
        { path: "apps/new/", insertions: 0, deletions: 0, status: "untracked" },
      ]),
    ).toEqual([
      { path: "apps/new/", status: "untracked" },
      { path: "apps/web/src/index.ts", status: "modified" },
    ]);
  });

  it("keeps file statuses stable when their folder loads", () => {
    const changes = [
      { path: "apps/web/index.ts", insertions: 1, deletions: 0, status: "modified" as const },
      { path: "apps/web/new.ts", insertions: 1, deletions: 0, status: "untracked" as const },
    ];
    const collapsed = buildFileTreeGitStatus([{ path: "apps", kind: "directory" }], changes);
    const expanded = buildFileTreeGitStatus(
      [
        { path: "apps", kind: "directory" },
        { path: "apps/web", kind: "directory" },
        { path: "apps/web/index.ts", kind: "file" },
        { path: "apps/web/new.ts", kind: "file" },
      ],
      changes,
    );
    expect(collapsed).toEqual([
      { path: "apps/web/index.ts", status: "modified" },
      { path: "apps/web/new.ts", status: "untracked" },
    ]);
    expect(expanded).toEqual(collapsed);
  });

  it("expands collapsed untracked directories across visible, non-ignored descendant files", () => {
    expect(
      buildFileTreeGitStatus(entries, [
        { path: "new folder/", insertions: 0, deletions: 0, status: "untracked" },
      ]),
    ).toEqual([
      { path: "new folder/", status: "untracked" },
      { path: "new folder/first.ts", status: "untracked" },
      { path: "new folder/nested/second.ts", status: "untracked" },
    ]);
  });

  it("normalizes separators and keeps the first duplicate status", () => {
    expect(
      buildFileTreeGitStatus(entries, [
        { path: "src\\changed.ts", insertions: 1, deletions: 0, status: "renamed" },
        { path: "src/changed.ts", insertions: 2, deletions: 0, status: "modified" },
      ]),
    ).toEqual([{ path: "src/changed.ts", status: "renamed" }]);
  });
});
