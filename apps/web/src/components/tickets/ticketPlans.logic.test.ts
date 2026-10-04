import {
  ThreadId,
  TicketId,
  TicketPlanId,
  type TicketActivity,
  type TicketPlanSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findTicketPlanByNumber,
  partitionTicketPlans,
  ticketPlanHistory,
} from "./ticketPlans.logic";

const TICKET = TicketId.make("ticket-1");
const P1 = TicketPlanId.make("plan-1");
const P2 = TicketPlanId.make("plan-2");

function plan(planId: TicketPlanId, number: number, status: "active" | "archived") {
  return {
    planId,
    ref: `T-7/P${number}`,
    number,
    title: `Plan ${number}`,
    status,
    revision: 1,
    openCommentCount: 0,
    createdBy: { type: "user" },
    updatedBy: { type: "user" },
    updatedAt: "2026-10-01T10:00:00.000Z",
  } as const satisfies TicketPlanSummary;
}

function activity(id: number, entry: TicketActivity["entry"]): TicketActivity {
  return {
    id,
    ticketId: TICKET,
    actor: { type: "agent", threadId: ThreadId.make("thread-1") },
    createdAt: `2026-10-01T10:0${id}:00.000Z`,
    entry,
  };
}

describe("findTicketPlanByNumber", () => {
  const plans = [plan(P1, 1, "active"), plan(P2, 3, "archived")];

  it("resolves the route's plan number, archived plans included", () => {
    expect(findTicketPlanByNumber(plans, "3")?.planId).toBe("plan-2");
  });

  it("finds nothing for a deleted number or one that is not a plain number", () => {
    expect(
      ["2", "P1", "1.0", "", " 1"].map((number) => findTicketPlanByNumber(plans, number)),
    ).toEqual([null, null, null, null, null]);
  });
});

describe("partitionTicketPlans", () => {
  it("splits active plans from archived ones and keeps number order", () => {
    const { active, archived } = partitionTicketPlans([
      plan(P1, 1, "archived"),
      plan(TicketPlanId.make("plan-3"), 2, "active"),
      plan(P2, 3, "active"),
      plan(TicketPlanId.make("plan-4"), 4, "archived"),
    ]);
    expect(active.map((item) => item.ref)).toEqual(["T-7/P2", "T-7/P3"]);
    expect(archived.map((item) => item.ref)).toEqual(["T-7/P1", "T-7/P4"]);
  });
});

describe("ticketPlanHistory", () => {
  it("keeps one plan's entries, newest first", () => {
    const history = ticketPlanHistory(
      [
        activity(1, { type: "created" }),
        activity(2, { type: "plan_created", planId: P1, number: 1 }),
        activity(3, { type: "plan_created", planId: P2, number: 2 }),
        activity(4, { type: "edited", fields: ["body"] }),
        activity(5, { type: "plan_edited", planId: P1, number: 1 }),
        activity(6, { type: "plan_archived", planId: P1, number: 1 }),
        activity(7, { type: "plan_edited", planId: P2, number: 2 }),
        activity(8, { type: "plan_restored", planId: P1, number: 1 }),
      ],
      P1,
    );
    expect(history.map((item) => [item.id, item.entry.type])).toEqual([
      [8, "plan_restored"],
      [6, "plan_archived"],
      [5, "plan_edited"],
      [2, "plan_created"],
    ]);
  });
});
