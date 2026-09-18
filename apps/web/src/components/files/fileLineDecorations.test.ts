import type { VcsFileBlameResult, VcsFileLineChangesResult } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  blameCommitIndexAtLine,
  buildFileLineDecorationIndex,
  deletionCountAfterLine,
  FILE_CHANGE_ADDED,
  FILE_CHANGE_MODIFIED,
  FILE_CHANGE_NONE,
  fileChangeAtLine,
  isCurrentBlameAuthor,
} from "./fileLineDecorations";
import {
  FILE_LINE_DECORATIONS_UNSAFE_CSS,
  installFileEditorCaretListeners,
  stampFileLineDecorations,
} from "./useFileLineDecorations";

const headOid = "1111111111111111111111111111111111111111";
const otherOid = "2222222222222222222222222222222222222222";

const lineChanges: VcsFileLineChangesResult = {
  state: "modified",
  headOid,
  lineCount: 6,
  addedRanges: [2, 2],
  modifiedRanges: [5, 1],
  deletionMarkers: [0, 1, 6, 2],
};

const blame: VcsFileBlameResult = {
  firstLine: 1,
  lineCount: 6,
  headOid,
  commits: [
    {
      oid: headOid,
      author: "You Person",
      authorEmail: "you@example.com",
      authorTime: 1_700_000_000,
      summary: "First lines",
    },
    {
      oid: otherOid,
      author: "Other Person",
      authorEmail: "other@example.com",
      authorTime: 1_600_000_000,
      summary: "Later lines",
    },
  ],
  runs: [2, 0, 4, 1],
  localIdentity: { author: "You Person", authorEmail: "YOU@example.com" },
};

describe("file line decoration index", () => {
  it("indexes changes, deletions, and blame runs without per-line objects", () => {
    const index = buildFileLineDecorationIndex(6, lineChanges, blame);

    expect(fileChangeAtLine(index, 1)).toBe(FILE_CHANGE_NONE);
    expect(fileChangeAtLine(index, 2)).toBe(FILE_CHANGE_ADDED);
    expect(fileChangeAtLine(index, 3)).toBe(FILE_CHANGE_ADDED);
    expect(fileChangeAtLine(index, 5)).toBe(FILE_CHANGE_MODIFIED);
    expect(deletionCountAfterLine(index, 0)).toBe(1);
    expect(deletionCountAfterLine(index, 6)).toBe(2);
    expect(blameCommitIndexAtLine(index, 2)).toBe(0);
    expect(blameCommitIndexAtLine(index, 3)).toBe(1);
    expect(isCurrentBlameAuthor(index.commits[0]!, index.localIdentity)).toBe(true);
    expect(isCurrentBlameAuthor(index.commits[1]!, index.localIdentity)).toBe(false);
  });

  it("drops answers whose line count cannot describe the rendered buffer", () => {
    const index = buildFileLineDecorationIndex(5, lineChanges, blame);
    expect([...index.changes]).toEqual([0, 0, 0, 0, 0]);
    expect(index.deletionAfterLines).toHaveLength(0);
    expect(index.blameEndLines).toHaveLength(0);
  });

  it("drops blame captured against a different HEAD", () => {
    const index = buildFileLineDecorationIndex(6, lineChanges, {
      ...blame,
      headOid: otherOid,
    });
    expect(index.blameEndLines).toHaveLength(0);
  });
});

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<() => void>>();
  readonly ownerDocument = this;
  focused = false;
  shadowRoot: FakeElement | null = null;

  append(...children: FakeElement[]): this {
    this.children.push(...children);
    return this;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  matches(selector: string): boolean {
    return selector === ":focus" && this.focused;
  }

  querySelector(selector: string): FakeElement | null {
    if (
      selector === "[data-content][contenteditable=true]" &&
      this.hasAttribute("data-content") &&
      this.getAttribute("contenteditable") === "true"
    ) {
      return this;
    }
    const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
    if (attribute && this.hasAttribute(attribute)) return this;
    for (const child of this.children) {
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

const originalHTMLElement = globalThis.HTMLElement;
afterEach(() => {
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: originalHTMLElement,
  });
});

describe("stampFileLineDecorations", () => {
  it("stamps both virtualized columns and removes stale attributes", () => {
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeElement,
    });
    const gutterCell = new FakeElement();
    gutterCell.dataset.lineIndex = "1";
    gutterCell.setAttribute("data-column-number", "2");
    const contentRow = new FakeElement();
    contentRow.dataset.lineIndex = "1";
    contentRow.setAttribute("data-line", "2");
    const gutter = new FakeElement().append(gutterCell);
    const content = new FakeElement().append(contentRow);
    const code = new FakeElement().append(gutter, content);
    code.setAttribute("data-code", "");
    const container = new FakeElement().append(code);
    const index = buildFileLineDecorationIndex(6, lineChanges, blame);

    stampFileLineDecorations(container as unknown as HTMLElement, index, true, 2);
    expect(gutterCell.getAttribute("data-vetra-change")).toBe("added");
    expect(gutterCell.getAttribute("aria-label")).toContain("Line 2, added");
    expect(contentRow.getAttribute("data-vetra-active-line")).toBe("");
    expect(contentRow.getAttribute("data-vetra-blame-inline")).toContain("You ·");

    stampFileLineDecorations(container as unknown as HTMLElement, index, false, 2);
    expect(gutterCell.getAttribute("data-vetra-change")).toBe("added");
    expect(contentRow.getAttribute("data-vetra-active-line")).toBeNull();
    expect(contentRow.getAttribute("data-vetra-blame-inline")).toBeNull();

    stampFileLineDecorations(
      container as unknown as HTMLElement,
      buildFileLineDecorationIndex(6, null, null),
      false,
    );
    expect(gutterCell.getAttribute("data-vetra-change")).toBeNull();
    expect(gutterCell.getAttribute("aria-label")).toBeNull();
    expect(contentRow.getAttribute("data-vetra-active-line")).toBeNull();
    expect(contentRow.getAttribute("data-vetra-blame-inline")).toBeNull();
  });
});

describe("inline blame styling", () => {
  it("follows the focused caret line without changing line layout", () => {
    expect(FILE_LINE_DECORATIONS_UNSAFE_CSS).toContain(
      "[data-content]:focus > [data-line][data-vetra-active-line][data-vetra-blame-inline]::after",
    );
    expect(FILE_LINE_DECORATIONS_UNSAFE_CSS).toContain("position: absolute !important");
    expect(FILE_LINE_DECORATIONS_UNSAFE_CSS).toContain("inset: auto !important");
    expect(FILE_LINE_DECORATIONS_UNSAFE_CSS).toContain("margin-inline-start: 3ch");
    expect(FILE_LINE_DECORATIONS_UNSAFE_CSS).not.toContain("[data-hovered]");
    expect(FILE_LINE_DECORATIONS_UNSAFE_CSS).not.toContain("data-vetra-blame-column");
  });

  it("tracks focus and caret movement inside Pierre's shadow editor", () => {
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeElement,
    });
    const container = new FakeElement();
    const root = new FakeElement();
    container.shadowRoot = root;
    const content = new FakeElement();
    content.setAttribute("data-content", "");
    content.setAttribute("contenteditable", "true");
    root.append(content);
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onCaretMove = vi.fn();

    const listeners = installFileEditorCaretListeners(container as unknown as HTMLElement, {
      onFocus,
      onBlur,
      onCaretMove,
    });
    expect(listeners?.content).toBe(content as unknown as HTMLElement);

    content.focused = true;
    content.dispatch("focus");
    content.dispatch("keydown");
    content.dispatch("pointerup");
    content.dispatch("selectionchange");
    content.focused = false;
    content.dispatch("blur");
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onCaretMove).toHaveBeenCalledTimes(3);
    expect(onBlur).toHaveBeenCalledOnce();

    listeners?.dispose();
    content.dispatch("focus");
    content.dispatch("keydown");
    content.dispatch("pointerup");
    content.dispatch("selectionchange");
    content.dispatch("blur");
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onCaretMove).toHaveBeenCalledTimes(3);
    expect(onBlur).toHaveBeenCalledOnce();
  });
});
