import { EnvironmentId, TICKET_BODY_MAX_CHARS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ticketDraftEnvironment, validateNewTicketSearch } from "./ticketDraft.logic";

const primary = EnvironmentId.make("primary");
const remote = EnvironmentId.make("remote");

describe("ticket draft environment", () => {
  it("keeps an explicitly selected environment while it loads or disconnects", () => {
    expect(ticketDraftEnvironment(remote, primary, [primary])).toBe(remote);
    expect(ticketDraftEnvironment(remote, primary, [primary, remote])).toBe(remote);
    expect(ticketDraftEnvironment(remote, primary, [])).toBe(remote);
  });

  it("defaults an unbound draft to an available environment", () => {
    expect(ticketDraftEnvironment(null, primary, [remote, primary])).toBe(primary);
    expect(ticketDraftEnvironment(null, primary, [remote])).toBe(remote);
    expect(ticketDraftEnvironment(null, primary, [])).toBeNull();
  });
});

describe("new ticket prefill", () => {
  it("preserves a captured description up to the ticket body limit", () => {
    const prefix = "Captured context\n";
    const body = prefix + "x".repeat(TICKET_BODY_MAX_CHARS - prefix.length - 1) + "!";
    const prefill = validateNewTicketSearch({
      env: "remote",
      title: "Work",
      body,
      project: "project",
      thread: "thread",
    });
    expect(prefill).toEqual({
      env: "remote",
      title: "Work",
      body,
      project: "project",
      thread: "thread",
    });
  });
});
