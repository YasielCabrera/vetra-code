// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
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
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: <T,>(select: (settings: { timestampFormat: "24-hour" }) => T) =>
    select({ timestampFormat: "24-hour" }),
}));
vi.mock("../ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <p>{text}</p>,
}));

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

const environmentId = EnvironmentId.make("environment-1");
const START = Date.parse("2026-10-03T14:21:05.000Z");

function activityAt(id: number, seconds: number, entry: TicketActivity["entry"]): TicketActivity {
  return {
    id,
    ticketId: plan.ticketId,
    actor: { type: "user" },
    createdAt: new Date(START + seconds * 1000).toISOString(),
    entry,
  };
}

function projectLinkBurst(count: number): TicketActivity[] {
  return Array.from({ length: count }, (_, step) =>
    activityAt(
      step + 1,
      step * 17,
      step % 2 === 0
        ? { type: "unlinked", kind: "project", targetKey: "project-a" }
        : { type: "linked", target: { kind: "project", projectId: ProjectId.make("project-a") } },
    ),
  );
}

function renderTimeline(activity: ReadonlyArray<TicketActivity>) {
  return act(async () =>
    root.render(
      <TicketActivityTimeline
        environmentId={environmentId}
        activity={activity}
        statusSet={null}
        plans={[plan]}
      />,
    ),
  );
}

function timelineRows() {
  return [...container.querySelectorAll('ol[aria-label="Ticket activity"] > li')];
}

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
      createdAt: "2026-10-01T11:00:00.000Z",
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

it("collapses a burst into one group that expands to every change and stays open", async () => {
  await renderTimeline(projectLinkBurst(12));
  const toggle = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(timelineRows()).toHaveLength(1);
  expect(toggle.textContent).toContain("You made 12 project link changes (+6 −6)");
  expect(toggle.textContent).toContain(", over 3 min");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain("unlinked a project");

  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const card = container.querySelector(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)!;
  const lines = [...card.querySelectorAll("li")].map((line) => line.textContent);
  expect(lines).toHaveLength(12);
  expect(lines[0]).toContain("unlinked a project");
  expect(lines[1]).toContain("linked a project");

  await renderTimeline(projectLinkBurst(13));
  const grown = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(grown.textContent).toContain("You made 13 project link changes (+6 −7)");
  expect(grown.getAttribute("aria-expanded")).toBe("true");
  expect(
    container.querySelectorAll(`#${CSS.escape(grown.getAttribute("aria-controls")!)} li`),
  ).toHaveLength(13);
});

it("folds the middle of a long timeline behind a control that reveals and hides it", async () => {
  // Edits ten minutes apart never group, so each one is its own row.
  const activity = [
    activityAt(1, 0, { type: "created" }),
    activityAt(2, 600, { type: "comment", body: "An early comment" }),
    ...Array.from({ length: 19 }, (_, step) =>
      activityAt(step + 3, 1200 + step * 600, { type: "edited", fields: ["body"] }),
    ),
  ];
  await renderTimeline(activity);
  const fold = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Show"),
  )!;
  expect(fold.textContent).toBe("Show 12 earlier updates, including 1 comment");
  expect(timelineRows()).toHaveLength(10);
  expect(container.textContent).not.toContain("An early comment");

  await act(async () => fold.click());
  expect(fold.textContent).toBe("Hide earlier updates");
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  expect(timelineRows()).toHaveLength(22);
  expect(container.textContent).toContain("An early comment");

  await act(async () => fold.click());
  expect(timelineRows()).toHaveLength(10);
  expect(container.textContent).not.toContain("An early comment");
});
