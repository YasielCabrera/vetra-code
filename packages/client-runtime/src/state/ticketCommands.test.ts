import { TicketId, TicketPlanId, TicketStatusId, type TicketSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyTicketListEvent } from "./ticketCommands.ts";

const ticket = (id: string, title: string): TicketSummary => ({
  kind: "local",
  id: TicketId.make(id),
  number: 1,
  title,
  labels: [],
  statusId: TicketStatusId.make("todo"),
  sortKey: "a0",
  revision: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdBy: { type: "user" },
  linkRefs: [],
  attachmentCount: 0,
  plans: [],
});

describe("applyTicketListEvent", () => {
  it("applies plan review deltas at unchanged content revisions and retains untouched tickets", () => {
    const draft: TicketSummary = {
      ...ticket("a", "Alpha"),
      plans: [
        {
          planId: TicketPlanId.make("p1"),
          ticketId: TicketId.make("a"),
          ref: "T-1/P1",
          number: 1,
          title: "Plan",
          status: "active",
          reviewStatus: "draft",
          revision: 1,
          openCommentCount: 0,
          createdBy: { type: "user" },
          updatedBy: { type: "user" },
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    };
    const other = ticket("b", "Beta");
    const initial = applyTicketListEvent(new Map(), { type: "snapshot", tickets: [draft, other] });
    const ready: TicketSummary = {
      ...draft,
      plans: draft.plans.map((plan) => ({ ...plan, reviewStatus: "ready" })),
    };
    const updated = applyTicketListEvent(initial, {
      type: "delta",
      upserted: [ready],
      removed: [],
    });
    const returned = applyTicketListEvent(updated, {
      type: "delta",
      upserted: [draft],
      removed: [],
    });
    expect(
      [initial, updated, returned].map((list) => {
        const summary = list.get("a");
        return [summary?.revision, summary?.plans[0]?.revision, summary?.plans[0]?.reviewStatus];
      }),
    ).toEqual([
      [1, 1, "draft"],
      [1, 1, "ready"],
      [1, 1, "draft"],
    ]);
    expect(updated.get("b")).toBe(other);
    expect(returned.get("b")).toBe(other);
  });

  it("applies a whole delta at once and keeps untouched entries by reference", () => {
    const first = applyTicketListEvent(new Map(), {
      type: "snapshot",
      tickets: [ticket("a", "Alpha"), ticket("b", "Beta"), ticket("c", "Gamma")],
    });
    const next = applyTicketListEvent(first, {
      type: "delta",
      upserted: [ticket("a", "Alpha 2"), ticket("d", "Delta")],
      removed: [TicketId.make("b"), TicketId.make("missing")],
    });
    const replaced = applyTicketListEvent(next, {
      type: "snapshot",
      tickets: [ticket("z", "Zed")],
    });

    expect([...next.values()].map((entry) => entry.title)).toEqual(["Alpha 2", "Gamma", "Delta"]);
    expect(next.get("c")).toBe(first.get("c"));
    expect([...first.values()].map((entry) => entry.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect([...replaced.keys()]).toEqual(["z"]);
  });
});
