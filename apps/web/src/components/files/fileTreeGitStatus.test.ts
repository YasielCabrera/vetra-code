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
  { path: "unchanged.ts", kind: "file" as const },
];

describe("buildFileTreeGitStatus", () => {
  it("keeps visible statuses, drops deletions, and falls back for legacy entries", () => {
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
    ]);
  });

  it("expands collapsed untracked directories across visible descendant files", () => {
    expect(
      buildFileTreeGitStatus(entries, [
        { path: "new folder/", insertions: 0, deletions: 0, status: "untracked" },
      ]),
    ).toEqual([
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
