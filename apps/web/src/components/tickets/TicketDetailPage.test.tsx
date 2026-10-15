// @vitest-environment jsdom

import {
  TicketId,
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
import { useSpeechPlayback } from "../../readAloud";
import type TicketBodyEditor from "./TicketBodyEditor";
import { TicketDetailPage } from "./TicketDetailPage";
import { ticketDrafts } from "../../ticketDraftStore";

vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => actions }));
vi.mock("../../state/tickets", () => ({
  useTicket: () => detail.summary,
  useTicketDetail: () => currentDetail,
  useTicketEnvironmentState: () => currentEnvironmentState,
  useTicketStatuses: () => null,
  useTicketGitHubWriteAllowed: () => true,
  useTicketGitHubSources: () => [],
  useTicketPlan: () => AsyncResult.success(plan),
}));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  const actual = await vi.importActual<typeof import("../../lib/utils")>("../../lib/utils");
  return { ...actual, cn: cx };
});
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../hooks/useViewportWidth", () => ({ useViewportWidth: () => viewportWidth }));
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
vi.mock("./TicketGitHub", () => ({ useTicketIssueReads: () => ({ refresh: async () => {} }) }));
vi.mock("./TicketActivityTimeline", () => ({ TicketActivityTimeline: () => null }));
vi.mock("./TicketStartThreadMenu", () => ({
  TicketStartThreadMenu: () => null,
  TicketStartThreadSubmenu: () => null,
}));
vi.mock("./TicketPropertiesPanel", () => ({
  TicketPropertiesPanel: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  TicketStatusSelect: () => null,
  TicketLabelsEditor: () => null,
}));
vi.mock("./TicketProjectsEditor", () => ({ TicketProjectsEditor: () => null }));
vi.mock("./TicketLinkPreview", () => ({ TicketLinkPreview: () => null }));
vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("./TicketBodyEditor", () => ({
  default: ({ value, onChange, ariaLabel }: Parameters<typeof TicketBodyEditor>[0]) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

const navigate = vi.fn();
const actions = {
  update: vi.fn<ReturnType<typeof useTicketActions>["update"]>(),
  comment: vi.fn<ReturnType<typeof useTicketActions>["comment"]>(),
};
let viewportWidth = 800;
let currentEnvironmentState = "supported";
let currentDetail: AsyncResult.AsyncResult<TicketDetail, unknown>;
const plan: TicketPlan = {
  summary: {
    planId: TicketPlanId.make("plan-1"),
    ticketId: TicketId.make("ticket-1"),
    ref: "T-1/P1",
    number: 1,
    title: "Rollout",
    status: "active",
    reviewStatus: "draft",
    revision: 1,
    openCommentCount: 0,
    createdBy: { type: "user" },
    updatedBy: { type: "user" },
    updatedAt: "2026-10-01T10:00:00.000Z",
  },
  body: "Full plan body.",
  comments: [],
  attachments: [],
};
const detail: TicketDetail = {
  summary: {
    id: TicketId.make("ticket-1"),
    number: 1,
    homeProjectId: null,
    kind: "local",
    title: "Saved title",
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
  body: "Saved body",
  links: [],
  attachments: [],
  activity: [],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setupSpeechTest();
  viewportWidth = 800;
  currentEnvironmentState = "supported";
  currentDetail = AsyncResult.success(detail);
  actions.update.mockReset();
  actions.comment.mockReset().mockResolvedValue(null);
  ticketDrafts.store.setState({
    drafts: {},
    activeManual: null,
    activeManualByEnvironment: {},
    runtime: {},
  });
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

function Playback() {
  const playback = useSpeechPlayback();
  return <output>{playback === null ? "idle" : `${playback.key} ${playback.phase}`}</output>;
}

async function renderPage(ticketKey = "environment-1:ticket-1") {
  await act(async () =>
    root.render(
      <>
        <TicketDetailPage key={ticketKey} ticketKey={ticketKey} />
        <Playback />
      </>,
    ),
  );
}

async function click(label: string, index = 0) {
  const button = container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[
    index
  ];
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}

async function edit(label: string, value: string, blur = false) {
  const textarea = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  if (!textarea) throw new Error(`Missing textarea: ${label}`);
  await act(async () => {
    textarea.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    if (blur) textarea.blur();
  });
}

describe("TicketDetailPage", () => {
  it.each(["unknown", "disconnected"])(
    "explains the %s environment instead of loading forever",
    async (state) => {
      currentEnvironmentState = state;
      currentDetail = AsyncResult.initial(false);
      await renderPage();
      expect(container.textContent).toContain("This environment is unknown or not connected.");
      expect(container.textContent).not.toContain("Loading ticket");
    },
  );

  it("waits for config before recommending a server update", async () => {
    currentEnvironmentState = "pending";
    currentDetail = AsyncResult.initial(false);
    await renderPage();
    expect(container.textContent).toContain("Loading ticket…");
    expect(container.textContent).not.toContain("Tickets need a newer server");
  });

  it("recommends an update for a confirmed unsupported server", async () => {
    currentEnvironmentState = "unsupported";
    currentDetail = AsyncResult.initial(false);
    await renderPage();
    expect(container.textContent).toContain("Tickets need a newer server");
  });

  it("recovers after reconnecting without remounting the page", async () => {
    currentEnvironmentState = "disconnected";
    currentDetail = AsyncResult.initial(false);
    await renderPage();
    expect(container.textContent).toContain("This environment is unknown or not connected.");
    currentEnvironmentState = "supported";
    currentDetail = AsyncResult.success(detail);
    await renderPage();
    expect(container.textContent).toContain("Saved body");
  });

  it("keeps a loaded ticket visible while disconnected", async () => {
    currentEnvironmentState = "disconnected";
    await renderPage();
    expect(container.textContent).toContain("Saved body");
  });

  it("restores a comment after leaving and keeps the same ticket ID isolated across environments", async () => {
    await renderPage();
    await edit("Comment", "Local comment draft");
    await act(async () => root.render(null));
    await renderPage("environment-2:ticket-1");
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value,
    ).toBe("");
    await edit("Comment", "Remote comment draft");
    await renderPage();
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value,
    ).toBe("Local comment draft");
    await renderPage("environment-2:ticket-1");
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value,
    ).toBe("Remote comment draft");
  });

  it("retains a failed comment and clears it only after successful posting", async () => {
    await renderPage();
    await edit("Comment", "Please investigate this");
    const post = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Comment",
      );
    await act(async () => post()!.click());
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value,
    ).toBe("Please investigate this");
    actions.comment.mockResolvedValueOnce(detail.summary);
    await act(async () => post()!.click());
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value,
    ).toBe("");
    await edit("Comment", "Next comment");
    await act(async () => root.render(null));
    await renderPage();
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.value,
    ).toBe("Next comment");
    expect(actions.comment).toHaveBeenCalledWith(
      { environmentId: "environment-1", ticketId: "ticket-1" },
      "Please investigate this",
    );
  });
  it("autosaves an edited description against the ticket's revision", async () => {
    actions.update.mockResolvedValue({
      ticket: { ...detail.summary, revision: 2 },
      attachments: [],
    });
    await renderPage();
    const optionsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Options for T-1"]',
    );
    await act(async () => optionsButton!.click());
    const editItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Edit description",
    );
    await act(async () => editItem!.click());
    await edit("Description", "New description");
    expect(container.textContent).toContain("Unsaved changes");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(actions.update).toHaveBeenCalledWith(
      { environmentId: "environment-1", ticketId: "ticket-1" },
      { expectedRevision: 1, body: "New description" },
    );
    expect(container.textContent).not.toContain("Unsaved changes");
  });

  it("reads the unsaved description through the ticket environment", async () => {
    await renderPage();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Options for T-1"]')!.click(),
    );
    const editItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Edit description",
    );
    await act(async () => editItem!.click());
    await edit("Description", "# Latest draft\nRead this **body**.");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Read aloud"]')!.click(),
    );
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "environment-1",
      input: { text: "Latest draft\nRead this body." },
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://environment-1.example/audio/test.pcm",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.querySelector('button[aria-label="Pause reading"]')).not.toBeNull();
  });

  it("keeps a plan preview reading across the side-panel breakpoint until it is left", async () => {
    await renderPage();
    await click("Preview T-1/P1, Rollout");
    await click("Read aloud", 1);
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "environment-1",
      input: { text: "Full plan body." },
    });
    expect(container.querySelector("output")?.textContent).toBe(
      "plan:environment-1:plan-1 playing",
    );
    viewportWidth = 1280;
    await renderPage();
    expect(container.querySelector('aside button[aria-label="Pause reading"]')).not.toBeNull();
    viewportWidth = 800;
    await renderPage();
    expect(container.querySelector("output")?.textContent).toBe(
      "plan:environment-1:plan-1 playing",
    );
    await click("Back to properties");
    expect(container.querySelector("output")?.textContent).toBe("idle");

    await click("Preview T-1/P1, Rollout");
    await click("Read aloud", 1);
    expect(container.querySelector("output")?.textContent).toBe(
      "plan:environment-1:plan-1 playing",
    );
    await act(async () => root.render(<Playback />));
    expect(container.querySelector("output")?.textContent).toBe("idle");
  });

  it("saves an edited title", async () => {
    actions.update.mockResolvedValue({
      ticket: { ...detail.summary, title: "New title", revision: 2 },
      attachments: [],
    });
    await renderPage();
    await edit("Title", "New title", true);
    expect(actions.update).toHaveBeenCalledWith(
      { environmentId: "environment-1", ticketId: "ticket-1" },
      { expectedRevision: 1, title: "New title" },
    );
  });
});
