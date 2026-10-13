// @vitest-environment jsdom

import { act, StrictMode, useCallback, useLayoutEffect } from "react";
import { ChatAttachmentId } from "@t3tools/contracts";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { releaseAttachmentUpload } from "../../lib/attachmentUploadQueue";
import { createNavigationDrafts } from "../../lib/navigationDrafts";
import { toastManager } from "../ui/toast";
import { TicketTitleInput } from "./TicketTitleInput";
import {
  useAutosavedDocument,
  type DocumentWrite,
  type DocumentWriteOutcome,
} from "./useAutosavedDocument";
import { useTitleDraft } from "./useTitleDraft";

vi.mock("../ui/toast", () => ({
  stackedThreadToast: (input: unknown) => input,
  toastManager: { add: vi.fn(), close: vi.fn() },
}));
vi.mock("../../lib/attachmentUploadQueue", () => ({ releaseAttachmentUpload: vi.fn() }));

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
  vi.mocked(releaseAttachmentUpload).mockClear();
  vi.mocked(toastManager.add).mockClear();
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

async function renderDocument(
  writeBody: DocumentOptions["writeBody"],
  summary: Summary = SAVED,
  body = "Saved body",
  recovery?: DocumentOptions["recovery"],
) {
  await act(async () =>
    root.render(
      <Harness
        key={recovery?.key}
        summary={summary}
        body={body}
        writeBody={writeBody}
        fieldConflictTitle="Changed"
        recovery={recovery}
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
      acknowledgement: { kind: "legacy", revision: 2 },
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
    await act(async () =>
      titleReply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    expect(canUnload()).toBe(true);
  });

  it("protects an inherited title save after returning to an unchanged description", async () => {
    const titleReply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>();
    const recovery = {
      key: "environment-a/ticket/pending-title",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => {
      void doc.writeFields(() => () => titleReply.promise);
    });
    await act(async () => root.render(null));
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    expect(container.textContent).toBe("Saved body");
    expect(canUnload()).toBe(false);
    await act(async () =>
      titleReply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    expect(canUnload()).toBe(true);
    expect(doc.readLatest().revision).toBe(2);
    expect(doc.state.base).toEqual({ revision: 2, body: "Saved body" });
    expect(writeBody).not.toHaveBeenCalled();
  });

  it("stops protecting a dirty document once that page unmounts", async () => {
    await renderDocument(
      vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    await act(async () => doc.edit("Unsaved old page"));
    expect(canUnload()).toBe(false);
    await act(async () => root.unmount());
    expect(canUnload()).toBe(true);
  });
});

describe("navigation draft handoff", () => {
  it("keeps a returning editor's claim valid when its departing save settles first", async () => {
    const drafts = createNavigationDrafts<{ readonly text: string }>();
    const staged = drafts.stage("environment-a/ticket/render-effect-race", {
      text: "Draft on leave",
    });
    const returning = drafts.get("environment-a/ticket/render-effect-race");
    if (returning === undefined) throw new Error("Draft was lost before return");
    drafts.settle(staged, { text: "Final text from the failed save" }, true);
    expect(drafts.take(returning)).toBe(true);
    expect(await returning.settled).toEqual({ text: "Final text from the failed save" });
  });
});

describe("useAutosavedDocument navigation recovery", () => {
  it("keeps a known description conflict after leaving and returning", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue("conflict");
    const recovery = {
      key: "environment-a/ticket/known-conflict",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    recovery.reopen.mockImplementation(() => {
      void renderDocument(writeBody, { revision: 2 }, "Agent description", recovery);
    });
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("My description before navigation"));
    await renderDocument(writeBody, { revision: 2 }, "Agent description", recovery);
    await act(async () => expect(await doc.flush()).toBe(false));
    expect(doc.state.conflict).toBe(true);

    await act(async () => root.render(null));
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({ actionProps: expect.objectContaining({ children: "Reopen" }) }),
    );
    const notification = vi.mocked(toastManager.add).mock.calls.at(-1)?.[0];
    if (notification?.actionProps === undefined) throw new Error("Recovery action is missing");
    await act(async () => root.render(<button {...notification.actionProps} />));
    const reopenButton = container.querySelector("button");
    if (reopenButton === null) throw new Error("Recovery action is missing");
    await act(async () => reopenButton.click());
    expect(container.textContent).toBe("My description before navigation");
    expect(doc.state.conflict).toBe(true);
    expect(doc.state.server).toEqual({ revision: 2, body: "Agent description" });
  });

  it("keeps a draft when the navigation flush discovers a concurrent save", async () => {
    const reply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>(() => reply.promise);
    const recovery = {
      key: "environment-a/ticket/late-conflict",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("My edit inside the autosave window"));

    await act(async () => root.render(null));
    expect(writeBody).toHaveBeenCalledExactlyOnceWith(1, "My edit inside the autosave window", []);
    await act(async () => reply.resolve("conflict"));
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({ actionProps: expect.objectContaining({ children: "Reopen" }) }),
    );
    await renderDocument(writeBody, { revision: 2 }, "Other device description", recovery);
    expect(container.textContent).toBe("My edit inside the autosave window");
    expect(doc.state.conflict).toBe(true);
    expect(doc.state.server).toEqual({ revision: 2, body: "Other device description" });
  });

  it("commits a focused title without blur while retaining the conflicted description", async () => {
    type TitleSummary = Summary & { readonly title: string };
    const writeTitle = vi
      .fn<
        (expectedRevision: number, title: string) => Promise<DocumentWriteOutcome<TitleSummary>>
      >()
      .mockResolvedValue({
        summary: { revision: 3, title: "Title saved on navigation" },
        acknowledgement: { kind: "legacy", revision: 3 },
        claimed: [],
      });
    const writeBody = vi.fn<DocumentOptions["writeBody"]>();
    const recovery = {
      key: "environment-a/ticket/title-conflict",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    let editDescription = (_text: string) => {};
    let flushDescription = async () => true;
    function TitleHarness({ summary, body }: { summary: TitleSummary; body: string }) {
      const current = useAutosavedDocument({
        summary,
        body,
        writeBody: useCallback(async () => "conflict" as const, []),
        fieldConflictTitle: "Changed",
        recovery,
      });
      const { writeFields } = current;
      const saveTitle = useCallback(
        (title: string) => writeFields(() => (revision) => writeTitle(revision, title)),
        [writeFields],
      );
      const title = useTitleDraft(summary.title, { readLatest: current.readLatest, saveTitle });
      useLayoutEffect(() => {
        editDescription = current.edit;
        flushDescription = current.flush;
      }, [current.edit, current.flush]);
      return (
        <>
          <TicketTitleInput title={title} label="Title" readOnly={false} />
          <p>{current.state.text}</p>
        </>
      );
    }
    await act(async () =>
      root.render(
        <TitleHarness summary={{ revision: 1, title: "Saved title" }} body="Saved body" />,
      ),
    );
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]');
    if (textarea === null) throw new Error("Title input is missing");
    await act(async () => {
      textarea.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Title saved on navigation",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      editDescription("Description retained with focused title");
    });
    await act(async () =>
      root.render(
        <TitleHarness summary={{ revision: 2, title: "Saved title" }} body="Agent description" />,
      ),
    );
    expect(document.activeElement).toBe(textarea);
    expect(writeTitle).not.toHaveBeenCalled();
    await act(async () => expect(await flushDescription()).toBe(false));
    await act(async () => root.render(null));
    expect(writeTitle.mock.calls).toEqual([[2, "Title saved on navigation"]]);
    await renderDocument(writeBody, { revision: 3 }, "Agent description", recovery);
    expect(container.textContent).toBe("Description retained with focused title");
    expect(doc.state.conflict).toBe(true);
  });

  it("keeps edits made after returning before the old navigation save conflicts", async () => {
    const reply = deferredWrite();
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValue({
        summary: { revision: 3 },
        acknowledgement: { kind: "legacy", revision: 3 },
        claimed: [],
      });
    const recovery = {
      key: "environment-a/ticket/quick-return",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("Draft before leaving"));
    await act(async () => root.render(null));
    await renderDocument(writeBody, { revision: 2 }, "Remote description", recovery);
    expect(container.textContent).toBe("Draft before leaving");
    await act(async () => doc.edit("More typing after returning"));
    await act(async () => reply.resolve("conflict"));
    expect(container.textContent).toBe("More typing after returning");
    expect(doc.state.conflict).toBe(true);
    await act(async () => doc.keepMine());
    expect(writeBody).toHaveBeenLastCalledWith(2, "More typing after returning", []);
    expect(doc.state.base.body).toBe("More typing after returning");
    expect(doc.state.conflict).toBe(false);
  });

  it("accepts its outgoing successful save while keeping new typing after a quick return", async () => {
    const reply = deferredWrite();
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValue({
        summary: { revision: 3 },
        acknowledgement: { kind: "legacy", revision: 3 },
        claimed: [],
      });
    const recovery = {
      key: "environment-a/ticket/quick-success",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => {
      doc.edit("First edit saved while away");
      void doc.flush();
    });
    await act(async () => root.render(null));
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("Newest typing after return"));
    await act(async () =>
      reply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    expect(container.textContent).toBe("Newest typing after return");
    expect(doc.state.base).toEqual({ revision: 2, body: "First edit saved while away" });
    expect(doc.state.conflict).toBe(false);
    await renderDocument(writeBody, { revision: 2 }, "First edit saved while away", recovery);
    expect(doc.state.conflict).toBe(false);
    await act(async () => expect(await doc.flush()).toBe(true));
    expect(writeBody.mock.calls).toEqual([
      [1, "First edit saved while away", []],
      [2, "Newest typing after return", []],
    ]);
    expect(doc.state.base).toEqual({ revision: 3, body: "Newest typing after return" });
  });

  it("retains a pending revert across two quick departures before the first save lands", async () => {
    const reply = deferredWrite();
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValue(null);
    const recovery = {
      key: "environment-a/ticket/quick-revert-twice",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => {
      doc.edit("First edit");
      void doc.flush();
    });
    await act(async () => doc.edit("Saved body"));
    await act(async () => root.render(null));
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    expect(container.textContent).toBe("Saved body");
    expect(doc.state.base.body).toBe("Saved body");
    expect(canUnload()).toBe(false);
    await act(async () => root.render(null));
    await act(async () =>
      reply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Description draft kept",
        actionProps: expect.objectContaining({ children: "Reopen" }),
      }),
    );
    await renderDocument(writeBody, { revision: 2 }, "First edit", recovery);
    expect(container.textContent).toBe("Saved body");
    expect(doc.state.base).toEqual({ revision: 2, body: "First edit" });
    expect(doc.state.failedText).toBe("Saved body");
    expect(writeBody).toHaveBeenLastCalledWith(2, "Saved body", []);
  });

  it("isolates retained drafts by environment and document identity", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue("conflict");
    const recovery = {
      key: "environment-a/ticket/isolated",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => {
      doc.edit("Draft belonging to environment A");
      expect(await doc.flush()).toBe(false);
    });
    await act(async () => root.render(null));
    await renderDocument(writeBody, SAVED, "Environment B body", {
      ...recovery,
      key: "environment-b/ticket/isolated",
    });
    expect(container.textContent).toBe("Environment B body");
    await renderDocument(writeBody, SAVED, "Different ticket body", {
      ...recovery,
      key: "environment-a/ticket/different",
    });
    expect(container.textContent).toBe("Different ticket body");
    await renderDocument(writeBody, { revision: 2 }, "Agent body", recovery);
    expect(container.textContent).toBe("Draft belonging to environment A");
    expect(doc.state.conflict).toBe(true);
  });

  it("retains referenced uploads until a restored draft claims them", async () => {
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockResolvedValueOnce("conflict")
      .mockResolvedValue({
        summary: { revision: 3 },
        acknowledgement: { kind: "legacy", revision: 3 },
        claimed: [{ pendingId: "retained-shot", attachmentId: "saved-shot" }],
      });
    const recovery = {
      key: "environment-a/ticket/retained-upload",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    const attachment = {
      type: "file" as const,
      id: ChatAttachmentId.make("retained-shot"),
      name: "shot.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => {
      doc.addPendingUpload({ localId: "retained-local", attachment });
      doc.edit("Retain ![shot](vetra-attachment://retained-shot)");
      expect(await doc.flush()).toBe(false);
    });
    await act(async () => root.render(null));
    expect(releaseAttachmentUpload).not.toHaveBeenCalled();
    await renderDocument(writeBody, { revision: 2 }, "Remote body", recovery);
    expect(container.textContent).toBe("Retain ![shot](vetra-attachment://retained-shot)");
    await act(async () => doc.keepMine());
    expect(writeBody).toHaveBeenLastCalledWith(
      2,
      "Retain ![shot](vetra-attachment://retained-shot)",
      [attachment],
    );
    expect(container.textContent).toBe("Retain ![shot](vetra-attachment://saved-shot)");
    expect(releaseAttachmentUpload).toHaveBeenCalledExactlyOnceWith("retained-local");
  });

  it("retains an old-server plan save until its body is verified on return", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
      summary: { revision: 2 },
      acknowledgement: { kind: "unverified" },
      claimed: [],
    });
    const recovery = {
      key: "environment-a/plan/unverified",
      title: "Plan draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("Plan waiting for full content"));
    await act(async () => root.render(null));
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    expect(container.textContent).toBe("Plan waiting for full content");
    expect(doc.state.failedText).toBe("Plan waiting for full content");
    expect(doc.state.conflict).toBe(false);
    await renderDocument(writeBody, { revision: 2 }, "Plan waiting for full content", recovery);
    expect(doc.state.base).toEqual({ revision: 2, body: "Plan waiting for full content" });
    expect(doc.state.conflict).toBe(false);
    expect(writeBody).toHaveBeenCalledTimes(1);
  });

  it("restores a failed transport save without claiming someone else edited it", async () => {
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      });
    const recovery = {
      key: "environment-a/ticket/transport-failure",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("Draft waiting for a retry"));
    await act(async () => root.render(null));
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    expect(container.textContent).toBe("Draft waiting for a retry");
    expect(doc.state.failedText).toBe("Draft waiting for a retry");
    expect(doc.state.conflict).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(writeBody).toHaveBeenCalledTimes(1);
    await act(async () => expect(await doc.flush()).toBe(true));
    expect(doc.state.base.body).toBe("Draft waiting for a retry");
  });

  it("reconciles streamed plan content when an old-server reply arrives after return", async () => {
    const reply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>(() => reply.promise);
    const recovery = {
      key: "environment-a/plan/verified-after-return",
      title: "Plan draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => doc.edit("Plan text already streamed"));
    await act(async () => root.render(null));
    await renderDocument(writeBody, { revision: 2 }, "Plan text already streamed", recovery);
    await act(async () =>
      reply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "unverified" },
        claimed: [],
      }),
    );
    expect(container.textContent).toBe("Plan text already streamed");
    expect(doc.state.base).toEqual({ revision: 2, body: "Plan text already streamed" });
    expect(doc.state.conflict).toBe(false);
    expect(canUnload()).toBe(true);
    expect(writeBody).toHaveBeenCalledTimes(1);
  });

  it("restores a retained description conflict through Strict Mode effect replay", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue("conflict");
    const recovery = {
      key: "environment-a/ticket/strict-mode-conflict",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await renderDocument(writeBody, SAVED, "Saved body", recovery);
    await act(async () => {
      doc.edit("Retained conflict in Strict Mode");
      expect(await doc.flush()).toBe(false);
    });
    await act(async () => root.render(null));
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness
            summary={{ revision: 2 }}
            body="Remote body"
            writeBody={writeBody}
            fieldConflictTitle="Changed"
            recovery={recovery}
          />
        </StrictMode>,
      ),
    );
    expect(container.textContent).toBe("Retained conflict in Strict Mode");
    expect(doc.state.server).toEqual({ revision: 2, body: "Remote body" });
    expect(doc.state.conflict).toBe(true);
    expect(writeBody).toHaveBeenCalledTimes(1);
  });

  it("does not create a recovery toast or save from Strict Mode's clean effect replay", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
      summary: { revision: 2 },
      acknowledgement: { kind: "legacy", revision: 2 },
      claimed: [],
    });
    const recovery = {
      key: "environment-a/ticket/strict-mode",
      title: "Description draft kept",
      reopen: vi.fn(),
    };
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness
            summary={SAVED}
            body="Saved body"
            writeBody={writeBody}
            fieldConflictTitle="Changed"
            recovery={recovery}
          />
        </StrictMode>,
      ),
    );
    expect(container.textContent).toBe("Saved body");
    expect(writeBody).not.toHaveBeenCalled();
    expect(toastManager.add).not.toHaveBeenCalled();
    await act(async () => doc.edit("Strict Mode draft saved"));
    await act(async () => root.render(null));
    expect(writeBody).toHaveBeenCalledExactlyOnceWith(1, "Strict Mode draft saved", []);
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

    await act(async () =>
      titleReply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    expect(writeBody).toHaveBeenCalledWith(2, "Unsaved body", []);
    await act(async () =>
      bodyReply.resolve({
        summary: { revision: 3 },
        acknowledgement: { kind: "legacy", revision: 3 },
        claimed: [],
      }),
    );
    expect(await flushed).toBe(true);
    expect(container.textContent).toBe("Unsaved body");
    expect(doc.state.base.body).toBe("Unsaved body");
  });

  it("saves edits made while a prior body write is in flight before resolving", async () => {
    const firstReply = deferredWrite();
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockImplementationOnce(() => firstReply.promise)
      .mockResolvedValue({
        summary: { revision: 3 },
        acknowledgement: { kind: "legacy", revision: 3 },
        claimed: [],
      });
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
    await act(async () =>
      firstReply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      }),
    );
    expect(await flushed).toBe(true);
    expect(writeBody).toHaveBeenLastCalledWith(2, "Latest edit", []);
    expect(doc.state.base.body).toBe("Latest edit");
  });

  it("reports failed saves without discarding the draft, and retries the same draft explicitly", async () => {
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        summary: { revision: 2 },
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [],
      });
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

describe("useAutosavedDocument plan outcomes", () => {
  it.each(["commit", "unverified", "rejected"] as const)(
    "keeps claimed references and releases a successful %s upload exactly once",
    async (outcome) => {
      const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
        summary: { revision: 2 },
        acknowledgement:
          outcome === "unverified"
            ? { kind: "unverified" }
            : { kind: "commit", observedRevision: outcome === "rejected" ? 2 : 1, revision: 2 },
        claimed: [{ pendingId: "pending-shot", attachmentId: "plan-shot" }],
      });
      await renderDocument(writeBody);
      await act(async () => {
        doc.addPendingUpload({
          localId: "local-shot",
          attachment: {
            type: "file",
            id: ChatAttachmentId.make("pending-shot"),
            name: "shot.txt",
            mimeType: "text/plain",
            sizeBytes: 4,
          },
        });
        doc.edit("![shot](vetra-attachment://pending-shot)");
        expect(await doc.flush()).toBe(outcome !== "rejected");
      });
      expect(writeBody).toHaveBeenCalledWith(1, "![shot](vetra-attachment://pending-shot)", [
        expect.objectContaining({ id: "pending-shot" }),
      ]);
      expect(releaseAttachmentUpload).toHaveBeenCalledExactlyOnceWith("local-shot");
      expect(doc.state.text).toBe("![shot](vetra-attachment://plan-shot)");
      await act(async () => doc.edit("Undo ![shot](vetra-attachment://pending-shot)"));
      expect(doc.state.text).toBe("Undo ![shot](vetra-attachment://plan-shot)");
      await act(async () => root.unmount());
      expect(releaseAttachmentUpload).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["before", "after"])(
    "settles an old-server body save only from full content arriving %s its response",
    async (streamOrder) => {
      const reply = deferredWrite();
      const writeBody = vi.fn<DocumentOptions["writeBody"]>(() => reply.promise);
      await renderDocument(writeBody);
      await act(async () => {
        doc.edit("Saved by the older server");
        void doc.flush();
      });
      if (streamOrder === "before") {
        await renderDocument(writeBody, { revision: 2 }, "Saved by the older server");
      }
      await act(async () =>
        reply.resolve({
          summary: { revision: 2 },
          acknowledgement: { kind: "unverified" },
          claimed: [],
        }),
      );
      expect(doc.state.writing).toBeNull();
      expect(doc.state.conflict).toBe(false);
      if (streamOrder === "after") {
        expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
        await act(async () => vi.advanceTimersByTimeAsync(1600));
        expect(writeBody).toHaveBeenCalledTimes(1);
        await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
        await renderDocument(writeBody, { revision: 2 }, "Saved by the older server");
      }
      expect(doc.state.base).toEqual({ revision: 2, body: "Saved by the older server" });
      await act(async () => expect(await doc.flushReviewed(async () => true)).toBe(2));
      expect(writeBody).toHaveBeenCalledTimes(1);
      expect(canUnload()).toBe(true);
    },
  );

  it("preserves claims and subsequent edits while an unverified save awaits full content", async () => {
    const reply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>(() => reply.promise);
    await renderDocument(writeBody);
    await act(async () => {
      doc.edit("![shot](vetra-attachment://pending-shot)");
      void doc.flush();
      doc.edit("More ![shot](vetra-attachment://pending-shot)");
    });
    await act(async () =>
      reply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "unverified" },
        claimed: [{ pendingId: "pending-shot", attachmentId: "plan-shot" }],
      }),
    );
    await renderDocument(writeBody, { revision: 2 }, "![shot](vetra-attachment://plan-shot)");
    expect(doc.state.text).toBe("More ![shot](vetra-attachment://plan-shot)");
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    await act(async () => doc.edit("Undo ![shot](vetra-attachment://pending-shot)"));
    expect(doc.state.text).toBe("Undo ![shot](vetra-attachment://plan-shot)");
  });

  it("keeps a metadata summary from acknowledging a body that has not streamed", async () => {
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>());
    await act(async () =>
      expect(
        await doc.writeFields(() => async () => ({
          summary: { revision: 2 },
          acknowledgement: { kind: "metadata" },
          claimed: [],
        })),
      ).toBe(true),
    );
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    expect(doc.readLatest().revision).toBe(2);
    await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>(), { revision: 2 }, "Remote body");
    expect(doc.state.base).toEqual({ revision: 2, body: "Remote body" });
  });

  it("settles metadata from full content already streamed while the write was pending", async () => {
    const reply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>();
    await renderDocument(writeBody);
    let completed = Promise.resolve(false);
    await act(async () => {
      completed = doc.writeFields(() => () => reply.promise, { expectedRevision: 1 });
    });
    await renderDocument(writeBody, { revision: 2 }, "Remote body");
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    await act(async () =>
      reply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "metadata" },
        claimed: [],
      }),
    );
    expect(await completed).toBe(true);
    expect(doc.state.base).toEqual({ revision: 2, body: "Remote body" });
    expect(doc.state.text).toBe("Remote body");
  });

  it("does not bridge a missing full-content gap with a later verified title write", async () => {
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>());
    await act(async () => {
      expect(
        await doc.writeFields(() => async () => ({
          summary: { revision: 2 },
          acknowledgement: { kind: "unverified" },
          claimed: [],
        })),
      ).toBe(true);
      expect(
        await doc.writeFields(() => async () => ({
          summary: { revision: 3 },
          acknowledgement: { kind: "commit", observedRevision: 2, revision: 3 },
          claimed: [],
        })),
      ).toBe(true);
    });
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
    await renderDocument(
      vi.fn<DocumentOptions["writeBody"]>(),
      { revision: 3 },
      "Full remote body",
    );
    expect(doc.state.base).toEqual({ revision: 3, body: "Full remote body" });
    await act(async () => expect(await doc.flushReviewed(async () => true)).toBe(3));
  });

  it("uses the transaction receipt for an ordinary save with a newer reply summary", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
      summary: { revision: 3 },
      acknowledgement: { kind: "commit", observedRevision: 1, revision: 2 },
      claimed: [],
    });
    await renderDocument(writeBody);
    await act(async () => {
      doc.edit("My saved body");
      expect(await doc.flush()).toBe(true);
    });
    expect(doc.state.base).toEqual({ revision: 2, body: "My saved body" });
    expect(doc.readLatest().revision).toBe(3);
    await renderDocument(writeBody, { revision: 3 }, "Later remote body");
    expect(doc.state.text).toBe("Later remote body");
  });
});

describe("useAutosavedDocument.flushReviewed", () => {
  it.each(["unverified", "legacy"] as const)(
    "cancels review when a successful content response is %s",
    async (kind) => {
      const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
        summary: { revision: 2 },
        acknowledgement: kind === "legacy" ? { kind, revision: 2 } : { kind },
        claimed: [{ pendingId: "pending-shot", attachmentId: "plan-shot" }],
      });
      await renderDocument(writeBody);
      await act(async () => doc.edit("Keep ![shot](vetra-attachment://pending-shot)"));
      await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
      expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
      expect(doc.state.text).toBe("Keep ![shot](vetra-attachment://plan-shot)");
      expect(doc.state.conflict).toBe(true);
    },
  );

  it("settles a body save already in flight and advances only from its own receipt", async () => {
    const firstReply = deferredWrite();
    const writeBody = vi
      .fn<DocumentOptions["writeBody"]>()
      .mockReturnValueOnce(firstReply.promise)
      .mockResolvedValue({
        summary: { revision: 3 },
        acknowledgement: { kind: "commit", observedRevision: 2, revision: 3 },
        claimed: [],
      });
    await renderDocument(writeBody);
    await act(async () => {
      doc.edit("First saved draft");
      void doc.flush();
    });
    let reviewed = Promise.resolve<number | null>(null);
    await act(async () => {
      doc.edit("Reviewed final draft");
      reviewed = doc.flushReviewed(async () => true);
    });
    await renderDocument(writeBody, { revision: 2 }, "First saved draft");
    await act(async () =>
      firstReply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "commit", observedRevision: 1, revision: 2 },
        claimed: [],
      }),
    );
    expect(await reviewed).toBe(3);
    expect(doc.state.base).toEqual({ revision: 3, body: "Reviewed final draft" });
    expect(writeBody).toHaveBeenLastCalledWith(2, "Reviewed final draft", []);
  });

  it("cancels if a remote edit is adopted while a no-op title commit settles", async () => {
    const writeBody = vi.fn<DocumentOptions["writeBody"]>();
    await renderDocument(writeBody);
    let completeTitle = (_saved: boolean) => {};
    let reviewed = Promise.resolve<number | null>(null);
    await act(async () => {
      reviewed = doc.flushReviewed(
        () =>
          new Promise((resolve) => {
            completeTitle = resolve;
          }),
      );
    });
    await renderDocument(writeBody, { revision: 2 }, "Remote body to review");
    await act(async () => completeTitle(true));
    expect(await reviewed).toBeNull();
    expect(container.textContent).toBe("Remote body to review");
    expect(writeBody).not.toHaveBeenCalled();
  });

  it("preserves the reviewed revision while a metadata write waits behind queued work", async () => {
    const blocker = deferredWrite();
    const readyReply = deferredWrite();
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>());
    let reviewed: number | null = null;
    await act(async () => {
      reviewed = await doc.flushReviewed(async () => true);
    });
    expect(reviewed).toBe(1);
    const expectedRevision = reviewed ?? 0;
    const markReady = vi.fn<DocumentWrite<Summary>>(() => readyReply.promise);
    let written = Promise.resolve(false);
    await act(async () => {
      void doc.writeFields(() => () => blocker.promise);
      written = doc.writeFields(() => markReady, { expectedRevision });
    });
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>(), { revision: 2 }, "Remote body");
    await act(async () =>
      blocker.resolve({
        summary: { revision: 1 },
        acknowledgement: { kind: "commit", observedRevision: 1, revision: 1 },
        claimed: [],
      }),
    );
    expect(markReady).toHaveBeenCalledWith(1);
    expect(doc.state.writing).toEqual({ sentBody: null, expectedRevision: 1 });
    await act(async () => readyReply.resolve("conflict"));
    expect(await written).toBe(false);
    expect(container.textContent).toBe("Remote body");
    expect(doc.state.base).toEqual({ revision: 2, body: "Remote body" });
  });

  it.each([1, 3])(
    "retains the draft when a body receipt has unexplained revision %s",
    async (revision) => {
      const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
        summary: { revision },
        acknowledgement: { kind: "commit", observedRevision: 2, revision: 2 },
        claimed: [],
      });
      await renderDocument(writeBody);
      await act(async () => doc.edit("Keep reviewed draft"));
      await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
      expect(doc.state.text).toBe("Keep reviewed draft");
      expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
      expect(doc.state.conflict).toBe(true);
    },
  );

  it("does not advance a no-op field receipt to a newer remote revision", async () => {
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>());
    await act(async () => {
      expect(
        await doc.flushReviewed(() =>
          doc.writeFields(() => async () => ({
            summary: { revision: 2 },
            acknowledgement: { kind: "commit", observedRevision: 2, revision: 2 },
            claimed: [],
          })),
        ),
      ).toBeNull();
    });
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    expect(doc.readLatest().revision).toBe(1);
  });

  it("keeps the reviewed revision unchanged after a verified no-op title receipt", async () => {
    await renderDocument(vi.fn<DocumentOptions["writeBody"]>());
    await act(async () => {
      expect(
        await doc.flushReviewed(() =>
          doc.writeFields(() => async () => ({
            summary: { revision: 1 },
            acknowledgement: { kind: "commit", observedRevision: 1, revision: 1 },
            claimed: [],
          })),
        ),
      ).toBe(1);
    });
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    expect(container.textContent).toBe("Saved body");
  });

  it("retains claimed attachments in a draft when a superseding receipt cancels Ready", async () => {
    await renderDocument(
      vi.fn<DocumentOptions["writeBody"]>().mockResolvedValue({
        summary: { revision: 3 },
        acknowledgement: { kind: "commit", observedRevision: 2, revision: 3 },
        claimed: [{ pendingId: "pending-shot", attachmentId: "plan-shot" }],
      }),
    );
    await act(async () => doc.edit("Retain ![shot](vetra-attachment://pending-shot)"));
    await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
    expect(doc.state.base).toEqual({ revision: 1, body: "Saved body" });
    expect(doc.state.text).toBe("Retain ![shot](vetra-attachment://plan-shot)");
    expect(doc.state.conflict).toBe(true);
    await act(async () => doc.edit("Undo ![shot](vetra-attachment://pending-shot)"));
    expect(doc.state.text).toBe("Undo ![shot](vetra-attachment://plan-shot)");
  });

  it("cancels before flushing when a summary is ahead of the displayed body", async () => {
    const bodyReply = deferredWrite();
    const writeBody = vi.fn<DocumentOptions["writeBody"]>().mockReturnValue(bodyReply.promise);
    await renderDocument(writeBody);
    await act(async () => {
      doc.edit("Reviewed body draft");
      void doc.flush();
    });
    await renderDocument(writeBody, { revision: 2 }, "Saved body");
    await act(async () => expect(await doc.flushReviewed(async () => true)).toBeNull());
    expect(doc.state.text).toBe("Reviewed body draft");
    expect(doc.state.base.revision).toBe(1);
    expect(writeBody).toHaveBeenCalledTimes(1);
    await act(async () =>
      bodyReply.resolve({
        summary: { revision: 2 },
        acknowledgement: { kind: "commit", observedRevision: 1, revision: 2 },
        claimed: [],
      }),
    );
  });
});
