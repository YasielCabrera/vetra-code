import { describe, expect, it } from "vite-plus/test";

import { buildDiffFileTreeModel, gitStatusForFileDiffType } from "./diffFileTree";

describe("gitStatusForFileDiffType", () => {
  it("maps each Pierre change type onto a tree git status", () => {
    expect(gitStatusForFileDiffType("new")).toBe("added");
    expect(gitStatusForFileDiffType("deleted")).toBe("deleted");
    expect(gitStatusForFileDiffType("change")).toBe("modified");
    expect(gitStatusForFileDiffType("rename-pure")).toBe("renamed");
    expect(gitStatusForFileDiffType("rename-changed")).toBe("renamed");
  });
});

describe("buildDiffFileTreeModel", () => {
  it("builds file paths and git status for the changed-file tree", () => {
    expect(
      buildDiffFileTreeModel([
        { path: "src/index.ts", type: "change" },
        { path: "README.md", type: "new" },
        { path: "src/gone.ts", type: "deleted" },
        { path: "src/renamed.ts", type: "rename-changed" },
      ]),
    ).toEqual({
      paths: ["src/index.ts", "README.md", "src/gone.ts", "src/renamed.ts"],
      gitStatus: [
        { path: "src/index.ts", status: "modified" },
        { path: "README.md", status: "added" },
        { path: "src/gone.ts", status: "deleted" },
        { path: "src/renamed.ts", status: "renamed" },
      ],
    });
  });

  it("normalizes separators, drops empty paths, and keeps the first duplicate", () => {
    expect(
      buildDiffFileTreeModel([
        { path: "", type: "change" },
        { path: "apps\\web\\src\\index.ts", type: "new" },
        { path: "apps/web/src/index.ts", type: "change" },
        { path: "/rooted.ts", type: "deleted" },
      ]),
    ).toEqual({
      paths: ["apps/web/src/index.ts", "rooted.ts"],
      gitStatus: [
        { path: "apps/web/src/index.ts", status: "added" },
        { path: "rooted.ts", status: "deleted" },
      ],
    });
  });
});
