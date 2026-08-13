import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@pierre/trees/react", () => ({
  FileTree: (props: { "aria-label"?: string }) => (
    <div data-mock-file-tree={props["aria-label"] ?? ""} />
  ),
  useFileTree: () => ({
    model: {
      closeSearch: () => {},
      getItem: () => null,
      getSelectedPaths: () => [],
      resetPaths: () => {},
      setGitStatus: () => {},
      scrollToPath: () => {},
    },
  }),
  useFileTreeSearch: () => ({
    close: () => {},
    setValue: () => {},
    value: "",
  }),
}));

vi.mock("~/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

import { DiffFileTreePanel } from "./DiffFileTreePanel";

describe("DiffFileTreePanel", () => {
  it("renders a filter field above the changed-file tree", () => {
    const markup = renderToStaticMarkup(
      <DiffFileTreePanel
        files={[
          { path: "apps/web/src/index.ts", type: "change" },
          { path: "README.md", type: "new" },
        ]}
        selectedPath={null}
        selectedPathRevealId={0}
        onSelectFile={() => {}}
      />,
    );

    expect(markup).toContain("data-diff-file-tree");
    expect(markup).toContain('placeholder="Filter files..."');
    expect(markup).toContain('aria-label="Filter changed files"');
    expect(markup).toContain('data-mock-file-tree="Changed files"');
  });
});
