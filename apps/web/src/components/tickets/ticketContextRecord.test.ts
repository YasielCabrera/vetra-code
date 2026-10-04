import { EnvironmentId, TicketId, TicketPlanId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ticketContextRecord } from "./ticketContextRecord";

const environmentId = EnvironmentId.make("env-1");

function ticketWithPlans(count: number) {
  return {
    id: TicketId.make("ticket-1"),
    number: 42,
    title: "Login loop",
    linkRefs: [],
    plans: Array.from({ length: count }, (_, index) => ({
      planId: TicketPlanId.make(`plan-${index + 1}`),
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
