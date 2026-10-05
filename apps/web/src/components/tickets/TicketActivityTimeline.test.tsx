// @vitest-environment jsdom

import {
  EnvironmentId,
  TicketId,
  TicketPlanId,
  type TicketActivity,
  type TicketPlanSummary,
} from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { TicketActivityTimeline } from "./TicketActivityTimeline";

vi.mock("../../state/entities", () => ({
  useThreadShell: () => null,
  useThreadShells: () => [],
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  return { cn: cx };
});

const plan: TicketPlanSummary = {
  planId: TicketPlanId.make("plan-1"),
  ticketId: TicketId.make("ticket-1"),
  ref: "T-1/P1",
  number: 1,
  title: "Plan",
  status: "active",
  reviewStatus: "draft",
  revision: 1,
  openCommentCount: 0,
  createdBy: { type: "user" },
  updatedBy: { type: "user" },
  updatedAt: "2026-10-01T10:00:00.000Z",
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows each review transition's destination beside the plan reference", async () => {
  const activity: TicketActivity[] = [
    {
      id: 1,
      ticketId: plan.ticketId,
      actor: { type: "user" },
      createdAt: plan.updatedAt,
      entry: {
        type: "plan_review_status_changed",
        planId: plan.planId,
        number: 1,
        from: "draft",
        to: "ready",
      },
    },
    {
      id: 2,
      ticketId: plan.ticketId,
      actor: { type: "user" },
      createdAt: plan.updatedAt,
      entry: {
        type: "plan_review_status_changed",
        planId: plan.planId,
        number: 1,
        from: "ready",
        to: "draft",
      },
    },
  ];
  await act(async () =>
    root.render(
      <TicketActivityTimeline
        environmentId={EnvironmentId.make("environment-1")}
        activity={activity}
        statusSet={null}
        plans={[plan]}
      />,
    ),
  );
  const entries = [...container.querySelectorAll("li")].map((item) => item.textContent);
  expect(entries[0]).toContain("You marked plan P1 Ready");
  expect(entries[1]).toContain("You marked plan P1 Draft");
});
