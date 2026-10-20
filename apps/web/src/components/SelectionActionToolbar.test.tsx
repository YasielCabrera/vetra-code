// @vitest-environment jsdom

import { QuoteIcon } from "lucide-react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SelectionActionToolbar } from "./SelectionActionToolbar";

const run = vi.fn<(text: string) => boolean>();

function Harness() {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  return (
    <div ref={setViewport}>
      <p>Selected words</p>
      <SelectionActionToolbar
        viewport={viewport}
        capture={(selection) =>
          selection === null || selection.isCollapsed ? null : { range: selection.getRangeAt(0) }
        }
        actions={({ range }) => [
          {
            label: "Cite",
            ariaLabel: "Cite selection",
            icon: QuoteIcon,
            run: () => run(`${range}`),
          },
        ]}
      />
    </div>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
  // jsdom lays nothing out; a selection needs a visible line to show its actions.
  const line = DOMRect.fromRect({ x: 0, y: 0, width: 40, height: 10 });
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => line },
    getClientRects: {
      configurable: true,
      value: () => Object.assign([line], { item: (index: number) => (index === 0 ? line : null) }),
    },
  });
  run.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function select() {
  vi.spyOn(container.firstElementChild!, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 400, height: 300 }),
  );
  await act(async () => {
    window.getSelection()!.selectAllChildren(container.querySelector("p")!);
    document.dispatchEvent(new Event("selectionchange"));
    vi.runAllTimers();
  });
}

function action() {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Cite selection"]');
}

describe("SelectionActionToolbar", () => {
  it.each([
    [100, 80, "50px", "34px"],
    [30, 25, "30px", "25px"],
  ])(
    "anchors a release at (%d, %d) to the selection when outside its text",
    async (x, y, left, top) => {
      const viewport = container.firstElementChild!;
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ width: 400, height: 300 }),
      );
      const rect = DOMRect.fromRect({ x: 10, y: 20, width: 40, height: 10 });
      Object.defineProperties(Range.prototype, {
        getBoundingClientRect: { configurable: true, value: () => rect },
        getClientRects: {
          configurable: true,
          value: () =>
            Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) }),
        },
      });

      await act(async () => {
        container.querySelector("p")!.dispatchEvent(
          Object.assign(new Event("pointerdown", { bubbles: true }), {
            isPrimary: true,
            button: 0,
          }),
        );
        window.getSelection()!.selectAllChildren(container.querySelector("p")!);
        window.dispatchEvent(Object.assign(new Event("pointerup"), { isPrimary: true, button: 0 }));
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, button: 0 }));
        vi.runAllTimers();
      });

      expect(action()?.parentElement?.style.left).toBe(left);
      expect(action()?.parentElement?.style.top).toBe(top);
    },
  );

  it("clears the selection and hides once an action takes it", async () => {
    run.mockReturnValue(true);
    await select();
    await act(async () => action()!.click());
    expect(run).toHaveBeenCalledWith("Selected words");
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(action()).toBeNull();
  });

  it("keeps the selection and the actions when an action declines it", async () => {
    run.mockReturnValue(false);
    await select();
    await act(async () => action()!.click());
    expect(window.getSelection()!.toString()).toBe("Selected words");
    expect(action()).not.toBeNull();
  });

  it("moves Tab from the selection to the first action, and hides on Escape", async () => {
    await select();
    await act(async () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(action());
    await act(async () =>
      action()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(action()).toBeNull();
  });
});
