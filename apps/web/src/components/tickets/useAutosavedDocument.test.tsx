// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useAutosavedDocument, type DocumentWriteOutcome } from "./useAutosavedDocument";

vi.mock("../ui/toast", () => ({
  stackedThreadToast: (input: unknown) => input,
  toastManager: { add: vi.fn() },
}));

type Summary = { readonly revision: number };
type DocumentOptions = Parameters<typeof useAutosavedDocument<Summary>>[0];

const SAVED: Summary = { revision: 1 };

function deferredWrite() {
  let resolve = (_value: DocumentWriteOutcome<Summary>) => {};
  const promise = new Promise<DocumentWriteOutcome<Summary>>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let doc: ReturnType<typeof useAutosavedDocument<Summary>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = globalThis.document.createElement("div");
  globalThis.document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness(props: DocumentOptions) {
  const current = useAutosavedDocument(props);
  useLayoutEffect(() => {
    doc = current;
  }, [current]);
  return <p>{current.state.text}</p>;
}

async function renderDocument(writeBody: DocumentOptions["writeBody"]) {
  await act(async () =>
    root.render(
      <Harness
        summary={SAVED}
        body="Saved body"
        writeBody={writeBody}
        fieldConflictTitle="Changed"
      />,
    ),
  );
}

function canUnload() {
  return window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

describe("useAutosavedDocument unload protection", () => {
  it("allows a clean document to unload, protects a dirty body, and allows it after saving", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
      summary: { revision: 2 },
      claimed: [],
    });
    await renderDocument(writeBody);
    expect(canUnload()).toBe(true);
    await act(async () => doc.edit("Unsaved reload draft"));
    expect(canUnload()).toBe(false);
    expect(writeBody).not.toHaveBeenCalled();
    await act(async () => expect(await doc.flush()).toBe(true));
    expect(canUnload()).toBe(true);
  });

  it("protects an in-flight field write even when the body has no unsaved changes", async () => {
    const titleReply = deferredWrite();
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>());
    await act(async () => {
      void doc.writeFields(() => () => titleReply.promise);
    });
    expect(canUnload()).toBe(false);
    await act(async () => titleReply.resolve({ summary: { revision: 2 }, claimed: [] }));
    expect(canUnload()).toBe(true);
  });

  it("stops protecting a dirty document once that page unmounts", async () => {
    await renderDocument(
      vi
        .fn<DocumentOptions["writeBody"]>()
        .mockResolvedValue({ summary: { revision: 2 }, claimed: [] }),
    );
    await act(async () => doc.edit("Unsaved old page"));
    expect(canUnload()).toBe(false);
    await act(async () => root.unmount());
    expect(canUnload()).toBe(true);
  });
});

describe("useAutosavedDocument.flush", () => {
  it("drains a pending title write before saving the current body at its newest revision", async () => {
    const titleReply = deferredWrite();
    const bodyReply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>(() => bodyReply.promise);
    await renderDocument(writeBody);

    await act(async () => {
      void doc.writeFields(() => () => titleReply.promise);
      doc.edit("Unsaved body");
    });
    let flushed = Promise.resolve(false);
    await act(async () => {
      flushed = doc.flush();
    });
    expect(writeBody).not.toHaveBeenCalled();

    await act(async () => titleReply.resolve({ summary: { revision: 2 }, claimed: [] }));
    expect(writeBody).toHaveBeenCalledWith(2, "Unsaved body", []);
    await act(async () => bodyReply.resolve({ summary: { revision: 3 }, claimed: [] }));
    expect(await flushed).toBe(true);
    expect(container.textContent).toBe("Unsaved body");
    expect(doc.state.base.body).toBe("Unsaved body");
  });

  it("saves edits made while a prior body write is in flight before resolving", async () => {
    const firstReply = deferredWrite();
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockImplementationOnce(() => firstReply.promise)
      .mockResolvedValue({ summary: { revision: 3 }, claimed: [] });
    await renderDocument(writeBody);
    await act(async () => {
      doc.edit("First edit");
      void doc.flush();
    });
    let flushed = Promise.resolve(false);
    await act(async () => {
      doc.edit("Latest edit");
      flushed = doc.flush();
    });
    expect(writeBody).toHaveBeenCalledTimes(1);
    await act(async () => firstReply.resolve({ summary: { revision: 2 }, claimed: [] }));
    expect(await flushed).toBe(true);
    expect(writeBody).toHaveBeenLastCalledWith(2, "Latest edit", []);
    expect(doc.state.base.body).toBe("Latest edit");
  });

  it("reports failed saves without discarding the draft, and retries the same draft explicitly", async () => {
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ summary: { revision: 2 }, claimed: [] });
    await renderDocument(writeBody);
    await act(async () => doc.edit("Keep this draft"));
    await act(async () => expect(await doc.flush()).toBe(false));
    expect(container.textContent).toBe("Keep this draft");
    expect(doc.state.base.body).toBe("Saved body");

    await act(async () => expect(await doc.flush()).toBe(true));
    expect(writeBody).toHaveBeenCalledTimes(2);
    expect(doc.state.base.body).toBe("Keep this draft");
  });

  it("reports a revision conflict and leaves the draft for the reader to resolve", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue("conflict");
    await renderDocument(writeBody);
    await act(async () => doc.edit("Keep my edit"));
    await act(async () => expect(await doc.flush()).toBe(false));
    await act(async () => expect(await doc.flush()).toBe(false));
    expect(writeBody).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("Keep my edit");
    expect(doc.state.conflict).toBe(true);
  });
});
