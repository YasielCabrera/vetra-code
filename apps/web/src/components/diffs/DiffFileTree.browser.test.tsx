import { FileTree } from "@pierre/trees";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { COMPOSER_MENTION_DRAG_TYPE } from "../chat/composerMentionDrag";
import { DiffFileTree, type DiffFileTreeEntry } from "./DiffFileTree";

const FOLDERS = 300;

it("expands every folder without asking the tree about all folders for each one", async () => {
  // Two levels, so flattening empty folders cannot merge them into one.
  const entries: DiffFileTreeEntry[] = Array.from({ length: FOLDERS }, (_, index) => [
    { path: `package-${index}/a.ts`, status: "modified" as const },
    { path: `package-${index}/lib/b.ts`, status: "modified" as const },
  ]).flat();
  using getItem = vi.spyOn(FileTree.prototype, "getItem");
  await using _screen = await render(
    <div className="flex h-[600px] flex-col">
      <DiffFileTree entries={entries} onSelectFile={() => {}} ariaLabel="Changed files" />
    </div>,
  );
  const collapseAll = page.getByRole("button", { name: "Collapse all folders" });
  await expect.element(collapseAll).toBeVisible();
  await userEvent.click(collapseAll);
  const expandAll = page.getByRole("button", { name: "Expand all folders" });
  await expect.element(expandAll).toBeVisible();
  getItem.mockClear();
  await userEvent.click(expandAll);
  await expect.element(page.getByRole("button", { name: "Collapse all folders" })).toBeVisible();
  // Each of the expansions used to look up the folders again from the first one, so the lookups
  // grew with the square of the folder count (hundreds of thousands at 600 folders).
  expect(getItem.mock.calls.length).toBeLessThan(FOLDERS * 2 * 20);
});

it("carries a dragged file to the composer without moving the diff off the open file", async () => {
  const onSelectFile = vi.fn();
  const container = document.createElement("div");
  container.style.cssText = "display: flex; flex-direction: column; width: 320px; height: 480px";
  await using screen = await render(
    <DiffFileTree
      entries={[
        { path: "01-tall.ts", status: "modified" },
        { path: "02-short.ts", status: "modified" },
      ]}
      ariaLabel="Working tree files"
      selectedPath="02-short.ts"
      onSelectFile={onSelectFile}
    />,
    { container },
  );
  const row = (path: string) => {
    const host = screen.container.querySelector("file-tree-container");
    const element = (host?.shadowRoot ?? screen.container).querySelector<HTMLElement>(
      `[data-item-path="${CSS.escape(path)}"]`,
    );
    if (!element) throw new Error(`Missing file row: ${path}`);
    return element;
  };
  const transfer = new DataTransfer();
  await act(() =>
    row("01-tall.ts").dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: transfer }),
    ),
  );
  expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe("[01-tall.ts](01-tall.ts)");
  expect(onSelectFile).not.toHaveBeenCalled();
  await act(() =>
    row("01-tall.ts").dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true })),
  );
  expect(row("02-short.ts").getAttribute("aria-selected")).toBe("true");
  expect(onSelectFile).not.toHaveBeenCalled();
});
