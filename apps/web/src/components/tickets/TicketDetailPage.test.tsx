// @vitest-environment jsdom

import { TicketId, TicketStatusId, type TicketDetail } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { useTicketActions } from "../../hooks/useTicketActions";
import type TicketBodyEditor from "./TicketBodyEditor";
import { TicketDetailPage } from "./TicketDetailPage";

vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => actions }));
vi.mock("../../state/tickets", () => ({
  useTicket: () => detail.summary,
  useTicketDetail: () => AsyncResult.success(detail),
  useTicketStatuses: () => null,
  useTicketGitHubSources: () => [],
}));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
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
vi.mock("./TicketGitHub", () => ({ useTicketIssueReads: () => ({ refresh: async () => {} }) }));
vi.mock("./TicketActivityTimeline", () => ({ TicketActivityTimeline: () => null }));
vi.mock("./TicketStartThreadMenu", () => ({ TicketStartThreadMenu: () => null }));
vi.mock("./TicketPropertiesPanel", () => ({
  TicketPropertiesPanel: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  TicketStatusSelect: () => null,
  TicketLabelsEditor: () => null,
}));
vi.mock("./TicketProjectsEditor", () => ({ TicketProjectsEditor: () => null }));
vi.mock("./TicketPlans", () => ({ TicketPlansSection: () => null }));
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
const actions = { update: vi.fn<ReturnType<typeof useTicketActions>["update"]>() };
const detail: TicketDetail = {
  summary: {
    id: TicketId.make("ticket-1"),
    number: 1,
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
    plans: [],
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
  actions.update.mockReset();
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

async function renderPage() {
  await act(async () => root.render(<TicketDetailPage ticketKey="environment-1:ticket-1" />));
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
  it("autosaves an edited description against the ticket's revision", async () => {
    actions.update.mockResolvedValue({
      ticket: { ...detail.summary, revision: 2 },
      attachments: [],
    });
    await renderPage();
    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit description"]',
    );
    await act(async () => editButton!.click());
    await edit("Description", "New description");
    expect(container.textContent).toContain("Unsaved changes");
    await act(async () => vi.advanceTimersByTimeAsync(800));
    expect(actions.update).toHaveBeenCalledWith(
      { environmentId: "environment-1", ticketId: "ticket-1" },
      { expectedRevision: 1, body: "New description" },
    );
    expect(container.textContent).not.toContain("Unsaved changes");
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
