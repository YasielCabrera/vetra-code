import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  TicketActivityEntry,
  TicketPlanReviewStatus,
  TicketPlanStatus,
  TicketPlanSummary,
} from "./ticket.ts";

import {
  formatTicketPlanRef,
  parseTicketPlanReference,
  TicketPlanAnchor,
  TicketPlanCommentInput,
  TicketPlanContentCommit,
  TicketPlanUpdateInput,
  TicketPlanWriteResult,
} from "./ticketPlan.ts";

const decodeReviewStatus = Schema.decodeUnknownSync(TicketPlanReviewStatus);
const decodeLifecycleStatus = Schema.decodeUnknownSync(TicketPlanStatus);
const decodePlanUpdate = Schema.decodeUnknownSync(TicketPlanUpdateInput);
const decodePlanSummary = Schema.decodeSync(TicketPlanSummary);
const decodeActivity = Schema.decodeUnknownSync(TicketActivityEntry);

describe("plan review status", () => {
  it("decodes Draft and Ready independently from lifecycle and rejects unknown values", () => {
    expect([decodeReviewStatus("draft"), decodeReviewStatus("ready")]).toEqual(["draft", "ready"]);
    expect(() => decodeReviewStatus("approved")).toThrow();
    expect([decodeLifecycleStatus("active"), decodeLifecycleStatus("archived")]).toEqual([
      "active",
      "archived",
    ]);
    expect(() => decodeLifecycleStatus("ready")).toThrow();
    expect(
      decodePlanUpdate({
        planId: "p1",
        expectedRevision: 3,
        reviewStatus: "ready",
      }),
    ).toEqual({ planId: "p1", expectedRevision: 3, reviewStatus: "ready" });
    expect(() =>
      decodePlanUpdate({
        planId: "p1",
        expectedRevision: 3,
        reviewStatus: "approved",
      }),
    ).toThrow();
  });

  it("defaults older summaries to Draft while preserving explicit Ready and content revision", () => {
    const summary = {
      planId: "p1",
      ticketId: "t1",
      ref: "T-1/P1",
      number: 1,
      title: "Plan",
      status: "archived",
      revision: 3,
      openCommentCount: 0,
      createdBy: { type: "user" },
      updatedBy: { type: "user" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies typeof TicketPlanSummary.Encoded;
    expect(decodePlanSummary(summary)).toEqual({ ...summary, reviewStatus: "draft" });
    expect(decodePlanSummary({ ...summary, reviewStatus: "ready" })).toEqual({
      ...summary,
      reviewStatus: "ready",
    });
  });

  it("decodes structured review activity with a destination status", () => {
    const activity = {
      type: "plan_review_status_changed",
      planId: "p1",
      number: 1,
      from: "draft",
      to: "ready",
    } satisfies typeof TicketActivityEntry.Encoded;
    expect(decodeActivity(activity)).toEqual(activity);
    expect(() => decodeActivity({ ...activity, to: "approved" })).toThrow();
  });
});

describe("plan content receipts", () => {
  const decodeCommit = Schema.decodeUnknownSync(TicketPlanContentCommit);

  it("accepts unchanged and single-increment transactions and rejects invalid revisions", () => {
    for (const revision of [3, 4]) {
      expect(decodeCommit({ observedRevision: 3, revision })).toEqual({
        observedRevision: 3,
        revision,
      });
    }
    for (const commit of [
      { observedRevision: 3, revision: 2 },
      { observedRevision: 3, revision: 5 },
      { observedRevision: 0, revision: 1 },
      { observedRevision: 1.5, revision: 2.5 },
    ]) {
      expect(() => decodeCommit(commit)).toThrow();
    }
  });

  it("decodes older and creation results without inventing content proof", () => {
    const result = {
      plan: {
        planId: "p1",
        ticketId: "t1",
        ref: "T-1/P1",
        number: 1,
        title: "Plan",
        status: "active",
        revision: 3,
        openCommentCount: 0,
        createdBy: { type: "user" },
        updatedBy: { type: "user" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      attachments: [],
    } satisfies typeof TicketPlanWriteResult.Encoded;
    const decodeResult = Schema.decodeSync(TicketPlanWriteResult);
    expect(decodeResult(result)).not.toHaveProperty("contentCommit");
    const contentCommit = { observedRevision: 1, revision: 2 };
    expect(decodeResult({ ...result, contentCommit }).contentCommit).toEqual(contentCommit);
    expect(() =>
      decodeResult({ ...result, contentCommit: { observedRevision: 1, revision: 3 } }),
    ).toThrow();
  });
});

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
