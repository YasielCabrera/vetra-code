import * as Schema from "effect/Schema";
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
