import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Tool from "effect/ai/Tool";
import {
  TicketCreateInput,
  TicketUpdateInput,
  TicketPlanCreateInput,
  TicketPlanUpdateInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { TicketsToolkit } from "./tools.ts";

describe("ticket MCP write limits", () => {
  const create = Schema.is(TicketsToolkit.tools.t3_ticket_create.parametersSchema);
  const update = Schema.is(TicketsToolkit.tools.t3_ticket_update.parametersSchema);

  it("accepts the literal body and label caps and rejects one beyond them", () => {
    expect(
      create({ title: "Ticket", body: "x".repeat(100_000), labels: Array(50).fill("bug") }),
    ).toBe(true);
    expect(
      update({
        ticket: "T-1",
        expectedRevision: 1,
        body: "x".repeat(100_000),
        labels: Array(50).fill("bug"),
      }),
    ).toBe(true);
    for (const fields of [
      { body: "x".repeat(100_001) },
      { labels: Array(51).fill("bug") },
      { labels: ["x".repeat(101)] },
    ]) {
      expect(create({ title: "Ticket", ...fields })).toBe(false);
      expect(update({ ticket: "T-1", expectedRevision: 1, ...fields })).toBe(false);
    }
  });

  it("accepts 100 links and rejects 101", () => {
    const link = { kind: "project", projectId: "project-1" };
    expect(
      create({ title: "Ticket", links: Array.from({ length: 100 }, () => ({ ...link })) }),
    ).toBe(true);
    expect(
      create({ title: "Ticket", links: Array.from({ length: 101 }, () => ({ ...link })) }),
    ).toBe(false);
  });
});

describe("ticket MCP attachments", () => {
  const image = {
    id: "pending-upload",
    type: "image",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 4,
  };
  const video = {
    id: "pending-video_mp4",
    type: "file",
    name: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
  };
  const file = {
    id: "pending-log_txt",
    type: "file",
    name: "log.txt",
    mimeType: "text/plain",
    sizeBytes: 3,
  };
  const writes = [
    [TicketsToolkit.tools.t3_ticket_create, { title: "Ticket" }],
    [TicketsToolkit.tools.t3_ticket_update, { ticket: "T-1", expectedRevision: 1 }],
    [TicketsToolkit.tools.t3_ticket_plan_create, { ticket: "T-1", title: "Plan", body: "Steps" }],
    [TicketsToolkit.tools.t3_ticket_plan_update, { plan: "T-1/P1", expectedRevision: 1 }],
  ] as const;

  it("retains both attachment variants for ticket and plan writes, up to 100 uploads", () => {
    for (const [tool, fields] of writes) {
      const decode = Schema.decodeUnknownSync(tool.parametersSchema);
      expect(decode({ ...fields, attachments: [image, video, file] })).toEqual({
        ...fields,
        attachments: [image, video, file],
      });
      expect(() =>
        decode({ ...fields, attachments: Array.from({ length: 100 }, () => ({ ...image })) }),
      ).not.toThrow();
      expect(() =>
        decode({ ...fields, attachments: Array.from({ length: 101 }, () => ({ ...image })) }),
      ).toThrow();
      const schema = Tool.getJsonSchema(tool);
      expect(JSON.stringify(schema)).not.toContain('"accessibility"');
      const decoded = decode({
        ...fields,
        attachments: [{ ...image, source: { accessibility: {} } }],
      });
      expect(decoded.attachments).toEqual([image]);
      expect(
        decode({ ...fields, attachments: [{ ...file, source: { _tag: "pasted-text" } }] })
          .attachments,
      ).toEqual([{ ...file, source: { _tag: "pasted-text" } }]);
    }
  });

  it("retains canonical removal IDs and limits them to 100", () => {
    const decode = Schema.decodeUnknownSync(TicketsToolkit.tools.t3_ticket_update.parametersSchema);
    const fields = { ticket: "T-1", expectedRevision: 1 };
    expect(decode({ ...fields, removeAttachmentIds: ["ticket-owned"] })).toEqual({
      ...fields,
      removeAttachmentIds: ["ticket-owned"],
    });
    expect(() =>
      decode({ ...fields, removeAttachmentIds: Array(100).fill("ticket-owned") }),
    ).not.toThrow();
    expect(() =>
      decode({ ...fields, removeAttachmentIds: Array(101).fill("ticket-owned") }),
    ).toThrow();
  });

  it("decodes local and mixed sources on all four tools and validates local descriptors", () => {
    for (const [tool, fields] of writes) {
      const decode = Schema.decodeUnknownSync(tool.parametersSchema);
      const local = { path: "/tmp/shot.png", ref: "shot2" };
      expect(
        decode({ ...fields, attachments: [local, image, { path: "/tmp/log.txt" }] }).attachments,
      ).toEqual([local, image, { path: "/tmp/log.txt" }]);
      expect(decode({ ...fields, attachments: [{ path: "/tmp/report " }] }).attachments).toEqual([
        { path: "/tmp/report " },
      ]);
      for (const source of [
        { path: "" },
        { path: "x".repeat(4097) },
        { path: "/tmp/file", ref: "" },
        { path: "/tmp/file", ref: "1shot" },
        { path: "/tmp/file", ref: "shot.png" },
        { path: "/tmp/file", ref: "x".repeat(65) },
      ])
        expect(() => decode({ ...fields, attachments: [source] })).toThrow();
    }
  });

  it("keeps browser ticket and plan attachment contracts pending-only", () => {
    const local = { path: "/tmp/shot.png" };
    for (const [schema, fields] of [
      [TicketCreateInput, { title: "Ticket" }],
      [TicketUpdateInput, { ticketId: "ticket", expectedRevision: 1 }],
      [TicketPlanCreateInput, { ticketId: "ticket", title: "Plan" }],
      [TicketPlanUpdateInput, { planId: "plan", expectedRevision: 1 }],
    ] as const) {
      expect(() => Schema.decodeUnknownSync(schema)({ ...fields, attachments: [local] })).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(schema)({ ...fields, attachments: [image] }),
      ).not.toThrow();
    }
  });

  it("marks upload-bearing updates as non-idempotent", () => {
    for (const tool of [
      TicketsToolkit.tools.t3_ticket_update,
      TicketsToolkit.tools.t3_ticket_plan_update,
    ]) {
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(false);
    }
  });
});

describe("ticket plan MCP review status", () => {
  const update = Schema.decodeUnknownSync(
    TicketsToolkit.tools.t3_ticket_plan_update.parametersSchema,
  );

  it("decodes Draft and Ready separately from archive lifecycle and requires a revision", () => {
    for (const reviewStatus of ["draft", "ready"] as const) {
      expect(
        update({ plan: "T-1/P1", expectedRevision: 2, status: "archived", reviewStatus }),
      ).toEqual({ plan: "T-1/P1", expectedRevision: 2, status: "archived", reviewStatus });
    }
    expect(update({ plan: "T-1/P1", expectedRevision: 1 })).toEqual({
      plan: "T-1/P1",
      expectedRevision: 1,
    });
    for (const reviewStatus of ["active", "archived", "approved", "", null, 1]) {
      expect(() => update({ plan: "T-1/P1", expectedRevision: 1, reviewStatus })).toThrow();
    }
    expect(() => update({ plan: "T-1/P1", reviewStatus: "ready" })).toThrow();
  });
});
