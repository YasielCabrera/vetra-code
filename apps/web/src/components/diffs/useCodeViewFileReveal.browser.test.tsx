import type { FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewHandle, CodeViewDiffItem } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { createRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { buildFileDiffIdentityKey, resolveFileDiffPath } from "~/lib/diffRendering";
import { act, render, type Screen } from "../../../test/render";
import { DiffFileTree } from "./DiffFileTree";
import { diffFileTreeEntries } from "./diffFileTree.logic";
import { StyledDiffCodeView } from "./StyledDiffCodeView";
import { useCodeViewFileReveal } from "./useCodeViewFileReveal";

function tallPatch(path: string) {
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,80 +1,80 @@
${Array.from({ length: 80 }, (_, index) => `-before ${index}\n+after ${index}`).join("\n")}
`;
}

function fixture(patch: string) {
  return parsePatchFiles(`${tallPatch("01-first.txt")}${patch}${tallPatch("99-last.txt")}`).flatMap(
    (entry) => entry.files,
  );
}

function RevealHarness({
  files,
  readyPaths,
  scope = "branch",
  onViewer,
}: {
  files: readonly FileDiffMetadata[];
  readyPaths: readonly string[];
  scope?: string;
  onViewer?: (viewer: CodeViewHandle<undefined, undefined> | null) => void;
}) {
  const [viewer, setViewer] = useState<CodeViewHandle<undefined, undefined> | null>(null);
  const readyFiles = files.filter((file) => readyPaths.includes(resolveFileDiffPath(file)));
  const items: CodeViewDiffItem<undefined>[] = readyFiles.map((fileDiff) => ({
    id: buildFileDiffIdentityKey(fileDiff),
    type: "diff",
    fileDiff,
  }));
  const requestReveal = useCodeViewFileReveal(
    viewer,
    scope,
    items.map((item) => ({ filePath: resolveFileDiffPath(item.fileDiff), fileKey: item.id })),
  );

  return (
    <div style={{ display: "flex", width: 900, height: 400 }}>
      <div style={{ display: "flex", width: 240 }}>
        <DiffFileTree
          entries={diffFileTreeEntries(files)}
          ariaLabel="Changed files"
          onSelectFile={requestReveal}
        />
      </div>
      <StyledDiffCodeView
        viewerRef={(next) => {
          setViewer(next);
          onViewer?.(next);
        }}
        items={items}
        style={{ flex: 1, minWidth: 0, height: 400, overflow: "auto" }}
        options={{ diffStyle: "unified", theme: "github-light", disableFileHeader: false }}
        renderCustomHeader={(item) => (
          <div role="heading" aria-level={2} style={{ height: 32 }}>
            {item.type === "diff" ? resolveFileDiffPath(item.fileDiff) : item.file.name}
          </div>
        )}
      />
    </div>
  );
}

async function selectFile(screen: Screen, path: string) {
  const tree = screen.container.querySelector("file-tree-container");
  const row = tree?.shadowRoot?.querySelector<HTMLElement>(
    `[data-item-path="${CSS.escape(path)}"]`,
  );
  if (!row) throw new Error(`Missing tree row for ${path}`);
  await act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true })));
}

async function expectRevealed(screen: Screen, path: string) {
  await expect.element(screen.getByRole("heading", { name: path, exact: true })).toBeVisible();
  await vi.waitFor(() => {
    const viewport = screen.container.querySelector<HTMLElement>(".diff-render-surface");
    if (!viewport) throw new Error("Missing code view");
    const bounds = viewport.getBoundingClientRect();
    const alignedHeaders = [...viewport.querySelectorAll('[role="heading"]')]
      .filter((header) => {
        const headerBounds = header.getBoundingClientRect();
        return (
          Math.round(headerBounds.top - bounds.top) === 0 && headerBounds.bottom <= bounds.bottom
        );
      })
      .map((header) => header.textContent);
    expect(alignedHeaders).toEqual([path]);
  });
}

it.each([
  {
    kind: "new",
    patch: `diff --git a/02-target.txt b/02-target.txt
new file mode 100644
--- /dev/null
+++ b/02-target.txt
@@ -0,0 +1 @@
+new content
`,
  },
  {
    kind: "deleted",
    patch: `diff --git a/02-target.txt b/02-target.txt
deleted file mode 100644
--- a/02-target.txt
+++ /dev/null
@@ -1 +0,0 @@
-deleted content
`,
  },
  {
    kind: "rename-pure",
    patch: `diff --git a/02-before.txt b/02-target.txt
similarity index 100%
rename from 02-before.txt
rename to 02-target.txt
`,
  },
])("reveals a lazy $kind file after one tree click", async ({ patch }) => {
  const files = fixture(patch);
  const pendingFiles = files.map((file): FileDiffMetadata =>
    resolveFileDiffPath(file) === "02-target.txt"
      ? {
          ...file,
          type: file.prevName ? "rename-changed" : "change",
          hunks: [],
          additionLines: [],
          deletionLines: [],
        }
      : file,
  );
  const readyPaths = ["01-first.txt", "99-last.txt"];
  await using screen = await render(<RevealHarness files={pendingFiles} readyPaths={readyPaths} />);
  await expectRevealed(screen, "01-first.txt");
  await selectFile(screen, "02-target.txt");
  await screen.rerender(
    <RevealHarness files={files} readyPaths={[...readyPaths, "02-target.txt"]} />,
  );
  await expectRevealed(screen, "02-target.txt");
  await act(() => {
    const viewport = screen.container.querySelector<HTMLElement>(".diff-render-surface");
    if (!viewport) throw new Error("Missing code view");
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
  });
  await expectRevealed(screen, "01-first.txt");
  await selectFile(screen, "02-target.txt");
  await expectRevealed(screen, "02-target.txt");
});

it("reveals only the latest tree selection when lazy files become ready together", async () => {
  const files = fixture(`${tallPatch("02-earlier.txt")}${tallPatch("03-latest.txt")}`);
  const readyPaths = ["01-first.txt", "99-last.txt"];
  await using screen = await render(<RevealHarness files={files} readyPaths={readyPaths} />);
  await expectRevealed(screen, "01-first.txt");
  await selectFile(screen, "02-earlier.txt");
  await selectFile(screen, "03-latest.txt");
  await screen.rerender(
    <RevealHarness files={files} readyPaths={[...readyPaths, "02-earlier.txt", "03-latest.txt"]} />,
  );
  await expectRevealed(screen, "03-latest.txt");
});

it("cancels a pending reveal when the scope changes and accepts a fresh click", async () => {
  const files = fixture(tallPatch("02-target.txt"));
  const readyPaths = ["01-first.txt", "99-last.txt"];
  const viewer = createRef<CodeViewHandle<undefined, undefined>>();
  const onViewer = (next: CodeViewHandle<undefined, undefined> | null) => {
    viewer.current = next;
  };
  await using screen = await render(
    <RevealHarness files={files} readyPaths={readyPaths} onViewer={onViewer} />,
  );
  await expectRevealed(screen, "01-first.txt");
  if (!viewer.current) throw new Error("Missing code view handle");
  using scrollTo = vi.spyOn(viewer.current, "scrollTo");
  await selectFile(screen, "02-target.txt");
  await screen.rerender(
    <RevealHarness
      files={files}
      readyPaths={[...readyPaths, "02-target.txt"]}
      scope="unstaged"
      onViewer={onViewer}
    />,
  );
  await screen.rerender(
    <RevealHarness
      files={files}
      readyPaths={[...readyPaths, "02-target.txt"]}
      onViewer={onViewer}
    />,
  );
  await selectFile(screen, "02-target.txt");
  await expectRevealed(screen, "02-target.txt");
  expect(scrollTo.mock.calls).toEqual([
    [{ type: "item", id: "02-target.txt\u000002-target.txt\u0000change", align: "start" }],
  ]);
});
