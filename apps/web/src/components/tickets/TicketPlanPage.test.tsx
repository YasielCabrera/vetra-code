// @vitest-environment jsdom

import {
  TicketId,
  TicketPlanCommentId,
  TicketPlanId,
  TicketStatusId,
  type TicketDetail,
  type TicketPlan,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setupSpeechTest, speechTest } from "../../readAloud.test-support";

import type { useTicketActions } from "../../hooks/useTicketActions";
import type TicketBodyEditor from "./TicketBodyEditor";
import type { TicketPlanCommentSurface } from "./TicketPlanCommentSurface";
import { TicketPlanPage } from "./TicketPlanPage";

vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => actions }));
vi.mock("../../state/tickets", () => ({
  useTicket: () => currentTicket,
  useTicketDetail: (ref: unknown) => (ref === null ? AsyncResult.initial() : currentDetail),
  useTicketPlan: () => AsyncResult.success(currentPlan),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  return { cn: cx };
});
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../hooks/useViewportWidth", () => ({ useViewportWidth: () => 800 }));
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: (input: unknown) => input,
  toastManager: { add: vi.fn() },
}));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: ({ children }: { children: ReactNode }) => <nav>{children}</nav>,
  WorkspaceBreadcrumbItem: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  WorkspaceBreadcrumbSeparator: () => null,
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("./TicketActivityTimeline", () => ({
  TicketActorName: () => "You",
  PLAN_ENTRY_VERBS: { plan_review_status_changed: "marked" },
}));
vi.mock("./TicketStartThreadMenu", () => ({ TicketStartThreadSubmenu: () => null }));
vi.mock("./TicketPlanCommentSurface", () => ({
  PLAN_BLOCK_LABELS: {},
  TicketPlanCommentSurface: ({
    children,
    onDraft,
    revision,
  }: Parameters<typeof TicketPlanCommentSurface>[0]) => (
    <div>
      {children}
      {["Selection A", "Selection B"].map((source) => (
        <button
          key={source}
          onClick={() => onDraft({ anchor: { source, revision }, kind: null, range: null })}
        >
          {source}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("./TicketBodyEditor", () => ({
  default: ({ value, onChange, disabled, ariaLabel }: Parameters<typeof TicketBodyEditor>[0]) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

const navigate = vi.fn();
const actions = {
  updatePlan: vi.fn<ReturnType<typeof useTicketActions>["updatePlan"]>(),
  addPlanComment: vi.fn<ReturnType<typeof useTicketActions>["addPlanComment"]>(),
  confirmDeletePlan: vi.fn<ReturnType<typeof useTicketActions>["confirmDeletePlan"]>(),
  deletePlan: vi.fn<ReturnType<typeof useTicketActions>["deletePlan"]>(),
};
const plan: TicketPlan = {
  summary: {
    planId: TicketPlanId.make("plan-1"),
    ticketId: TicketId.make("ticket-1"),
    ref: "T-1/P1",
    number: 1,
    title: "Saved title",
    status: "active",
    reviewStatus: "draft",
    revision: 1,
    openCommentCount: 0,
    createdBy: { type: "user" },
    updatedBy: { type: "user" },
    updatedAt: "2026-10-01T10:00:00.000Z",
  },
  body: "Saved body",
  comments: [],
  attachments: [],
};
let currentPlan = plan;
const detail: TicketDetail = {
  summary: {
    id: plan.summary.ticketId,
    number: 1,
    kind: "local",
    title: "Ticket",
    labels: [],
    statusId: TicketStatusId.make("open"),
    sortKey: "a0",
    revision: 1,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    createdBy: { type: "user" },
    linkRefs: [],
    attachmentCount: 0,
    plans: [plan.summary],
  },
  body: "Ticket body",
  links: [],
  attachments: [],
  activity: [],
};
let currentTicket: TicketDetail["summary"] | null = detail.summary;
let currentDetail: AsyncResult.AsyncResult<TicketDetail, unknown> = AsyncResult.success(detail);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setupSpeechTest();
  actions.updatePlan.mockReset();
  actions.addPlanComment.mockReset();
  actions.confirmDeletePlan.mockReset();
  actions.deletePlan.mockReset();
  navigate.mockReset();
  currentPlan = plan;
  currentTicket = detail.summary;
  currentDetail = AsyncResult.success(detail);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function titleEditor() {
  const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="Plan title"]');
  if (!textarea) throw new Error("Plan title was not rendered");
  return textarea;
}

async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent === label,
  );
  if (!button) throw new Error(`Missing control: ${label}`);
  await act(async () => button.click());
}

async function renderPage() {
  await act(async () =>
    root.render(
      <TicketPlanPage ticketKey="environment-1:ticket-1" planNumber="1" startEditing={false} />,
    ),
  );
}

async function editTitle(title: string) {
  const textarea = titleEditor();
  await act(async () => {
    textarea.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      title,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.blur();
  });
}

async function editTextarea(label: string, value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  if (!textarea) throw new Error(`Missing textarea: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}

function deferredPlanWrite() {
  let resolve = (_result: Awaited<ReturnType<typeof actions.updatePlan>>) => {};
  const promise = new Promise<Awaited<ReturnType<typeof actions.updatePlan>>>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function reviewLabel() {
  return container.querySelector('[aria-label="Plan review status"]')?.textContent;
}

describe("TicketPlanPage loading", () => {
  it("opens the plan from the board while the ticket's detail is still loading", async () => {
    currentDetail = AsyncResult.initial(true);
    await renderPage();
    expect(titleEditor().value).toBe("Saved title");
    await click("History");
    expect(container.textContent).toContain("Loading history…");
  });

  it("opens a plan on a ticket the board does not list from the ticket's detail", async () => {
    currentTicket = null;
    await renderPage();
    expect(titleEditor().value).toBe("Saved title");
  });
});

describe("TicketPlanPage archive", () => {
  it("keeps a failed in-flight title draft editable and aborts archive before any status write", async () => {
    let completeTitle = (_result: Awaited<ReturnType<typeof actions.updatePlan>>) => {};
    const titleReply = new Promise<Awaited<ReturnType<typeof actions.updatePlan>>>((complete) => {
      completeTitle = complete;
    });
    actions.updatePlan.mockReturnValue(titleReply);
    await renderPage();
    await editTitle("Unsaved title");
    await click("Options for T-1/P1");
    await click("Archive");

    expect(titleEditor().disabled).toBe(true);
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    await act(async () => completeTitle(null));
    expect(titleEditor().disabled).toBe(false);
    expect(titleEditor().value).toBe("Unsaved title");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
  });

  it("flushes a new body before archive and keeps the draft editable when that save fails", async () => {
    let completeBody = (_result: Awaited<ReturnType<typeof actions.updatePlan>>) => {};
    const bodyReply = new Promise<Awaited<ReturnType<typeof actions.updatePlan>>>((complete) => {
      completeBody = complete;
    });
    actions.updatePlan.mockReturnValue(bodyReply);
    await renderPage();
    await click("Edit plan");
    const textarea = await editTextarea("Plan", "Keep this new body");
    await click("Options for T-1/P1");
    await click("Archive");
    expect(textarea.disabled).toBe(true);
    expect(actions.updatePlan).toHaveBeenCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      body: "Keep this new body",
    });
    await act(async () => completeBody(null));
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe("Keep this new body");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
  });

  it("saves title and body in order before allowing archive", async () => {
    let completeTitle = (_result: Awaited<ReturnType<typeof actions.updatePlan>>) => {};
    let completeBody = (_result: Awaited<ReturnType<typeof actions.updatePlan>>) => {};
    const titleReply = new Promise<Awaited<ReturnType<typeof actions.updatePlan>>>((complete) => {
      completeTitle = complete;
    });
    const bodyReply = new Promise<Awaited<ReturnType<typeof actions.updatePlan>>>((complete) => {
      completeBody = complete;
    });
    actions.updatePlan
      .mockReturnValueOnce(titleReply)
      .mockReturnValueOnce(bodyReply)
      .mockResolvedValueOnce({
        plan: { ...plan.summary, status: "archived", revision: 3 },
        contentCommit: { observedRevision: 3, revision: 3 },
        attachments: [],
      });
    await renderPage();
    await editTitle("New title");
    await click("Edit plan");
    const textarea = await editTextarea("Plan", "New body");
    await click("Options for T-1/P1");
    await click("Archive");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    expect(textarea.disabled).toBe(true);
    await act(async () =>
      completeTitle({
        plan: { ...plan.summary, title: "New title", revision: 2 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      }),
    );
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      body: "New body",
    });
    expect(actions.updatePlan).toHaveBeenCalledTimes(2);
    await act(async () =>
      completeBody({
        plan: { ...plan.summary, revision: 3 },
        contentCommit: { observedRevision: 2, revision: 3 },
        attachments: [],
      }),
    );
    expect(actions.updatePlan).toHaveBeenCalledTimes(3);
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 3,
      status: "archived",
    });
  });

  it("restores the original title when the earlier title write is still pending", async () => {
    let completeTitle = (_result: Awaited<ReturnType<typeof actions.updatePlan>>) => {};
    const titleReply = new Promise<Awaited<ReturnType<typeof actions.updatePlan>>>((complete) => {
      completeTitle = complete;
    });
    actions.updatePlan.mockReturnValueOnce(titleReply).mockResolvedValue({
      plan: { ...plan.summary, revision: 3 },
      contentCommit: { observedRevision: 2, revision: 3 },
      attachments: [],
    });
    await renderPage();
    await editTitle("Temporary title");
    await editTitle("Saved title");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    await act(async () =>
      completeTitle({
        plan: { ...plan.summary, title: "Temporary title", revision: 2 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      }),
    );
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      title: "Saved title",
    });
    expect(titleEditor().value).toBe("Saved title");
  });

  it("retries a retained failed draft after restoring a plan archived by another client", async () => {
    actions.updatePlan
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ plan: plan.summary, attachments: [] })
      .mockResolvedValue({
        plan: { ...plan.summary, revision: 2 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      });
    await renderPage();
    await click("Edit plan");
    await editTextarea("Plan", "Retained failed body");
    await click("Options for T-1/P1");
    await click("Archive");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    currentPlan = { ...plan, summary: { ...plan.summary, status: "archived" } };
    await renderPage();
    await click("Restore");
    expect(actions.updatePlan).toHaveBeenNthCalledWith(2, "environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      status: "active",
    });
    expect(actions.updatePlan).toHaveBeenCalledTimes(3);
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      body: "Retained failed body",
    });
  });
});

describe("TicketPlanPage review status", () => {
  it("cancels Ready when a title save succeeds without a content receipt", async () => {
    actions.updatePlan.mockResolvedValue({
      plan: { ...plan.summary, title: "Reviewed title", revision: 2 },
      attachments: [],
    });
    await renderPage();
    await editTextarea("Plan title", "Reviewed title");
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenCalledExactlyOnceWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      title: "Reviewed title",
    });
    expect(titleEditor().value).toBe("Reviewed title");
    expect(titleEditor().disabled).toBe(false);
    expect(reviewLabel()).toBe("Draft");
  });

  it("waits for full content after an ordinary old-server title save before allowing Ready", async () => {
    actions.updatePlan.mockResolvedValue({
      plan: { ...plan.summary, title: "Saved on older server", revision: 2 },
      attachments: [],
    });
    await renderPage();
    await editTitle("Saved on older server");
    expect(actions.updatePlan).toHaveBeenCalledExactlyOnceWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      title: "Saved on older server",
    });
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    expect(reviewLabel()).toBe("Draft");
    currentPlan = {
      ...plan,
      summary: { ...plan.summary, title: "Saved on older server", revision: 2 },
      body: "Full streamed body to review",
    };
    await renderPage();
    expect(container.textContent).toContain("Full streamed body to review");
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      reviewStatus: "ready",
    });
    expect(actions.updatePlan).toHaveBeenCalledTimes(2);
    expect(reviewLabel()).toBe("Draft");
  });

  it("settles an ordinary old-server autosave through full content before allowing Ready", async () => {
    actions.updatePlan.mockResolvedValue({
      plan: { ...plan.summary, revision: 2 },
      attachments: [],
    });
    await renderPage();
    await click("Edit plan");
    const body = await editTextarea("Plan", "Older server saved this body");
    await act(async () => vi.advanceTimersByTimeAsync(2400));
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    expect(body.disabled).toBe(false);
    expect(body.value).toBe("Older server saved this body");
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    currentPlan = {
      ...plan,
      summary: { ...plan.summary, revision: 2 },
      body: "Older server saved this body",
    };
    await renderPage();
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenCalledTimes(2);
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      reviewStatus: "ready",
    });
    expect(reviewLabel()).toBe("Draft");
  });

  it("shows Ready and Draft destinations in the plan's history", async () => {
    currentDetail = AsyncResult.success({
      ...detail,
      activity: [
        {
          id: 1,
          ticketId: plan.summary.ticketId,
          actor: { type: "user" },
          createdAt: plan.summary.updatedAt,
          entry: {
            type: "plan_review_status_changed",
            planId: plan.summary.planId,
            number: 1,
            from: "draft",
            to: "ready",
          },
        },
        {
          id: 2,
          ticketId: plan.summary.ticketId,
          actor: { type: "user" },
          createdAt: plan.summary.updatedAt,
          entry: {
            type: "plan_review_status_changed",
            planId: plan.summary.planId,
            number: 1,
            from: "ready",
            to: "draft",
          },
        },
      ],
    });
    await renderPage();
    await click("History");
    const entries = [...container.querySelectorAll('[aria-label="Plan history"] li')].map(
      (item) => item.textContent,
    );
    expect(entries[0]).toContain("You marked the plan Draft");
    expect(entries[1]).toContain("You marked the plan Ready");
  });

  it("saves an outstanding title and body before Ready and waits for the subscribed status", async () => {
    const titleReply = deferredPlanWrite();
    const bodyReply = deferredPlanWrite();
    const readyReply = deferredPlanWrite();
    actions.updatePlan
      .mockReturnValueOnce(titleReply.promise)
      .mockReturnValueOnce(bodyReply.promise)
      .mockReturnValueOnce(readyReply.promise);
    await renderPage();
    await editTitle("Reviewed title");
    await click("Edit plan");
    const body = await editTextarea("Plan", "Reviewed body");
    await click("Mark Ready");
    await click("Mark Ready");
    expect(body.disabled).toBe(true);
    expect(titleEditor().disabled).toBe(true);
    expect(reviewLabel()).toBe("Draft");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    await act(async () =>
      titleReply.resolve({
        plan: { ...plan.summary, title: "Reviewed title", revision: 2 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      }),
    );
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      body: "Reviewed body",
    });
    await act(async () =>
      bodyReply.resolve({
        plan: { ...plan.summary, title: "Reviewed title", revision: 3 },
        contentCommit: { observedRevision: 2, revision: 3 },
        attachments: [],
      }),
    );
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 3,
      reviewStatus: "ready",
    });
    expect(reviewLabel()).toBe("Draft");
    await act(async () =>
      readyReply.resolve({
        plan: { ...plan.summary, title: "Reviewed title", revision: 3, reviewStatus: "ready" },
        contentCommit: { observedRevision: 3, revision: 3 },
        attachments: [],
      }),
    );
    expect(reviewLabel()).toBe("Draft");
    expect(body.disabled).toBe(false);
    currentPlan = {
      ...plan,
      body: "Reviewed body",
      summary: { ...plan.summary, title: "Reviewed title", revision: 3, reviewStatus: "ready" },
    };
    await renderPage();
    expect(reviewLabel()).toBe("Ready");
  });

  it.each([null, "conflict"] as const)(
    "retains failed body drafts and aborts Ready after %s",
    async (failure) => {
      const bodyReply = deferredPlanWrite();
      actions.updatePlan.mockReturnValue(bodyReply.promise);
      await renderPage();
      await click("Edit plan");
      const body = await editTextarea("Plan", "Retain reviewed body");
      await click("Mark Ready");
      await click("Options for T-1/P1");
      await click("Delete");
      expect(actions.confirmDeletePlan).not.toHaveBeenCalled();
      await act(async () => bodyReply.resolve(failure));
      expect(body.disabled).toBe(false);
      expect(body.value).toBe("Retain reviewed body");
      expect(reviewLabel()).toBe("Draft");
      expect(actions.updatePlan).toHaveBeenCalledTimes(1);
      if (failure === "conflict")
        expect(container.textContent).toContain("Someone else changed the plan");
    },
  );

  it("retains a title draft and cancels Ready when its receipt includes a superseding edit", async () => {
    const titleReply = deferredPlanWrite();
    actions.updatePlan.mockReturnValue(titleReply.promise);
    await renderPage();
    await editTextarea("Plan title", "Reviewed title");
    await click("Mark Ready");
    await act(async () =>
      titleReply.resolve({
        plan: { ...plan.summary, title: "Other writer's title", revision: 3 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      }),
    );
    expect(titleEditor().value).toBe("Reviewed title");
    expect(titleEditor().disabled).toBe(false);
    expect(reviewLabel()).toBe("Draft");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
  });

  it("protects title blur from a stale matching-title no-op with an unreviewed remote body", async () => {
    const titleReply = deferredPlanWrite();
    actions.updatePlan.mockReturnValue(titleReply.promise);
    await renderPage();
    await editTitle("Reviewed title");
    expect(actions.updatePlan).toHaveBeenCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      title: "Reviewed title",
    });
    await click("Mark Ready");
    currentPlan = {
      ...plan,
      body: "Unreviewed remote body",
      summary: { ...plan.summary, title: "Reviewed title", revision: 2 },
    };
    await renderPage();
    await act(async () =>
      titleReply.resolve({
        plan: currentPlan.summary,
        contentCommit: { observedRevision: 2, revision: 2 },
        attachments: [],
      }),
    );
    expect(titleEditor().value).toBe("Reviewed title");
    expect(titleEditor().disabled).toBe(false);
    expect(container.textContent).toContain("Unreviewed remote body");
    expect(reviewLabel()).toBe("Draft");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
  });

  it.each(["before", "after"])(
    "cancels a matching-body no-op with an unreviewed remote title when the stream arrives %s the receipt",
    async (streamOrder) => {
      const bodyReply = deferredPlanWrite();
      actions.updatePlan.mockReturnValue(bodyReply.promise);
      await renderPage();
      await click("Edit plan");
      const body = await editTextarea("Plan", "Reviewed body");
      await click("Mark Ready");
      currentPlan = {
        ...plan,
        body: "Reviewed body",
        summary: { ...plan.summary, title: "Unreviewed remote title", revision: 2 },
      };
      if (streamOrder === "before") await renderPage();
      await act(async () =>
        bodyReply.resolve({
          plan: currentPlan.summary,
          contentCommit: { observedRevision: 2, revision: 2 },
          attachments: [],
        }),
      );
      if (streamOrder === "after") await renderPage();
      expect(body.value).toBe("Reviewed body");
      expect(body.disabled).toBe(false);
      expect(titleEditor().value).toBe("Unreviewed remote title");
      expect(reviewLabel()).toBe("Draft");
      expect(actions.updatePlan).toHaveBeenCalledTimes(1);
      expect(actions.updatePlan).toHaveBeenCalledWith("environment-1", {
        planId: "plan-1",
        expectedRevision: 1,
        body: "Reviewed body",
      });
    },
  );

  it("cancels Ready when remote content is adopted before the title flush completes", async () => {
    const titleReply = deferredPlanWrite();
    actions.updatePlan.mockReturnValue(titleReply.promise);
    await renderPage();
    await editTitle("Reviewed title");
    await click("Mark Ready");
    currentPlan = {
      ...plan,
      body: "New remote content",
      summary: { ...plan.summary, title: "Remote title", revision: 3 },
    };
    await renderPage();
    await act(async () =>
      titleReply.resolve({
        plan: { ...plan.summary, title: "Reviewed title", revision: 2 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      }),
    );
    expect(container.textContent).toContain("New remote content");
    expect(titleEditor().value).toBe("Reviewed title");
    expect(reviewLabel()).toBe("Draft");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
  });

  it("settles a previously started autosave without deadlock before marking its content Ready", async () => {
    const bodyReply = deferredPlanWrite();
    actions.updatePlan.mockReturnValueOnce(bodyReply.promise).mockResolvedValue({
      plan: { ...plan.summary, revision: 2, reviewStatus: "ready" },
      contentCommit: { observedRevision: 2, revision: 2 },
      attachments: [],
    });
    await renderPage();
    await click("Edit plan");
    const body = await editTextarea("Plan", "Autosaved reviewed body");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await click("Mark Ready");
    currentPlan = {
      ...plan,
      body: "Autosaved reviewed body",
      summary: { ...plan.summary, revision: 2 },
    };
    await renderPage();
    await act(async () =>
      bodyReply.resolve({
        plan: currentPlan.summary,
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      }),
    );
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      reviewStatus: "ready",
    });
    expect(body.disabled).toBe(false);
    expect(body.value).toBe("Autosaved reviewed body");
  });

  it("returns Ready to Draft without flushing a dirty body and ignores an equal-revision delayed reply", async () => {
    const draftReply = deferredPlanWrite();
    currentPlan = { ...plan, summary: { ...plan.summary, reviewStatus: "ready" } };
    actions.updatePlan.mockReturnValue(draftReply.promise);
    await renderPage();
    await click("Edit plan");
    const body = await editTextarea("Plan", "Unflushed local draft");
    await click("Return to Draft");
    expect(actions.updatePlan).toHaveBeenCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      reviewStatus: "draft",
    });
    currentPlan = { ...plan, summary: { ...plan.summary, reviewStatus: "draft" } };
    await renderPage();
    expect(reviewLabel()).toBe("Draft");
    currentPlan = { ...plan, summary: { ...plan.summary, reviewStatus: "ready" } };
    await renderPage();
    await act(async () =>
      draftReply.resolve({
        plan: { ...plan.summary, reviewStatus: "draft" },
        attachments: [],
      }),
    );
    expect(reviewLabel()).toBe("Ready");
    expect(body.value).toBe("Unflushed local draft");
    expect(body.disabled).toBe(false);
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
  });

  it("changes archived review metadata both ways while the document stays read-only", async () => {
    currentPlan = { ...plan, summary: { ...plan.summary, status: "archived" } };
    actions.updatePlan.mockResolvedValue({ plan: currentPlan.summary, attachments: [] });
    await renderPage();
    expect(container.textContent).toContain("This plan is archived");
    expect(container.querySelector('[aria-label="Plan title"]')).toBeNull();
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      reviewStatus: "ready",
    });
    expect(reviewLabel()).toBe("Draft");
    currentPlan = {
      ...plan,
      summary: { ...plan.summary, status: "archived", reviewStatus: "ready" },
    };
    await renderPage();
    expect(reviewLabel()).toBe("Ready");
    await click("Return to Draft");
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      reviewStatus: "draft",
    });
    expect(container.querySelector('textarea[aria-label="Plan"]')).toBeNull();
    expect(container.textContent).toContain("Saved body");
    expect(actions.updatePlan).toHaveBeenCalledTimes(2);
  });

  it("adopts a newer body stream after Draft withdrawal returned its summary first", async () => {
    currentPlan = { ...plan, summary: { ...plan.summary, reviewStatus: "ready" } };
    actions.updatePlan.mockResolvedValue({
      plan: { ...plan.summary, reviewStatus: "draft", revision: 2 },
      contentCommit: { observedRevision: 1, revision: 1 },
      attachments: [],
    });
    await renderPage();
    await click("Return to Draft");
    expect(reviewLabel()).toBe("Ready");
    currentPlan = {
      ...plan,
      body: "New content from another client",
      summary: { ...plan.summary, reviewStatus: "draft", revision: 2 },
    };
    await renderPage();
    expect(reviewLabel()).toBe("Draft");
    expect(container.textContent).toContain("New content from another client");
  });

  it("uses subscribed archive state after a delayed active reply when marking Ready", async () => {
    const draftReply = deferredPlanWrite();
    currentPlan = { ...plan, summary: { ...plan.summary, reviewStatus: "ready" } };
    actions.updatePlan.mockReturnValueOnce(draftReply.promise).mockResolvedValue({
      plan: { ...plan.summary, status: "archived", reviewStatus: "ready" },
      attachments: [],
    });
    await renderPage();
    await click("Edit plan");
    await editTextarea("Plan", "Retained draft for restoration");
    await click("Return to Draft");
    currentPlan = {
      ...plan,
      summary: { ...plan.summary, status: "archived", reviewStatus: "draft" },
    };
    await renderPage();
    await act(async () =>
      draftReply.resolve({
        plan: { ...plan.summary, status: "active", reviewStatus: "draft" },
        attachments: [],
      }),
    );
    expect(container.textContent).toContain("This plan is archived");
    expect(container.querySelector('textarea[aria-label="Plan"]')).toBeNull();
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 1,
      reviewStatus: "ready",
    });
    expect(actions.updatePlan).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Saved body");
    expect(container.textContent).not.toContain("Retained draft for restoration");
    expect(container.querySelector('[aria-label="Plan title"]')).toBeNull();
  });

  it("marks loaded archived content Ready at its revision and retains a failed draft for restoration", async () => {
    actions.updatePlan
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        plan: { ...plan.summary, status: "archived", reviewStatus: "ready", revision: 2 },
        contentCommit: { observedRevision: 2, revision: 2 },
        attachments: [],
      })
      .mockResolvedValueOnce({
        plan: { ...plan.summary, status: "active", reviewStatus: "ready", revision: 2 },
        contentCommit: { observedRevision: 2, revision: 2 },
        attachments: [],
      })
      .mockResolvedValue("conflict");
    await renderPage();
    await click("Edit plan");
    await editTextarea("Plan", "Failed local draft to keep");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    currentPlan = {
      ...plan,
      body: "Persisted remote body",
      summary: { ...plan.summary, status: "archived", revision: 2 },
    };
    await renderPage();
    expect(container.textContent).toContain("Persisted remote body");
    expect(container.textContent).not.toContain("Failed local draft to keep");
    await click("Mark Ready");
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      reviewStatus: "ready",
    });
    expect(actions.updatePlan).toHaveBeenCalledTimes(2);
    currentPlan = { ...currentPlan, summary: { ...currentPlan.summary, reviewStatus: "ready" } };
    await renderPage();
    await click("Restore");
    currentPlan = { ...currentPlan, summary: { ...currentPlan.summary, status: "active" } };
    await renderPage();
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan"]')?.value).toBe(
      "Failed local draft to keep",
    );
    expect(container.textContent).toContain("Someone else changed the plan");
    expect(reviewLabel()).toBe("Ready");
  });

  it("keeps subscribed Ready while editing the title and body", async () => {
    currentPlan = { ...plan, summary: { ...plan.summary, reviewStatus: "ready" } };
    actions.updatePlan
      .mockResolvedValueOnce({
        plan: { ...currentPlan.summary, title: "Revised title", revision: 2 },
        contentCommit: { observedRevision: 1, revision: 2 },
        attachments: [],
      })
      .mockResolvedValue({
        plan: { ...currentPlan.summary, title: "Revised title", revision: 3 },
        contentCommit: { observedRevision: 2, revision: 3 },
        attachments: [],
      });
    await renderPage();
    await editTitle("Revised title");
    await click("Edit plan");
    const body = await editTextarea("Plan", "Revised body");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(reviewLabel()).toBe("Ready");
    expect(body.value).toBe("Revised body");
    expect(actions.updatePlan).toHaveBeenLastCalledWith("environment-1", {
      planId: "plan-1",
      expectedRevision: 2,
      body: "Revised body",
    });
  });
});

describe("TicketPlanPage delete", () => {
  it("drops an unsaved draft instead of saving it to the deleted plan", async () => {
    let completeDelete = (_deleted: boolean) => {};
    actions.confirmDeletePlan.mockResolvedValue(true);
    actions.deletePlan.mockReturnValue(
      new Promise((complete) => {
        completeDelete = complete;
      }),
    );
    await renderPage();
    await click("Edit plan");
    await editTextarea("Plan", "Unsaved body");
    await click("Options for T-1/P1");
    await click("Delete");
    expect(actions.deletePlan).toHaveBeenCalledWith("environment-1", "plan-1");
    currentTicket = { ...detail.summary, plans: [] };
    await renderPage();
    expect(container.textContent).toContain("This plan does not exist.");
    await act(async () => completeDelete(true));
    await act(async () => vi.runAllTimersAsync());
    expect(actions.updatePlan).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({
      to: "/tickets/$ticketKey",
      params: { ticketKey: "environment-1:ticket-1" },
    });
  });

  it("keeps the draft when the delete is not confirmed", async () => {
    actions.confirmDeletePlan.mockResolvedValue(false);
    await renderPage();
    await click("Edit plan");
    const textarea = await editTextarea("Plan", "Unsaved body");
    await click("Options for T-1/P1");
    await click("Delete");
    expect(actions.deletePlan).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Unsaved body");
  });
});

describe("TicketPlanPage comments", () => {
  it("unfocuses the focused thread on Escape", async () => {
    currentPlan = {
      ...plan,
      comments: [
        {
          id: TicketPlanCommentId.make("comment-1"),
          parentId: null,
          anchor: null,
          body: "On the whole plan",
          author: { type: "user" },
          createdAt: "2026-10-01T10:00:00.000Z",
          resolvedAt: null,
          resolvedBy: null,
        },
      ],
    };
    await renderPage();
    const item = container.querySelector<HTMLElement>('[aria-label="Comments"] > li');
    await act(async () => item!.click());
    expect(item!.getAttribute("aria-current")).toBe("true");
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(item!.hasAttribute("aria-current")).toBe(false);
  });

  it("locks the posting comment and preserves a newer anchor selected before its reply lands", async () => {
    let completeComment = (_result: Awaited<ReturnType<typeof actions.addPlanComment>>) => {};
    const commentReply = new Promise<Awaited<ReturnType<typeof actions.addPlanComment>>>(
      (complete) => {
        completeComment = complete;
      },
    );
    actions.addPlanComment.mockReturnValue(commentReply);
    await renderPage();
    await click("Selection A");
    const textarea = await editTextarea("Comment on the selection", "First comment");
    await act(async () => {
      textarea.focus();
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });
    expect(textarea.readOnly).toBe(true);
    expect(textarea.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel",
    );
    expect(cancel?.disabled).toBe(true);
    await click("Selection B");
    await act(async () =>
      completeComment({
        id: TicketPlanCommentId.make("comment-1"),
        parentId: null,
        anchor: { source: "Selection A", revision: 1 },
        body: "First comment",
        author: { type: "user" },
        createdAt: "2026-10-01T10:00:00.000Z",
        resolvedAt: null,
        resolvedBy: null,
      }),
    );
    expect(textarea.readOnly).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe("");
    expect(container.querySelector("pre")?.textContent).toBe("Selection B");
    expect(textarea.getAttribute("aria-label")).toBe("Comment on the selection");
    expect(actions.addPlanComment).toHaveBeenCalledWith("environment-1", {
      planId: "plan-1",
      body: "First comment",
      anchor: { source: "Selection A", revision: 1 },
    });
  });
});

describe("TicketPlanPage read aloud", () => {
  it("reads the current unsaved plan without its comments or metadata", async () => {
    await renderPage();
    await click("Edit plan");
    await editTextarea("Plan", "# Draft plan\nImplement **the change**.");
    await click("Read aloud");
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "environment-1",
      input: { text: "Draft plan\nImplement the change." },
    });
    expect(container.querySelector('button[aria-label="Pause reading"]')).not.toBeNull();
  });

  it("reads the archived plan body", async () => {
    currentPlan = {
      ...plan,
      summary: { ...plan.summary, status: "archived" },
      body: "Archived implementation.",
    };
    await renderPage();
    await click("Read aloud");
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "environment-1",
      input: { text: "Archived implementation." },
    });
  });
});
