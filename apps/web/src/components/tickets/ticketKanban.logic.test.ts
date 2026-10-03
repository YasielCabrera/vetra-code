import { type EnvironmentTicket, ticketKey } from "@t3tools/client-runtime/state/tickets";
import { EnvironmentId, TicketId, TicketStatusId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyPendingMoves,
  dropSortKey,
  settlePendingMoves,
  statusForColumn,
} from "./ticketKanban.logic";

describe("dropSortKey", () => {
  const column = ["a0", "a1", "a2"];

  it("places a card from another column at the top, bottom or between neighbours", () => {
    expect(dropSortKey(column, 0, -1)).toBe("Zz");
    expect(dropSortKey(column, 3, -1)).toBe("a3");
    expect(dropSortKey(column, 1, -1)).toBe("a0V");
  });

  it("starts an empty column", () => {
    expect(dropSortKey([], 0, -1)).toBe("a0");
  });

  it("reorders within a column, ignoring the card's own key", () => {
    expect(dropSortKey(column, 3, 0)).toBe("a3");
    expect(dropSortKey(column, 0, 2)).toBe("Zz");
    expect(dropSortKey(column, 2, 0)).toBe("a1V");
    expect(dropSortKey(column, 1, 2)).toBe("a0V");
  });

  it("is a no-op when the card lands next to itself", () => {
    expect(dropSortKey(column, 1, 1)).toBeNull();
    expect(dropSortKey(column, 2, 1)).toBeNull();
    expect(dropSortKey(column, 0, 0)).toBeNull();
  });

  it("skips past keys tied across environments", () => {
    expect(dropSortKey(["a0", "a0", "a1"], 1, -1)).toBe("a0V");
    expect(dropSortKey(["a0", "a0"], 1, -1)).toBe("a1");
  });
});

describe("statusForColumn", () => {
  const todo = {
    id: TicketStatusId.make("remote-todo"),
    name: "To do ",
    color: "gray",
    category: "open",
    position: 0,
    collapsedByDefault: false,
    isDefault: true,
  } as const;
  const otherTodo = { ...todo, id: TicketStatusId.make("remote-todo-2"), isDefault: false };
  const elsewhere = TicketStatusId.make("remote-doing");

  it("finds the ticket's own environment's status by category and name", () => {
    expect(statusForColumn({ statuses: [todo] }, "open:to do", elsewhere)?.id).toBe("remote-todo");
  });

  it("keeps the current status when two statuses share the column", () => {
    const statuses = { statuses: [todo, otherTodo] };
    expect(statusForColumn(statuses, "open:to do", otherTodo.id)?.id).toBe("remote-todo-2");
    expect(statusForColumn(statuses, "open:to do", elsewhere)?.id).toBe("remote-todo");
  });

  it("finds nothing when that environment has no such status", () => {
    expect(statusForColumn({ statuses: [todo] }, "active:to do", elsewhere)).toBeUndefined();
    expect(statusForColumn(undefined, "open:to do", elsewhere)).toBeUndefined();
  });
});

describe("applyPendingMoves", () => {
  const environmentId = EnvironmentId.make("env-local");
  const card: EnvironmentTicket = {
    kind: "local",
    environmentId,
    id: TicketId.make("login"),
    number: 7,
    title: "Login button misaligned",
    labels: [],
    statusId: TicketStatusId.make("todo"),
    sortKey: "a0",
    revision: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    createdBy: { type: "user" },
    linkRefs: [],
    attachmentCount: 0,
  };
  const pending = new Map([
    [
      ticketKey({ environmentId, ticketId: card.id }),
      { fromRevision: 3, statusId: TicketStatusId.make("doing"), sortKey: "a5" },
    ],
  ]);
  const placement = (tickets: ReadonlyArray<EnvironmentTicket>) =>
    tickets.map((ticket) => [ticket.statusId, ticket.sortKey, ticket.revision]);

  it("shows a pending drop until the server sends a newer revision", () => {
    expect(placement(applyPendingMoves([card], pending))).toEqual([["doing", "a5", 3]]);
    expect(placement(applyPendingMoves([{ ...card, revision: 4 }], pending))).toEqual([
      ["todo", "a0", 4],
    ]);
  });

  it("settles a pending drop once the server sends a newer revision or drops the ticket", () => {
    expect([...settlePendingMoves(pending, [card]).keys()]).toEqual(["env-local:login"]);
    expect([...settlePendingMoves(pending, [{ ...card, revision: 4 }]).keys()]).toEqual([]);
    expect([...settlePendingMoves(pending, []).keys()]).toEqual([]);
  });
});
