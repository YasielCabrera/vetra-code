// @vitest-environment jsdom

import { setupSpeechTest, speechTest } from "../../readAloud.test-support";
import {
  EnvironmentId,
  TicketId,
  TicketPlanId,
  TicketStatusId,
  type TicketPlan,
  type TicketSummary,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stopSpeech, useSpeechPlayback } from "../../readAloud";
import { TicketPlanPreview, TicketPlanPreviewHeader } from "./TicketPlans";

vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => ({}) }));
vi.mock("../../state/tickets", () => ({ useTicketPlan: () => result }));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../lib/utils", async () => ({ cn: (await import("class-variance-authority")).cx }));
vi.mock("../../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./TicketStartThreadMenu", () => ({ TicketStartThreadSubmenu: () => null }));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));

const plan: TicketPlan = {
  summary: {
    planId: TicketPlanId.make("plan-1"),
    ticketId: TicketId.make("ticket-1"),
    ref: "T-1/P1",
    number: 1,
    title: "Summary title",
    status: "active",
    reviewStatus: "draft",
    revision: 1,
    openCommentCount: 9,
    createdBy: { type: "user" },
    updatedBy: { type: "user" },
    updatedAt: "2026-10-01T10:00:00.000Z",
  },
  body: "Full preview body.",
  comments: [],
  attachments: [],
};
const ticket: TicketSummary = {
  id: plan.summary.ticketId,
  number: 1,
  kind: "local",
  title: "Parent ticket",
  labels: [],
  statusId: TicketStatusId.make("open"),
  sortKey: "a",
  revision: 1,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  createdBy: { type: "user" },
  linkRefs: [],
  attachmentCount: 0,
  plans: [plan.summary],
};
const ticketRef = { environmentId: EnvironmentId.make("remote-preview"), ticketId: ticket.id };
let result: AsyncResult.AsyncResult<TicketPlan, unknown>;
let root: Root;
let container: HTMLDivElement;
function Playback() {
  const playback = useSpeechPlayback();
  return <output>{playback === null ? "idle" : `${playback.key} ${playback.phase}`}</output>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setupSpeechTest();
  result = AsyncResult.initial();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    stopSpeech();
  });
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}

describe.each([false, true])("plan preview read aloud, stacked=%s", (stacked) => {
  it("waits for the full body and reads updated content", async () => {
    const bodyRef = createRef<HTMLDivElement>();
    const renderPreview = () => (
      <>
        {!stacked && (
          <header>
            <TicketPlanPreviewHeader
              ticketRef={ticketRef}
              ticket={ticket}
              plan={plan.summary}
              bodyRef={bodyRef}
              onBack={() => {}}
            />
          </header>
        )}
        <TicketPlanPreview
          ticketRef={ticketRef}
          ticket={ticket}
          plan={plan.summary}
          bodyRef={bodyRef}
          stacked={stacked}
          onBack={() => {}}
        />
        <Playback />
      </>
    );
    await act(async () => root.render(renderPreview()));
    expect(container.textContent).toContain("Loading plan…");
    expect(container.querySelector('button[aria-label="Read aloud"]')).toBeNull();
    result = AsyncResult.failure(Cause.fail(new Error("Offline")));
    await act(async () => root.render(renderPreview()));
    expect(container.textContent).toContain("This plan could not be loaded.");
    expect(container.querySelector('button[aria-label="Read aloud"]')).toBeNull();
    result = AsyncResult.success(plan);
    await act(async () => root.render(renderPreview()));
    await click("Read aloud");
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "remote-preview",
      input: { text: "Full preview body." },
    });
    expect(container.querySelector("output")?.textContent).toBe(
      "plan:remote-preview:plan-1 playing",
    );
    await click("Stop reading");
    result = AsyncResult.success({
      ...plan,
      summary: { ...plan.summary, revision: 2 },
      body: "Updated full body.",
    });
    await act(async () => root.render(renderPreview()));
    await click("Read aloud");
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "remote-preview",
      input: { text: "Updated full body." },
    });
    const headerButtons = [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
    expect(
      headerButtons.findIndex((button) => button.getAttribute("aria-label") === "Stop reading"),
    ).toBeLessThan(
      headerButtons.findIndex(
        (button) => button.getAttribute("aria-label") === "Options for T-1/P1 preview",
      ),
    );
  });
});
