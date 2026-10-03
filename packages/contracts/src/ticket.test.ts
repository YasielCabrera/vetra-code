import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ProjectId } from "./baseSchemas.ts";
import {
  parseTicketReference,
  TicketCreateInput,
  ticketLinkTargetKey,
  TicketUpdateInput,
} from "./ticket.ts";

const isTicketCreate = Schema.is(TicketCreateInput);
const isTicketUpdate = Schema.is(TicketUpdateInput);

describe("ticket write limits", () => {
  const attachment = {
    type: "file",
    id: "upload_1",
    name: "note.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
  };
  const updates = { ticketId: "ticket-1", expectedRevision: 1 };

  it("accepts exactly 100,000 body characters, 50 labels and 100 attachments on both writes", () => {
    const fields = {
      body: "x".repeat(100_000),
      labels: Array(50).fill("bug"),
      attachments: Array.from({ length: 100 }, () => ({ ...attachment })),
    };
    expect(isTicketCreate({ title: "Ticket", ...fields })).toBe(true);
    expect(isTicketUpdate({ ...updates, ...fields })).toBe(true);
    expect(isTicketCreate({ title: "Empty body", body: "" })).toBe(true);
  });

  it("rejects one character, label or attachment beyond each cap on both writes", () => {
    for (const fields of [
      { body: "x".repeat(100_001) },
      { labels: Array(51).fill("bug") },
      { labels: ["x".repeat(101)] },
      { attachments: Array.from({ length: 101 }, () => ({ ...attachment })) },
    ]) {
      expect(isTicketCreate({ title: "Ticket", ...fields })).toBe(false);
      expect(isTicketUpdate({ ...updates, ...fields })).toBe(false);
    }
  });

  it("accepts 100 links or removed attachment ids and rejects 101", () => {
    const link = { kind: "project", projectId: "project-1" };
    expect(
      isTicketCreate({ title: "Ticket", links: Array.from({ length: 100 }, () => ({ ...link })) }),
    ).toBe(true);
    expect(
      isTicketCreate({ title: "Ticket", links: Array.from({ length: 101 }, () => ({ ...link })) }),
    ).toBe(false);
    expect(isTicketUpdate({ ...updates, removeAttachmentIds: Array(100).fill("upload_1") })).toBe(
      true,
    );
    expect(isTicketUpdate({ ...updates, removeAttachmentIds: Array(101).fill("upload_1") })).toBe(
      false,
    );
  });
});

describe("parseTicketReference", () => {
  it("reads numbers, GitHub issues and ids", () => {
    expect(
      [
        "T-42",
        " t-7 ",
        "acme/app#123",
        "acme.io/web-app#9",
        "3f2b9c1e-0000-4000-8000-000000000000",
      ].map(parseTicketReference),
    ).toEqual([
      { type: "number", number: 42 },
      { type: "number", number: 7 },
      { type: "issue", repository: "acme/app", number: 123 },
      { type: "issue", repository: "acme.io/web-app", number: 9 },
      { type: "id", ticketId: "3f2b9c1e-0000-4000-8000-000000000000" },
    ]);
  });

  it("rejects text that cannot name a ticket", () => {
    expect(
      ["", "T-0", "acme/app#0", "#12", "two words", "a/b/c#1"].map(parseTicketReference),
    ).toEqual([null, null, null, null, null, null]);
  });
});

describe("ticketLinkTargetKey", () => {
  it("keys code host links by host, repository and number", () => {
    expect(
      ticketLinkTargetKey({
        kind: "issue",
        ref: { host: "github.com", repository: "acme/app", number: 5 },
        snapshot: { title: "Bug", state: "open", url: "https://github.com/acme/app/issues/5" },
      }),
    ).toBe("github.com/acme/app#5");
    expect(ticketLinkTargetKey({ kind: "project", projectId: ProjectId.make("p-1") })).toBe("p-1");
  });
});
