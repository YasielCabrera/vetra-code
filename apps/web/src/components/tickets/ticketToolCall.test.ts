import { describe, expect, it } from "vite-plus/test";

import { createdTicketFromToolItem } from "./ticketToolCall";

const summary = {
  id: "ticket-1",
  number: 42,
  kind: "local",
  title: "Cart total is NaN",
  statusId: "todo",
};

describe("createdTicketFromToolItem", () => {
  it("reads the filed ticket from Claude's text envelope and Codex's structured content", () => {
    expect(
      createdTicketFromToolItem({
        type: "dynamic_tool",
        status: "completed",
        toolName: "mcp__vetra-code__t3_ticket_create",
        output: [{ type: "text", text: JSON.stringify(summary) }],
      }),
    ).toEqual({ id: "ticket-1", number: 42, title: "Cart total is NaN" });
    expect(
      createdTicketFromToolItem({
        type: "dynamic_tool",
        status: "completed",
        toolName: "vetra-code.t3_ticket_create",
        output: { structuredContent: summary },
      }),
    ).toEqual({ id: "ticket-1", number: 42, title: "Cart total is NaN" });
  });

  it("ignores other tools, unfinished calls and failed results", () => {
    const call = {
      type: "dynamic_tool",
      status: "completed",
      toolName: "t3_ticket_create",
      output: { structuredContent: summary },
    };
    expect(createdTicketFromToolItem(call)).not.toBeNull();
    expect(createdTicketFromToolItem({ ...call, toolName: "t3_ticket_update" })).toBeNull();
    expect(createdTicketFromToolItem({ ...call, status: "running" })).toBeNull();
    expect(
      createdTicketFromToolItem({ ...call, output: { isError: true, structuredContent: summary } }),
    ).toBeNull();
  });
});
