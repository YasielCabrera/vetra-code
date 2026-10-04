import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  formatTicketPlanRef,
  parseTicketPlanReference,
  TicketPlanAnchor,
  TicketPlanCommentInput,
} from "./ticketPlan.ts";

describe("parseTicketPlanReference", () => {
  it("reads numbered plans on numbered or GitHub tickets, and plan ids", () => {
    expect(
      [
        "T-42/P1",
        " t-7/p12 ",
        "acme/app#123/P2",
        "3f2b9c1e-0000-4000-8000-000000000000",
        formatTicketPlanRef(9, 3),
      ].map(parseTicketPlanReference),
    ).toEqual([
      { type: "number", ticket: "T-42", number: 1 },
      { type: "number", ticket: "t-7", number: 12 },
      { type: "number", ticket: "acme/app#123", number: 2 },
      { type: "id", planId: "3f2b9c1e-0000-4000-8000-000000000000" },
      { type: "number", ticket: "T-9", number: 3 },
    ]);
  });

  it("rejects text that cannot name a plan", () => {
    expect(
      ["", "T-42/P0", "T-0/P1", "T-42/", "#12/P1", "a/b/c#1/P1", "T-42", "two words"].map(
        parseTicketPlanReference,
      ),
    ).toEqual([null, null, null, null, null, null, null, null]);
  });
});

describe("TicketPlanAnchor", () => {
  const isAnchor = Schema.is(TicketPlanAnchor);

  it("accepts legacy anchors and bounded source context for repeated passages", () => {
    const anchor = { source: "```sh\nnpm test\n```", revision: 1 };
    expect(isAnchor(anchor)).toBe(true);
    expect(
      isAnchor({ ...anchor, sourceContext: { prefix: "Before\n\n", suffix: "\n\nAfter" } }),
    ).toBe(true);
    expect(isAnchor({ ...anchor, sourceContext: { prefix: "x".repeat(33), suffix: "" } })).toBe(
      false,
    );
    expect(isAnchor({ ...anchor, sourceContext: { prefix: "", suffix: "x".repeat(33) } })).toBe(
      false,
    );
  });
});

describe("TicketPlanCommentInput", () => {
  const isComment = Schema.is(TicketPlanCommentInput);

  it("accepts a whitespace-padded quote and rejects a blank one", () => {
    const comment = (text: string) => ({
      planId: "plan-1",
      body: "Why?",
      anchor: { quote: { text, prefix: "", suffix: "" }, source: "- step", revision: 1 },
    });
    expect([isComment(comment(" step ")), isComment(comment(" \n "))]).toEqual([true, false]);
  });
});
