import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import {
  EnvironmentId,
  TicketId,
  TicketPlanId,
  TicketStatusId,
  type TicketPlanSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchComposerTicketItems } from "./composerTicketItems";

const HERE = EnvironmentId.make("env-here");
const ELSEWHERE = EnvironmentId.make("env-elsewhere");

function plan(input: {
  readonly ticketNumber: number;
  readonly number: number;
  readonly title: string;
  readonly status?: TicketPlanSummary["status"];
  readonly updatedAt?: string;
}): TicketPlanSummary {
  return {
    planId: TicketPlanId.make(`plan-${input.ticketNumber}-${input.number}`),
    ref: `T-${input.ticketNumber}/P${input.number}`,
    number: input.number,
    title: input.title,
    status: input.status ?? "active",
    revision: 1,
    openCommentCount: 0,
    createdBy: { type: "user" },
    updatedBy: { type: "user" },
    updatedAt: input.updatedAt ?? "2026-10-01T00:00:00.000Z",
  };
}

function ticket(input: {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly updatedAt?: string;
  readonly environmentId?: EnvironmentId;
  readonly plans?: ReadonlyArray<TicketPlanSummary>;
}): EnvironmentTicket {
  return {
    kind: "local",
    environmentId: input.environmentId ?? HERE,
    id: TicketId.make(input.id),
    number: input.number,
    title: input.title,
    labels: [],
    statusId: TicketStatusId.make("todo"),
    sortKey: "a0",
    revision: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-10-01T00:00:00.000Z",
    createdBy: { type: "user" },
    linkRefs: [],
    attachmentCount: 0,
    plans: input.plans ?? [],
  };
}

const TICKETS = [
  ticket({
    id: "login",
    number: 42,
    title: "Login loop after SSO",
    plans: [
      plan({ ticketNumber: 42, number: 1, title: "Auth migration" }),
      plan({ ticketNumber: 42, number: 2, title: "Rollback auth path", status: "archived" }),
      plan({
        ticketNumber: 42,
        number: 10,
        title: "Session cleanup",
        updatedAt: "2026-10-03T00:00:00.000Z",
      }),
    ],
  }),
  ticket({
    id: "logout",
    number: 4,
    title: "Logout button hidden",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }),
  ticket({
    id: "catalog",
    number: 420,
    title: "Catalog blog posts",
    plans: [plan({ ticketNumber: 420, number: 1, title: "Sessionless catalog" })],
  }),
  ticket({
    id: "remote",
    number: 43,
    title: "Login on remote",
    environmentId: ELSEWHERE,
    plans: [plan({ ticketNumber: 43, number: 1, title: "Auth on remote" })],
  }),
  {
    ...ticket({
      id: "untracked",
      number: 50,
      title: "Untracked issue",
      plans: [plan({ ticketNumber: 50, number: 1, title: "Auth for untracked" })],
    }),
    kind: "github",
    github: {
      host: "github.com",
      repository: "acme/web",
      number: 12,
      state: "open",
      stateReason: null,
      author: "octocat",
      assignees: [],
      updatedAt: "2026-10-01T00:00:00.000Z",
      syncedAt: "2026-10-01T00:00:00.000Z",
      url: "https://github.com/acme/web/issues/12",
    },
    hiddenAt: "2026-10-02T00:00:00.000Z",
  } satisfies EnvironmentTicket,
];

const labels = (query: string) =>
  matchComposerTicketItems({ tickets: TICKETS, environmentId: HERE, query }).map(
    (item) => `${item.type} ${item.label} ${item.description}`,
  );

describe("matchComposerTicketItems", () => {
  it("finds a ticket by reference, the exact number first", () => {
    expect(labels("T-42")).toEqual([
      "ticket T-42 Login loop after SSO",
      "ticket T-420 Catalog blog posts",
    ]);
  });

  it("finds tickets by a title word before a mid-word match, newest first", () => {
    expect(labels("lo")).toEqual([
      "ticket T-4 Logout button hidden",
      "ticket T-42 Login loop after SSO",
      "ticket T-420 Catalog blog posts",
    ]);
  });

  it("leaves bare # and numbers to pull requests, and other environments out", () => {
    expect([labels(""), labels("42"), labels("remote")]).toEqual([[], [], []]);
  });

  it("lists one ticket's plans in number order, archived ones included", () => {
    expect(labels("T-42/")).toEqual([
      "ticket-plan T-42/P1 Auth migration",
      "ticket-plan T-42/P2 Rollback auth path (archived)",
      "ticket-plan T-42/P10 Session cleanup",
    ]);
  });

  it("narrows a plan reference by number, the exact number first", () => {
    expect([labels("T-42/P1"), labels("t-42/p")]).toEqual([
      ["ticket-plan T-42/P1 Auth migration", "ticket-plan T-42/P10 Session cleanup"],
      [
        "ticket-plan T-42/P1 Auth migration",
        "ticket-plan T-42/P2 Rollback auth path (archived)",
        "ticket-plan T-42/P10 Session cleanup",
      ],
    ]);
  });

  it("matches active plan titles by word after the tickets, leaving hidden issues out", () => {
    expect([labels("auth"), labels("sess")]).toEqual([
      ["ticket-plan T-42/P1 Auth migration"],
      ["ticket-plan T-42/P10 Session cleanup", "ticket-plan T-420/P1 Sessionless catalog"],
    ]);
    expect(labels("catalog")).toEqual([
      "ticket T-420 Catalog blog posts",
      "ticket-plan T-420/P1 Sessionless catalog",
    ]);
  });
});
