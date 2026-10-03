import { TicketStatusId, type TicketStatusDefinition } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  enqueueTicketStatusEdit,
  moveTicketStatus,
  settleTicketStatusEdit,
  ticketStatusUpsert,
} from "./ticketStatusSettings.logic";

const TODO: TicketStatusDefinition = {
  id: TicketStatusId.make("todo"),
  name: "Todo",
  color: "gray",
  category: "open",
  position: 1,
  collapsedByDefault: false,
  isDefault: true,
};

const CANCELED: TicketStatusDefinition = {
  id: TicketStatusId.make("canceled"),
  name: "Canceled",
  color: "red",
  category: "closed",
  closeReason: "not_planned",
  position: 5,
  collapsedByDefault: true,
  isDefault: false,
};

describe("ticketStatusUpsert", () => {
  it("sends the whole definition with the edit applied", () => {
    expect(ticketStatusUpsert(TODO, { name: "To do", makeDefault: true })).toEqual({
      statusId: "todo",
      name: "To do",
      color: "gray",
      category: "open",
      collapsedByDefault: false,
      isDefault: true,
    });
  });

  it("adds a close reason when a status becomes closed and drops it when it reopens", () => {
    expect(ticketStatusUpsert(TODO, { category: "closed" })).toEqual({
      statusId: "todo",
      name: "Todo",
      color: "gray",
      category: "closed",
      closeReason: "completed",
      collapsedByDefault: false,
    });
    expect(ticketStatusUpsert(CANCELED, { color: "gray" })).toMatchObject({
      category: "closed",
      closeReason: "not_planned",
    });
    expect(ticketStatusUpsert(CANCELED, { category: "active" })).toEqual({
      statusId: "canceled",
      name: "Canceled",
      color: "red",
      category: "active",
      collapsedByDefault: true,
    });
  });
});

describe("moveTicketStatus", () => {
  const ids = ["a", "b", "c"].map((id) => TicketStatusId.make(id));
  it("swaps with the neighbour and stops at the ends", () => {
    expect(moveTicketStatus(ids, TicketStatusId.make("b"), -1)).toEqual(["b", "a", "c"]);
    expect(moveTicketStatus(ids, TicketStatusId.make("b"), 1)).toEqual(["a", "c", "b"]);
    expect(moveTicketStatus(ids, TicketStatusId.make("c"), 1)).toBe(ids);
  });
});

describe("ticket status edit queue", () => {
  const renamed: TicketStatusDefinition = {
    id: TicketStatusId.make("todo"),
    name: "To do",
    color: "gray",
    category: "open",
    position: 1,
    collapsedByDefault: false,
    isDefault: true,
  };

  it("builds a queued recolor from the rename returned by the server, despite stale props", () => {
    const first = enqueueTicketStatusEdit(undefined, TODO, { name: "To do" });
    const second = enqueueTicketStatusEdit(first, TODO, { color: "blue" });
    expect(second.edits).toEqual([{ name: "To do" }, { color: "blue" }]);
    const next = settleTicketStatusEdit(second, { statuses: [renamed, CANCELED] });
    expect(next.edits).toEqual([{ color: "blue" }]);
    expect(ticketStatusUpsert(next.status, next.edits[0]!)).toEqual({
      statusId: "todo",
      name: "To do",
      color: "blue",
      category: "open",
      collapsedByDefault: false,
    });
    expect(first.edits).toEqual([{ name: "To do" }]);
    expect(TODO.name).toBe("Todo");
  });

  it("uses the returned closed category and close reason for the next edit", () => {
    const closed = enqueueTicketStatusEdit(undefined, TODO, {
      category: "closed",
      closeReason: "not_planned",
    });
    const pending = enqueueTicketStatusEdit(closed, TODO, { name: "Canceled work" });
    const next = settleTicketStatusEdit(pending, {
      statuses: [
        {
          id: TicketStatusId.make("todo"),
          name: "Todo",
          color: "gray",
          category: "closed",
          closeReason: "not_planned",
          position: 1,
          collapsedByDefault: false,
          isDefault: false,
        },
      ],
    });
    expect(ticketStatusUpsert(next.status, next.edits[0]!)).toEqual({
      statusId: "todo",
      name: "Canceled work",
      color: "gray",
      category: "closed",
      closeReason: "not_planned",
      collapsedByDefault: false,
    });
  });

  it("continues after a failed edit without applying the rejected value", () => {
    const failed = enqueueTicketStatusEdit(undefined, TODO, { name: "Rejected name" });
    const pending = enqueueTicketStatusEdit(failed, TODO, { color: "blue" });
    const next = settleTicketStatusEdit(pending, null);
    expect(ticketStatusUpsert(next.status, next.edits[0]!)).toEqual({
      statusId: "todo",
      name: "Todo",
      color: "blue",
      category: "open",
      collapsedByDefault: false,
    });
  });

  it("keeps the last response while props lag, then accepts a fresh definition when idle", () => {
    const pending = enqueueTicketStatusEdit(undefined, TODO, { name: "To do" });
    const idle = settleTicketStatusEdit(pending, { statuses: [renamed] });
    expect(idle.edits).toEqual([]);
    const stale = enqueueTicketStatusEdit(idle, TODO, { color: "blue" });
    expect(stale.status.name).toBe("To do");
    const fresh = enqueueTicketStatusEdit(idle, { ...renamed, name: "Next" }, { color: "red" });
    expect(ticketStatusUpsert(fresh.status, fresh.edits[0]!)).toEqual({
      statusId: "todo",
      name: "Next",
      color: "red",
      category: "open",
      collapsedByDefault: false,
    });
  });
});
