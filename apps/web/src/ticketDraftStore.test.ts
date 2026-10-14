// @vitest-environment jsdom

import { EnvironmentId, ProjectId, ThreadId, TicketId, TicketStatusId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createMemoryStorage } from "./lib/storage";
import { threadContextRecord } from "./lib/composerContextRecords";
import { createTicketDraftStore, TICKET_DRAFT_STORAGE_KEY } from "./ticketDraftStore";
import type { PendingTicketUpload } from "./components/tickets/ticketAttachments";
import type { TicketCapture } from "./components/tickets/ticketCapture";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const capture: TicketCapture = {
  environmentId: local,
  projectId: null,
  sourceThreadId: null,
  items: [],
};
const pending: PendingTicketUpload = {
  localId: "upload-key",
  attachment: {
    type: "image",
    id: "pending-shot",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 4,
  },
};

function manual(drafts: ReturnType<typeof createTicketDraftStore>, key: string | null) {
  const entry = key === null ? undefined : drafts.store.getState().drafts[key];
  if (!entry || entry.value.kind !== "manual") throw new Error("Missing manual draft");
  return { ...entry, value: entry.value };
}

describe("ticket drafts", () => {
  it("can file text after an attachment reference is deleted during verification", async () => {
    let complete = (_result: { status: "missing" }) => {};
    const checking = new Promise<{ status: "missing" }>((resolve) => {
      complete = resolve;
    });
    const drafts = createTicketDraftStore({
      storage: createMemoryStorage(),
      verify: () => checking,
    });
    const key = drafts.openManual({ title: "Draft" }, local)!;
    drafts.edit(key, {
      ...manual(drafts, key).value,
      body: "![shot](vetra-attachment://pending-shot)",
      uploads: [pending],
    });
    const verification = drafts.verify(key);
    drafts.edit(key, { ...manual(drafts, key).value, body: "Text only" });
    complete({ status: "missing" });
    expect(await verification).toBe(true);
    expect(manual(drafts, key).value.body).toBe("Text only");
  });
  it("warns while an otherwise empty offscreen draft still has an upload running", async () => {
    let finish = (_snippets: ReadonlyArray<string>) => {};
    const ready = new Promise<ReadonlyArray<string>>((resolve) => {
      finish = resolve;
    });
    const drafts = createTicketDraftStore({ storage: createMemoryStorage(), upload: () => ready });
    const key = drafts.openManual({}, local)!;
    const uploading = drafts.attach(key, [new File(["shot"], "shot.png")]);
    window.addEventListener("beforeunload", drafts.beforeUnload);
    try {
      expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    } finally {
      window.removeEventListener("beforeunload", drafts.beforeUnload);
    }
    finish([]);
    await uploading;
    expect(manual(drafts, key).value.title).toBe("");
    expect(drafts.runtime(manual(drafts, key).id).uploading).toBe(0);
  });
  it("hydrates all manual fields and resumes an edited prefill in its remote environment", () => {
    const storage = createMemoryStorage();
    const drafts = createTicketDraftStore({ storage });
    const key = drafts.openManual({ env: remote, title: "Captured title" }, local);
    const entry = manual(drafts, key);
    drafts.edit(key!, {
      ...entry.value,
      title: "Edited title",
      body: "Long description",
      labels: ["bug"],
      projectId: ProjectId.make("project"),
      threadId: ThreadId.make("thread"),
      statusId: TicketStatusId.make("status"),
      uploads: [pending],
    });
    drafts.flush();
    const reloaded = createTicketDraftStore({ storage });
    const resumed = manual(reloaded, reloaded.openManual({}, local));
    expect(resumed.value).toEqual({
      kind: "manual",
      environmentId: "remote",
      title: "Edited title",
      body: "Long description",
      labels: ["bug"],
      projectId: "project",
      threadId: "thread",
      statusId: "status",
      uploads: [pending],
    });
  });

  it("keeps distinct prefills and environments and starts fresh after explicit discard", () => {
    const drafts = createTicketDraftStore({ storage: createMemoryStorage() });
    const first = drafts.openManual({ env: local, title: "First capture" }, local);
    const before = manual(drafts, first);
    drafts.edit(first!, { ...before.value, title: "My first draft" });
    const second = drafts.openManual({ env: remote, title: "Other capture" }, local);
    expect(manual(drafts, second).value.title).toBe("Other capture");
    expect(
      manual(drafts, drafts.openManual({ env: local, title: "First capture" }, local)).value.title,
    ).toBe("My first draft");
    drafts.discard(first!);
    expect(manual(drafts, drafts.openManual({}, local)).value.title).toBe("");
    expect(manual(drafts, second).value.environmentId).toBe("remote");
  });

  it("retains and completes an upload while nobody is viewing its draft", async () => {
    let finish = (_snippets: ReadonlyArray<string>) => {};
    const ready = new Promise<ReadonlyArray<string>>((resolve) => {
      finish = resolve;
    });
    let accept: (upload: PendingTicketUpload) => boolean = () => false;
    const drafts = createTicketDraftStore({
      storage: createMemoryStorage(),
      upload: async (_env, _files, keep) => {
        accept = keep;
        return ready;
      },
    });
    const key = drafts.openManual({ title: "Draft" }, local)!;
    const original = manual(drafts, key);
    const uploading = drafts.attach(key, [new File(["shot"], "shot.png")]);
    expect(drafts.runtime(original.id).uploading).toBe(1);
    expect(drafts.beginSubmission(key)).toBe(null);
    drafts.edit(key, { ...manual(drafts, key).value, body: "More text while uploading" });
    expect(accept(pending)).toBe(true);
    finish(["![shot](vetra-attachment://pending-shot)"]);
    drafts.appendAttachments(key, original.id, await uploading);
    expect(manual(drafts, drafts.openManual({}, remote)).value.body).toBe(
      "More text while uploading\n\n![shot](vetra-attachment://pending-shot)",
    );
    expect(drafts.runtime(original.id).uploading).toBe(0);
  });

  it("does not append a discarded upload into a replacement session", async () => {
    let accept: (upload: PendingTicketUpload) => boolean = () => true;
    let finish = (_snippets: ReadonlyArray<string>) => {};
    const ready = new Promise<ReadonlyArray<string>>((resolve) => {
      finish = resolve;
    });
    const drafts = createTicketDraftStore({
      storage: createMemoryStorage(),
      upload: async (_env, _files, keep) => {
        accept = keep;
        return ready;
      },
    });
    const key = drafts.openManual({ title: "Old" }, local)!;
    const old = manual(drafts, key);
    const uploading = drafts.attach(key, [new File(["shot"], "shot.png")]);
    drafts.discard(key);
    drafts.openManual({ title: "Old" }, local);
    drafts.edit(key, { ...manual(drafts, key).value, title: "Replacement" });
    expect(accept(pending)).toBe(false);
    finish(["![shot](vetra-attachment://pending-shot)"]);
    drafts.appendAttachments(key, old.id, await uploading);
    expect(manual(drafts, key).value.title).toBe("Replacement");
    expect(manual(drafts, key).value.body).toBe("");
  });

  it("verifies a hydrated upload and preserves transient failures until retry", async () => {
    const storage = createMemoryStorage();
    const drafts = createTicketDraftStore({ storage });
    const key = drafts.openManual({ title: "Draft" }, local)!;
    drafts.edit(key, {
      ...manual(drafts, key).value,
      body: "![shot](vetra-attachment://pending-shot)",
      uploads: [pending],
    });
    drafts.flush();
    const verify = vi
      .fn<typeof import("./lib/attachmentUploadQueue").verifyStashedAttachmentUpload>()
      .mockResolvedValueOnce({ status: "failed", error: new Error("Offline") })
      .mockResolvedValueOnce({ status: "verified" });
    const reloaded = createTicketDraftStore({ storage, verify });
    expect(await reloaded.verify(key)).toBe(false);
    expect(manual(reloaded, key).value.body).toBe("![shot](vetra-attachment://pending-shot)");
    expect(reloaded.runtime(manual(reloaded, key).id).verification["pending-shot"]).toBe("failed");
    expect(await reloaded.verify(key)).toBe(true);
    expect(reloaded.runtime(manual(reloaded, key).id).verification["pending-shot"]).toBe(
      "verified",
    );
  });

  it("turns an expired upload into a readable filename when removed", async () => {
    const released: string[] = [];
    const drafts = createTicketDraftStore({
      storage: createMemoryStorage(),
      verify: async () => ({ status: "missing" }),
      release: (input) => {
        released.push(input.attachmentId);
      },
    });
    const key = drafts.openManual({ title: "Draft" }, local)!;
    drafts.edit(key, {
      ...manual(drafts, key).value,
      body: "Keep text\n\n![shot](vetra-attachment://pending-shot)",
      uploads: [pending],
    });
    expect(await drafts.verify(key)).toBe(false);
    expect(drafts.runtime(manual(drafts, key).id).verification["pending-shot"]).toBe("missing");
    drafts.removeUpload(key, "pending-shot");
    expect(manual(drafts, key).value.body).toBe("Keep text\n\nshot");
    expect(manual(drafts, key).value.uploads).toEqual([]);
    expect(released).toEqual(["pending-shot"]);
  });

  it("removes escaped attachment labels and ignores uploads no longer referenced by the body", async () => {
    const drafts = createTicketDraftStore({
      storage: createMemoryStorage(),
      verify: async () => ({ status: "missing" }),
      release: () => {},
    });
    const key = drafts.openManual({ title: "Draft" }, local)!;
    drafts.edit(key, {
      ...manual(drafts, key).value,
      body: "![screen\\[final\\]](vetra-attachment://pending-shot)",
      uploads: [pending],
    });
    drafts.removeUpload(key, "pending-shot");
    expect(manual(drafts, key).value.body).toBe("screen[final]");
    drafts.edit(key, { ...manual(drafts, key).value, body: "Text only", uploads: [pending] });
    expect(await drafts.verify(key)).toBe(true);
    expect(manual(drafts, key).value.body).toBe("Text only");
  });

  it("restores comments and dialog context together, isolated by ticket and capture", () => {
    const storage = createMemoryStorage();
    const drafts = createTicketDraftStore({ storage });
    const comment = drafts.openComment({ environmentId: local, ticketId: TicketId.make("one") });
    const entry = drafts.store.getState().drafts[comment]!;
    if (entry.value.kind !== "comment") throw new Error("Missing comment");
    drafts.edit(comment, { ...entry.value, text: "Comment draft" });
    const dialog = drafts.openDialog(capture);
    const dialogEntry = drafts.store.getState().drafts[dialog]!;
    if (dialogEntry.value.kind !== "dialog") throw new Error("Missing dialog");
    const record = threadContextRecord(
      { environmentId: local, threadId: ThreadId.make("thread") },
      "Thread",
    );
    drafts.edit(dialog, {
      ...dialogEntry.value,
      instruction: "Check this thread",
      promptRecords: [record],
    });
    drafts.flush();
    const reloaded = createTicketDraftStore({ storage });
    expect(
      reloaded.store.getState().drafts[
        reloaded.openComment({ environmentId: local, ticketId: TicketId.make("one") })
      ]?.value,
    ).toEqual({ kind: "comment", environmentId: "local", ticketId: "one", text: "Comment draft" });
    const remoteComment = reloaded.openComment({
      environmentId: remote,
      ticketId: TicketId.make("one"),
    });
    expect(reloaded.store.getState().drafts[remoteComment]?.value).toEqual({
      kind: "comment",
      environmentId: "remote",
      ticketId: "one",
      text: "",
    });
    const restoredDialog = reloaded.openDialog(capture);
    expect(reloaded.store.getState().drafts[restoredDialog]?.value).toEqual({
      kind: "dialog",
      environmentId: "local",
      capture,
      instruction: "Check this thread",
      promptRecords: [record],
      projectId: null,
      model: null,
    });
    const anotherDialog = reloaded.openDialog({
      ...capture,
      sourceThreadId: ThreadId.make("other"),
    });
    expect(reloaded.store.getState().drafts[anotherDialog]?.value).toMatchObject({
      kind: "dialog",
      instruction: "",
      promptRecords: [],
    });
    reloaded.flush();
    const hydratedAgain = createTicketDraftStore({ storage });
    expect(
      Object.values(hydratedAgain.store.getState().drafts).filter(
        ({ value }) => value.kind === "comment",
      ),
    ).toHaveLength(1);
  });

  it("retains failed submissions, locks edits, and clears only the submitted session on success", () => {
    const drafts = createTicketDraftStore({ storage: createMemoryStorage() });
    const key = drafts.openManual({ title: "Draft" }, local)!;
    const first = drafts.beginSubmission(key)!;
    drafts.edit(key, { ...manual(drafts, key).value, title: "Blocked edit" });
    expect(manual(drafts, key).value.title).toBe("Draft");
    drafts.finishSubmission(key, first, false);
    expect(manual(drafts, key).value.title).toBe("Draft");
    const submitted = drafts.beginSubmission(key)!;
    drafts.discard(key);
    drafts.openManual({ title: "Draft" }, local);
    drafts.edit(key, { ...manual(drafts, key).value, title: "Replacement" });
    drafts.finishSubmission(key, submitted, true);
    expect(manual(drafts, key).value.title).toBe("Replacement");
    const last = drafts.beginSubmission(key)!;
    drafts.finishSubmission(key, last, true);
    expect(manual(drafts, drafts.openManual({}, local)).value.title).toBe("");
  });

  it("warns and flushes retained drafts even after navigation and failed browser storage", () => {
    const storage = createMemoryStorage();
    const drafts = createTicketDraftStore({ storage });
    drafts.openManual({ title: "Retained draft" }, local);
    window.addEventListener("beforeunload", drafts.beforeUnload);
    try {
      const event = new Event("beforeunload", { cancelable: true });
      expect(window.dispatchEvent(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      window.removeEventListener("beforeunload", drafts.beforeUnload);
    }
    const reloaded = createTicketDraftStore({ storage });
    expect(manual(reloaded, reloaded.openManual({}, local)).value.title).toBe("Retained draft");
    const failing = createTicketDraftStore({
      storage: {
        ...storage,
        setItem: () => {
          throw new Error("Quota");
        },
      },
    });
    window.addEventListener("beforeunload", failing.beforeUnload);
    try {
      expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    } finally {
      window.removeEventListener("beforeunload", failing.beforeUnload);
    }
    expect(manual(failing, failing.openManual({}, local)).value.title).toBe("Retained draft");
  });

  it("rejects malformed persisted data without contaminating a new draft", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      TICKET_DRAFT_STORAGE_KEY,
      '{"drafts":{"bad":{"value":{"title":123}}},"activeManual":"bad"}',
    );
    const drafts = createTicketDraftStore({ storage });
    expect(manual(drafts, drafts.openManual({ title: "Safe" }, local)).value.title).toBe("Safe");
  });
});
