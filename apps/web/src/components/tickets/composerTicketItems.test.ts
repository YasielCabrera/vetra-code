import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import { EnvironmentId, TicketId, TicketStatusId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { matchComposerTicketItems } from "./composerTicketItems";

const HERE = EnvironmentId.make("env-here");
const ELSEWHERE = EnvironmentId.make("env-elsewhere");

function ticket(input: {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly updatedAt?: string;
  readonly environmentId?: EnvironmentId;
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
    plans: [],
  };
}

const TICKETS = [
  ticket({ id: "login", number: 42, title: "Login loop after SSO" }),
  ticket({
    id: "logout",
    number: 4,
    title: "Logout button hidden",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }),
  ticket({ id: "catalog", number: 420, title: "Catalog blog posts" }),
  ticket({ id: "remote", number: 43, title: "Login on remote", environmentId: ELSEWHERE }),
];

const labels = (query: string) =>
  matchComposerTicketItems({ tickets: TICKETS, environmentId: HERE, query }).map(
    (item) => `${item.label} ${item.description}`,
  );

describe("matchComposerTicketItems", () => {
  it("finds a ticket by reference, the exact number first", () => {
    expect(labels("T-42")).toEqual(["T-42 Login loop after SSO", "T-420 Catalog blog posts"]);
  });

  it("finds tickets by a title word before a mid-word match, newest first", () => {
    expect(labels("lo")).toEqual([
      "T-4 Logout button hidden",
      "T-42 Login loop after SSO",
      "T-420 Catalog blog posts",
    ]);
  });

  it("leaves bare # and numbers to pull requests, and other environments out", () => {
    expect([labels(""), labels("42"), labels("remote")]).toEqual([[], [], []]);
  });
});
