import { TicketId, TicketStatusId, type TicketSummary } from "@t3tools/contracts";
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
});

describe("applyTicketListEvent", () => {
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
