import { EnvironmentId } from "@vetra-code/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

let fileTreeConfig: Record<string, unknown> | null = null;

vi.mock("@pierre/trees/react", () => ({
  FileTree: (props: { "aria-label"?: string }) => (
    <div data-mock-file-tree={props["aria-label"] ?? ""} />
  ),
  useFileTree: (config: Record<string, unknown>) => {
    fileTreeConfig = config;
    return {
      model: {
        closeSearch: () => {},
        getItem: () => null,
        getSelectedPaths: () => [],
        resetPaths: () => {},
        scrollToPath: () => {},
        setGitStatus: () => {},
      },
    };
  },
  useFileTreeSearch: () => ({
    close: () => {},
    setValue: () => {},
    value: "",
  }),
}));

vi.mock("~/composerHandleContext", () => ({
  useComposerHandleContext: () => null,
}));

vi.mock("~/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      workingTree: {
        files: [
          {
            path: "src/changed.ts",
            insertions: 1,
            deletions: 0,
            status: "modified",
          },
        ],
      },
    },
    error: null,
    isPending: false,
    refresh: () => {},
  }),
}));

vi.mock("~/state/vcs", () => ({
  vcsEnvironment: { status: () => ({}) },
}));

vi.mock("./projectFilesQueryState", () => ({
  useProjectEntriesQuery: () => ({
    data: {
      entries: [
        { path: "src", kind: "directory" },
        { path: "src/changed.ts", kind: "file" },
        { path: "src/unchanged.ts", kind: "file" },
      ],
      truncated: false,
    },
    error: null,
    isPending: false,
    refresh: () => {},
  }),
}));

import FileBrowserPanel from "./FileBrowserPanel";

describe("FileBrowserPanel", () => {
  it("passes working-tree status and changed-folder styling to Pierre", () => {
    const markup = renderToStaticMarkup(
      <FileBrowserPanel
        environmentId={EnvironmentId.make("environment-1")}
        cwd="/repo"
        projectName="Project"
        selectedPath={null}
        selectedPathRevealId={0}
        workspaceMutationId={null}
        onOpenFile={() => {}}
      />,
    );

    expect(markup).toContain('data-mock-file-tree="Project files"');
    expect(fileTreeConfig?.gitStatus).toEqual([{ path: "src/changed.ts", status: "modified" }]);
    expect(fileTreeConfig?.unsafeCSS).toContain("--trees-status-added-override: var(--success)");
    expect(fileTreeConfig?.unsafeCSS).toContain(
      "--trees-status-deleted-override: var(--destructive)",
    );
    expect(fileTreeConfig?.unsafeCSS).toContain(
      "[data-item-contains-git-change='true'] > [data-item-section='content']",
    );
    expect(fileTreeConfig?.unsafeCSS).toContain("color: var(--trees-git-modified-color)");
    expect(fileTreeConfig?.unsafeCSS).toContain("font-weight: var(--trees-font-weight-semibold)");
  });
});
