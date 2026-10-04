// @vitest-environment jsdom

import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TicketTitleInput } from "./TicketTitleInput";
import { type DocumentWriteOutcome, useAutosavedDocument } from "./useAutosavedDocument";
import { useTitleDraft } from "./useTitleDraft";

vi.mock("../ui/toast", () => ({
  stackedThreadToast: (input: unknown) => input,
  toastManager: { add: vi.fn() },
}));

type Summary = { readonly revision: number; readonly title: string };
type Outcome = DocumentWriteOutcome<Summary>;

const SAVED: Summary = { revision: 1, title: "Saved title" };
const writeTitle = vi.fn<(expectedRevision: number, title: string) => Promise<Outcome>>();

function deferredWrite() {
  let resolve = (_value: Outcome) => {};
  const promise = new Promise<Outcome>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function Harness() {
  const doc = useAutosavedDocument({
    summary: SAVED,
    body: "Saved body",
    writeBody: useCallback(async () => null, []),
    fieldConflictTitle: "Changed",
  });
  const { writeFields } = doc;
  const saveTitle = useCallback(
    (title: string) => writeFields(() => (expectedRevision) => writeTitle(expectedRevision, title)),
    [writeFields],
  );
  const title = useTitleDraft(SAVED.title, { readLatest: doc.readLatest, saveTitle });
  return <TicketTitleInput title={title} label="Title" readOnly={false} />;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeTitle.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function input() {
  return container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]')!;
}

async function type(title: string, blur = false) {
  const textarea = input();
  await act(async () => {
    textarea.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      title,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    if (blur) textarea.blur();
  });
}

function canUnload() {
  return window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

describe("useTitleDraft", () => {
  it("protects a focused changed title before its first write", async () => {
    await type("Unsaved focused title");
    expect(canUnload()).toBe(false);
    expect(writeTitle).not.toHaveBeenCalled();
  });

  it("keeps pending and failed title saves protected, and allows unload after retry saves", async () => {
    const reply = deferredWrite();
    writeTitle.mockReturnValueOnce(reply.promise).mockResolvedValue({
      summary: { revision: 2, title: "Retained title" },
      claimed: [],
    });
    await type("Retained title", true);
    expect(canUnload()).toBe(false);
    await act(async () => reply.resolve(null));
    expect(canUnload()).toBe(false);
    expect(input().value).toBe("Retained title");
    await type("Retained title", true);
    expect(canUnload()).toBe(true);
  });

  it("allows unchanged and empty title drafts to unload", async () => {
    for (const title of ["Saved title", " Saved title ", "", "   "]) {
      await type(title);
      expect(canUnload()).toBe(true);
    }
    expect(writeTitle).not.toHaveBeenCalled();
  });

  it("protects a failed restoration until the stream catches up to the earlier title reply", async () => {
    const reply = deferredWrite();
    writeTitle.mockReturnValueOnce(reply.promise).mockResolvedValue(null);
    await type("Temporary title", true);
    await type("Saved title", true);
    await act(async () =>
      reply.resolve({ summary: { revision: 2, title: "Temporary title" }, claimed: [] }),
    );
    expect(writeTitle).toHaveBeenCalledTimes(2);
    expect(canUnload()).toBe(false);
  });

  it("saves a restoration after the earlier title reply lands ahead of its stream", async () => {
    const reply = deferredWrite();
    writeTitle
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValue({ summary: { revision: 3, title: "Saved title" }, claimed: [] });
    await type("Temporary title", true);
    await type("Saved title");
    await act(async () =>
      reply.resolve({ summary: { revision: 2, title: "Temporary title" }, claimed: [] }),
    );
    expect(canUnload()).toBe(false);
    await type("Saved title", true);
    expect(writeTitle).toHaveBeenLastCalledWith(2, "Saved title");
    expect(canUnload()).toBe(true);
  });

  it("drops the draft on Escape without writing it", async () => {
    await type("Abandoned title");
    await act(async () =>
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(input().value).toBe("Saved title");
    expect(writeTitle).not.toHaveBeenCalled();
    expect(canUnload()).toBe(true);
  });
});
