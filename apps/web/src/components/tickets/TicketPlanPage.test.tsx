// @vitest-environment jsdom

import {
  TicketId,
  TicketPlanCommentId,
  TicketPlanId,
  TicketStatusId,
  type TicketDetail,
  type TicketPlan,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  PLAN_ENTRY_VERBS: {},
}));
vi.mock("./TicketStartThreadMenu", () => ({ TicketStartThreadMenu: () => null }));
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
      completeBody({ plan: { ...plan.summary, revision: 3 }, attachments: [] }),
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
    actions.updatePlan
      .mockReturnValueOnce(titleReply)
      .mockResolvedValue({ plan: { ...plan.summary, revision: 3 }, attachments: [] });
    await renderPage();
    await editTitle("Temporary title");
    await editTitle("Saved title");
    expect(actions.updatePlan).toHaveBeenCalledTimes(1);
    await act(async () =>
      completeTitle({
        plan: { ...plan.summary, title: "Temporary title", revision: 2 },
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
      .mockResolvedValue({ plan: { ...plan.summary, revision: 2 }, attachments: [] });
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
