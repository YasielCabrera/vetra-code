import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ResizableFileTreePane } from "./ResizableFileTreePane";

describe("ResizableFileTreePane", () => {
  it("renders a resize handle on the inner edge of a left tree", () => {
    const markup = renderToStaticMarkup(
      <ResizableFileTreePane
        storageKey="vetra.testFileTreeWidth"
        defaultWidth={320}
        minWidth={192}
        maxFraction={0.4}
        side="left"
      >
        <div>tree</div>
      </ResizableFileTreePane>,
    );

    expect(markup).toContain('data-file-tree-pane="left"');
    expect(markup).toContain('data-resize-edge="right"');
    expect(markup).toContain('aria-label="Resize file tree"');
    expect(markup).toContain("tree");
  });

  it("renders a resize handle on the inner edge of a right tree", () => {
    const markup = renderToStaticMarkup(
      <ResizableFileTreePane
        storageKey="vetra.testFileTreeWidth"
        defaultWidth={352}
        minWidth={256}
        maxFraction={0.46}
        side="right"
        label="Resize file explorer"
      >
        <div>tree</div>
      </ResizableFileTreePane>,
    );

    expect(markup).toContain('data-file-tree-pane="right"');
    expect(markup).toContain('data-resize-edge="left"');
    expect(markup).toContain('aria-label="Resize file explorer"');
  });

  it("fills the row without a handle when no file is open", () => {
    const markup = renderToStaticMarkup(
      <ResizableFileTreePane
        storageKey="vetra.testFileTreeWidth"
        defaultWidth={352}
        minWidth={256}
        maxFraction={0.46}
        side="left"
        fill
      >
        <div>tree</div>
      </ResizableFileTreePane>,
    );

    expect(markup).not.toContain('role="separator"');
    expect(markup).toContain("flex-1");
  });
});
