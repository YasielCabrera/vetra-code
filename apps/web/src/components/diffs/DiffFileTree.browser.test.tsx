import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { COMPOSER_MENTION_DRAG_TYPE } from "../chat/composerMentionDrag";
import { DiffFileTree } from "./DiffFileTree";

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
