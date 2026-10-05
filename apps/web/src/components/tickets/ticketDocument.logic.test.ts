import { describe, expect, it } from "vite-plus/test";

import {
  hasUnsavedBody,
  initialTicketDocument,
  reduceTicketDocument,
  shouldAutosave,
  type TicketDocumentEvent,
  type TicketDocumentState,
} from "./ticketDocument.logic";

function run(
  events: ReadonlyArray<TicketDocumentEvent>,
  state: TicketDocumentState = initialTicketDocument({ revision: 1, body: "Draft" }),
): TicketDocumentState {
  return events.reduce(reduceTicketDocument, state);
}

describe("reduceTicketDocument", () => {
  it("takes a known newer body once an edit returns to its base, including after a conflict", () => {
    const events = [
      { type: "edited", text: "Mine" },
      { type: "serverChanged", revision: 2, body: "Theirs" },
    ] satisfies TicketDocumentEvent[];
    for (const conflictEvents of [
      [],
      [
        { type: "writeStarted", sentBody: "Mine", expectedRevision: 1 },
        { type: "writeConflicted" },
      ],
    ] satisfies TicketDocumentEvent[][]) {
      const state = run([...events, ...conflictEvents, { type: "edited", text: "Draft" }]);
      expect([state.text, state.base, state.conflict, shouldAutosave(state)]).toEqual([
        "Theirs",
        { revision: 2, body: "Theirs" },
        false,
        false,
      ]);
    }
  });

  it("retains attachment claims for later edits, undo, and subsequent saves", () => {
    const pending = "![shot](vetra-attachment://pending-shot)";
    const state = run([
      { type: "edited", text: pending },
      { type: "writeStarted", sentBody: pending, expectedRevision: 1 },
      {
        type: "writeLanded",
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [{ pendingId: "pending-shot", attachmentId: "ticket-shot" }],
      },
      { type: "edited", text: "Draft" },
      { type: "writeStarted", sentBody: "Draft", expectedRevision: 2 },
      { type: "writeLanded", acknowledgement: { kind: "legacy", revision: 3 }, claimed: [] },
      { type: "edited", text: pending },
    ]);
    expect(state.text).toBe("![shot](vetra-attachment://ticket-shot)");
    expect(shouldAutosave(state)).toBe(true);
  });

  it("follows the server while the editor is clean, and holds local edits while it is not", () => {
    const followed = run([{ type: "serverChanged", revision: 2, body: "Agent wrote this" }]);
    expect(followed.text).toBe("Agent wrote this");
    expect(followed.base).toEqual({ revision: 2, body: "Agent wrote this" });

    const held = run([
      { type: "edited", text: "Mine" },
      { type: "serverChanged", revision: 2, body: "Theirs" },
    ]);
    expect(held.text).toBe("Mine");
    expect(held.base).toEqual({ revision: 1, body: "Draft" });
  });

  it("makes a landed save the base before the stream catches up, with claimed attachment ids", () => {
    const sent = "See ![shot](vetra-attachment://pending-1)";
    const landed = run([
      { type: "edited", text: sent },
      { type: "writeStarted", sentBody: sent, expectedRevision: 1 },
      { type: "edited", text: `${sent}\nmore` },
      {
        type: "writeLanded",
        acknowledgement: { kind: "legacy", revision: 2 },
        claimed: [{ pendingId: "pending-1", attachmentId: "ticket-9-a" }],
      },
    ]);
    expect(landed.base).toEqual({
      revision: 2,
      body: "See ![shot](vetra-attachment://ticket-9-a)",
    });
    expect(landed.text).toBe("See ![shot](vetra-attachment://ticket-9-a)\nmore");

    const pushed = reduceTicketDocument(landed, {
      type: "serverChanged",
      revision: 2,
      body: "See ![shot](vetra-attachment://ticket-9-a)",
    });
    expect(pushed.base).toEqual(landed.base);
    expect(pushed.text).toBe("See ![shot](vetra-attachment://ticket-9-a)\nmore");
  });

  it("names the landed revision on the next write when the reply beats the push", () => {
    const state = run([
      { type: "writeStarted", sentBody: null, expectedRevision: 1 },
      { type: "writeLanded", acknowledgement: { kind: "legacy", revision: 2 }, claimed: [] },
      { type: "edited", text: "Typed after the title save" },
    ]);
    expect(state.base).toEqual({ revision: 2, body: "Draft" });
    expect(shouldAutosave(state)).toBe(true);
  });

  it("settles a save whose revision the stream already sent before the reply", () => {
    const saved = run([
      { type: "edited", text: "Final" },
      { type: "writeStarted", sentBody: "Final", expectedRevision: 1 },
      { type: "serverChanged", revision: 2, body: "Final" },
      { type: "writeLanded", acknowledgement: { kind: "legacy", revision: 2 }, claimed: [] },
    ]);
    expect(saved.base).toEqual({ revision: 2, body: "Final" });
    expect(hasUnsavedBody(saved)).toBe(false);
  });

  it("takes someone else's status or label change silently, even over unsaved text", () => {
    const state = run([
      { type: "edited", text: "Half-typed" },
      { type: "serverChanged", revision: 2, body: "Draft" },
    ]);
    expect(state.base).toEqual({ revision: 2, body: "Draft" });
    expect([state.text, state.conflict]).toEqual(["Half-typed", false]);
  });

  it("drops a conflict once the newer revision turns out to leave the body alone", () => {
    const state = run([
      { type: "edited", text: "Mine" },
      { type: "writeStarted", sentBody: "Mine", expectedRevision: 1 },
      { type: "writeConflicted" },
    ]);
    expect(state.conflict).toBe(true);

    const cleared = reduceTicketDocument(state, {
      type: "serverChanged",
      revision: 2,
      body: "Draft",
    });
    expect([cleared.conflict, cleared.base.revision, cleared.text]).toEqual([false, 2, "Mine"]);
    expect(shouldAutosave(cleared)).toBe(true);
  });

  it("does not raise the body banner when a field write conflicts", () => {
    const state = run([
      { type: "edited", text: "Mine" },
      { type: "writeStarted", sentBody: null, expectedRevision: 1 },
      { type: "writeConflicted" },
    ]);
    expect([state.conflict, state.writing, state.text]).toEqual([false, null, "Mine"]);
  });

  it("lands a status change during a body conflict without hiding the other writer's body", () => {
    const state = run([
      { type: "edited", text: "Mine" },
      { type: "serverChanged", revision: 3, body: "Theirs" },
      { type: "writeStarted", sentBody: "Mine", expectedRevision: 1 },
      { type: "writeConflicted" },
      { type: "writeStarted", sentBody: null, expectedRevision: 3 },
      { type: "writeLanded", acknowledgement: { kind: "legacy", revision: 4 }, claimed: [] },
      { type: "serverChanged", revision: 4, body: "Theirs" },
    ]);
    expect([state.conflict, state.base, state.text]).toEqual([
      true,
      { revision: 1, body: "Draft" },
      "Mine",
    ]);
  });

  it("resolves a body conflict by reloading or by keeping local edits on the newer revision", () => {
    const conflicted = run([
      { type: "edited", text: "Mine" },
      { type: "serverChanged", revision: 3, body: "Theirs" },
      { type: "writeStarted", sentBody: "Mine", expectedRevision: 1 },
      { type: "writeConflicted" },
    ]);
    expect(conflicted.conflict).toBe(true);

    const reloaded = reduceTicketDocument(conflicted, { type: "reload" });
    expect([reloaded.text, reloaded.base.revision, reloaded.conflict]).toEqual([
      "Theirs",
      3,
      false,
    ]);

    const kept = reduceTicketDocument(conflicted, { type: "keepMine" });
    expect([kept.text, kept.base.revision, hasUnsavedBody(kept)]).toEqual(["Mine", 3, true]);
  });

  it("reloads on keep mine when the local text matches the pre-conflict body", () => {
    const state = run([
      { type: "edited", text: "Mine" },
      { type: "serverChanged", revision: 3, body: "Theirs" },
      { type: "writeStarted", sentBody: "Mine", expectedRevision: 1 },
      { type: "writeConflicted" },
      { type: "edited", text: "Draft" },
      { type: "keepMine" },
    ]);
    expect([state.text, state.base, state.conflict]).toEqual([
      "Theirs",
      { revision: 3, body: "Theirs" },
      false,
    ]);
    expect(hasUnsavedBody(state)).toBe(false);
  });

  it("does not autosave the text that just failed until it is edited again", () => {
    const failed = run([
      { type: "edited", text: "Offline edit" },
      { type: "writeStarted", sentBody: "Offline edit", expectedRevision: 1 },
      { type: "writeFailed" },
    ]);
    expect([hasUnsavedBody(failed), shouldAutosave(failed)]).toEqual([true, false]);

    const edited = reduceTicketDocument(failed, { type: "edited", text: "Offline edit!" });
    expect(shouldAutosave(edited)).toBe(true);
  });
});
