import { EnvironmentId, TicketId, TicketPlanId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { askForPlanPrefill, revisePlanPrefill, ticketContextRecord } from "./ticketContextRecord";

const environmentId = EnvironmentId.make("env-1");

function ticketWithPlans(count: number) {
  return {
    id: TicketId.make("ticket-1"),
    number: 42,
    title: "Login loop",
    linkRefs: [],
    plans: Array.from({ length: count }, (_, index) => ({
      planId: TicketPlanId.make(`plan-${index + 1}`),
      ticketId: TicketId.make("ticket-1"),
      ref: `T-42/P${index + 1}`,
      number: index + 1,
      title: `Plan ${index + 1}`,
      status: "active" as const,
      revision: 1,
      openCommentCount: 0,
      createdBy: { type: "user" as const },
      updatedBy: { type: "user" as const },
      updatedAt: "2026-10-01T00:00:00.000Z",
    })),
  };
}

describe("ticketContextRecord", () => {
  it("references the first 50 plans, and omits plans for a ticket without any", () => {
    const many = ticketContextRecord({ environmentId, ticket: ticketWithPlans(60) });
    const none = ticketContextRecord({ environmentId, ticket: ticketWithPlans(0) });
    expect([many.plans?.length, many.plans?.at(-1)?.ref, "plans" in none]).toEqual([
      50,
      "T-42/P50",
      false,
    ]);
  });
});

describe("plan thread prefills", () => {
  const ticket = ticketWithPlans(1);

  it("asks for a plan by the ticket ref, and tells the agent not to change code", () => {
    expect(askForPlanPrefill(environmentId, ticket).instruction).toBe(
      "Write an implementation plan for T-42 with t3_ticket_plan_create. Do not change code.",
    );
  });

  it("tells the agent to revise the plan text and resolve open comments", () => {
    const plan = { ...ticket.plans[0]!, openCommentCount: 2 };
    expect(revisePlanPrefill(environmentId, plan).instruction).toBe(
      "Revise the plan text of T-42/P1 to address its open comments: edit it with t3_ticket_plan_update and resolve each comment it addresses. Do not change code.",
    );
  });

  it("omits open comments when the plan has none", () => {
    const plan = ticket.plans[0]!;
    expect(revisePlanPrefill(environmentId, plan).instruction).toBe(
      "Revise the plan text of T-42/P1 with t3_ticket_plan_update. Do not change code.",
    );
  });
});
