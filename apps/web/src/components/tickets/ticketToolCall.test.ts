import { describe, expect, it } from "vite-plus/test";

import { ticketToolCallTarget } from "./ticketToolCall";

const summary = {
  id: "ticket-1",
  number: 42,
  kind: "local",
  title: "Cart total is NaN",
  statusId: "todo",
};

const plan = {
  ticketId: "ticket-1",
  planId: "plan-1",
  ref: "T-42/P2",
  number: 2,
  title: "Fix the cart total",
  status: "active",
  revision: 3,
};

describe("ticketToolCallTarget", () => {
  it("reads the filed ticket from Claude's text envelope and Codex's structured content", () => {
    expect(
      ticketToolCallTarget({
        type: "dynamic_tool",
        status: "completed",
        toolName: "mcp__vetra-code__t3_ticket_create",
        output: [{ type: "text", text: JSON.stringify(summary) }],
      }),
    ).toEqual({
      kind: "ticket",
      ticket: { id: "ticket-1", number: 42, title: "Cart total is NaN" },
    });
    expect(
      ticketToolCallTarget({
        type: "dynamic_tool",
        status: "completed",
        toolName: "vetra-code.t3_ticket_create",
        output: { structuredContent: summary },
      }),
    ).toEqual({
      kind: "ticket",
      ticket: { id: "ticket-1", number: 42, title: "Cart total is NaN" },
    });
  });

  it("reads the plan a plan create or update wrote", () => {
    const written = {
      kind: "plan",
      plan: { ticketId: "ticket-1", number: 2, ref: "T-42/P2", title: "Fix the cart total" },
    };
    expect(
      ticketToolCallTarget({
        type: "dynamic_tool",
        status: "completed",
        toolName: "mcp__vetra-code__t3_ticket_plan_create",
        output: [{ type: "text", text: JSON.stringify(plan) }],
      }),
    ).toEqual(written);
    expect(
      ticketToolCallTarget({
        type: "dynamic_tool",
        status: "completed",
        toolName: "vetra-code.t3_ticket_plan_update",
        output: { structuredContent: plan },
      }),
    ).toEqual(written);
  });

  it("ignores other tools, unfinished calls and failed results", () => {
    const call = {
      type: "dynamic_tool",
      status: "completed",
      toolName: "t3_ticket_create",
      output: { structuredContent: summary },
    };
    expect(ticketToolCallTarget(call)).not.toBeNull();
    expect(ticketToolCallTarget({ ...call, toolName: "t3_ticket_update" })).toBeNull();
    expect(ticketToolCallTarget({ ...call, toolName: "t3_ticket_plan_get" })).toBeNull();
    expect(ticketToolCallTarget({ ...call, status: "running" })).toBeNull();
    expect(
      ticketToolCallTarget({ ...call, output: { isError: true, structuredContent: summary } }),
    ).toBeNull();
  });
});
