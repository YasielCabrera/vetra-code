import { TicketStatusId, type TicketStatusDefinition } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { summarizeThreadTicketStatuses } from "./ThreadTicketStatusSummary.logic";

const todo = {
  id: TicketStatusId.make("todo"),
  name: "Queued",
  color: "blue",
  category: "open",
  position: 0,
  collapsedByDefault: false,
  isDefault: true,
} satisfies TicketStatusDefinition;
const progress = {
  ...todo,
  id: TicketStatusId.make("progress"),
  name: "In progress",
  color: "amber",
  category: "active",
  position: 1,
} satisfies TicketStatusDefinition;
const done = {
  ...todo,
  id: TicketStatusId.make("done"),
  name: "Shipped",
  color: "green",
  category: "closed",
  closeReason: "completed",
  position: 2,
  collapsedByDefault: true,
} satisfies TicketStatusDefinition;
const sameName = {
  ...todo,
  id: TicketStatusId.make("unknown"),
  color: "violet",
  position: 3,
} satisfies TicketStatusDefinition;
const statuses = Object.freeze([done, progress, todo, sameName]);
const ticket = (id: string) => Object.freeze({ statusId: TicketStatusId.make(id) });

it.each([
  {
    name: "configured order and identical names while omitting unused statuses",
    tickets: [ticket("todo"), ticket("progress"), ticket("progress"), ticket("unknown")],
    statuses,
    expected: [
      { status: progress, count: 2 },
      { status: todo, count: 1 },
      { status: sameName, count: 1 },
    ],
  },
  {
    name: "all tickets in one collapsed status",
    tickets: Array.from({ length: 25 }, () => ticket("done")),
    statuses,
    expected: [{ status: done, count: 25 }],
  },
  {
    name: "empty tickets with configured statuses",
    tickets: [],
    statuses,
    expected: [],
  },
  {
    name: "missing definitions while tickets load independently",
    tickets: [ticket("todo"), ticket("deleted"), ticket("other-deleted")],
    statuses: undefined,
    expected: [{ status: undefined, count: 3 }],
  },
  {
    name: "mixed known and unresolved status IDs",
    tickets: [ticket("todo"), ticket("deleted"), ticket("deleted"), ticket("other-deleted")],
    statuses: [todo, progress],
    expected: [
      { status: todo, count: 1 },
      { status: undefined, count: 3 },
    ],
  },
  {
    name: "an empty definition list",
    tickets: [ticket("todo")],
    statuses: [],
    expected: [{ status: undefined, count: 1 }],
  },
  {
    name: "an empty board",
    tickets: [],
    statuses: undefined,
    expected: [],
  },
  {
    name: "large counts without limiting to visible ticket rows",
    tickets: [...Array.from({ length: 10_000 }, () => ticket("progress")), ticket("done")],
    statuses: [progress, done],
    expected: [
      { status: progress, count: 10_000 },
      { status: done, count: 1 },
    ],
  },
])("summarizes $name", ({ tickets, statuses, expected }) => {
  const input = Object.freeze({ tickets: Object.freeze(tickets), statuses });
  expect(summarizeThreadTicketStatuses(input)).toEqual(expected);
});
