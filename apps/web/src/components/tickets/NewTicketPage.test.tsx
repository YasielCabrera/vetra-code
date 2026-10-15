// @vitest-environment jsdom

import type { TicketBoardState } from "@t3tools/client-runtime/state/tickets";
import {
  EnvironmentId,
  TicketId,
  TicketStatusId,
  type TicketWriteResult,
} from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NewTicketPage } from "./NewTicketPage";
import { ticketDrafts } from "../../ticketDraftStore";
import type { useTicketActions } from "../../hooks/useTicketActions";
import type TicketBodyEditor from "./TicketBodyEditor";
import type { NewTicketSearch } from "./ticketDraft.logic";

const primary = EnvironmentId.make("primary");
const remote = EnvironmentId.make("remote");
let board: TicketBoardState;
let environmentsReady = true;
let environments: Array<{
  environmentId: EnvironmentId;
  entry: { enabled: boolean };
  connection: { phase: "connected" | "offline" };
  serverConfig: { environment: { capabilities: { tickets: boolean } } } | null;
}> = [];

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => ({ create }) }));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  verifyStashedAttachmentUpload: () => verification(),
  releasePersistedAttachmentUpload: vi.fn(),
}));
vi.mock("../../state/tickets", () => ({ useTickets: () => board }));
vi.mock("../../state/entities", () => ({ useProjects: () => [], useThreadShells: () => [] }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments, isReady: environmentsReady }),
  usePrimaryEnvironmentId: () => primary,
}));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  const actual = await vi.importActual<typeof import("../../lib/utils")>("../../lib/utils");
  return { ...actual, cn: cx };
});
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("./TicketBodyEditor", () => ({
  default: ({ value, onChange, disabled }: Parameters<typeof TicketBodyEditor>[0]) => (
    <textarea
      aria-label="Description"
      value={value}
      readOnly={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

const navigate = vi.fn();
const create = vi.fn<ReturnType<typeof useTicketActions>["create"]>();
const verification = vi.fn<() => Promise<{ status: "verified" | "missing" }>>();
const created = {
  ticket: {
    id: TicketId.make("created"),
    number: 1,
    homeProjectId: null,
    kind: "local",
    title: "Filed",
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
  attachments: [],
} satisfies TicketWriteResult;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  environmentsReady = true;
  environments = [];
  window.localStorage.clear();
  ticketDrafts.store.setState({
    drafts: {},
    activeManual: null,
    activeManualByEnvironment: {},
    runtime: {},
  });
  create.mockReset().mockResolvedValue(null);
  verification.mockReset().mockResolvedValue({ status: "verified" });
  navigate.mockReset();
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

async function renderPage(prefill: NewTicketSearch) {
  await act(async () =>
    root.render(<NewTicketPage key={JSON.stringify(prefill)} prefill={prefill} />),
  );
}

async function editField(label: "Title" | "Description", value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  );
  if (!input) throw new Error(`Missing ${label}`);
  await act(async () => {
    const prototype =
      input instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}

const UNAVAILABLE = "The selected environment is unavailable.";

describe("NewTicketPage environment", () => {
  it.each([
    { support: null, phase: "connected", message: "Waiting for ticket environments" },
    { support: null, phase: "offline", message: "Ticket environments are not connected" },
    { support: false, phase: "connected", message: "Tickets need a newer server" },
  ] satisfies ReadonlyArray<{
    support: boolean | null;
    phase: "connected" | "offline";
    message: string;
  }>)("shows $message when there is no ticket destination", async ({ support, phase, message }) => {
    board = { tickets: [], loaded: true, environmentIds: [], statusSets: new Map() };
    environments = [
      {
        environmentId: remote,
        entry: { enabled: true },
        connection: { phase },
        serverConfig:
          support === null ? null : { environment: { capabilities: { tickets: support } } },
      },
    ];
    await renderPage({});
    expect(container.textContent).toContain(message);
  });

  it("waits for the board before calling a linked environment unavailable", async () => {
    board = { tickets: [], loaded: false, environmentIds: [primary], statusSets: new Map() };
    await renderPage({ env: remote });
    expect(container.textContent).not.toContain(UNAVAILABLE);
    board = { ...board, loaded: true };
    await renderPage({ env: remote });
    expect(container.textContent).toContain(UNAVAILABLE);
  });

  it("says nothing about availability when no environment was linked", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary], statusSets: new Map() };
    await renderPage({});
    expect(container.textContent).not.toContain(UNAVAILABLE);
  });
});

describe("NewTicketPage drafts", () => {
  it("restores the board New ticket destination hint for the selected environment", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary, remote], statusSets: new Map() };
    await renderPage({ env: remote, title: "Write it myself capture" });
    await editField("Title", "My remote draft");
    await act(async () => root.render(null));
    await renderPage({ env: primary });
    await editField("Title", "My local draft");
    await renderPage({ env: remote });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe(
      "My remote draft",
    );
    await renderPage({ env: primary });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe(
      "My local draft",
    );
  });
  it("keeps a draft opened before environments load and leaves it empty after successful creation", async () => {
    board = { tickets: [], loaded: false, environmentIds: [], statusSets: new Map() };
    await renderPage({ title: "Captured while loading" });
    board = { ...board, loaded: true, environmentIds: [primary] };
    await renderPage({ title: "Captured while loading" });
    await editField("Title", "Edited after connecting");
    create.mockResolvedValueOnce(created);
    await clickButton("Create ticket");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("");
    expect(create).toHaveBeenCalledWith(primary, {
      title: "Edited after connecting",
      body: "",
      labels: [],
    });
  });
  it("restores an edited title after leaving and reopening the new-ticket shortcut", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary], statusSets: new Map() };
    await renderPage({ env: primary, title: "Captured title" });
    const title = container.querySelector<HTMLInputElement>('input[aria-label="Title"]');
    if (title === null) throw new Error("Missing title input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        title,
        "My edited ticket draft",
      );
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(title.value).toBe("My edited ticket draft");
    await act(async () => root.render(null));
    await renderPage({});
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe(
      "My edited ticket draft",
    );
  });

  it("restores an edited body on the empty shortcut and retains other captures independently", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary, remote], statusSets: new Map() };
    await renderPage({ env: remote, title: "Capture", body: "Captured description" });
    await editField("Description", "My long description");
    await renderPage({});
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Description"]')?.value).toBe(
      "My long description",
    );
    await clickButton("Create ticket");
    expect(create).toHaveBeenCalledWith(remote, {
      title: "Capture",
      body: "My long description",
      labels: [],
    });
    await renderPage({ env: primary, title: "Other capture" });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe(
      "Other capture",
    );
    await renderPage({ env: remote, title: "Capture", body: "Captured description" });
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Description"]')?.value).toBe(
      "My long description",
    );
    await clickButton("Discard draft");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("");
    await editField("Title", "Fresh draft");
    await renderPage({});
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe(
      "Fresh draft",
    );
  });

  it("preserves failed creation and clears a successfully submitted draft across concurrent mounts", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary], statusSets: new Map() };
    await renderPage({ title: "Draft" });
    await clickButton("Create ticket");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("Draft");
    let finish = (_result: TicketWriteResult | null) => {};
    create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await clickButton("Create ticket");
    await act(async () => root.render(null));
    await renderPage({});
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.readOnly).toBe(true);
    await act(async () => finish(created));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("");
    expect(navigate).not.toHaveBeenCalled();
    await editField("Title", "Next draft");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe(
      "Next draft",
    );
    expect(create).toHaveBeenCalledWith(primary, { title: "Draft", body: "", labels: [] });
  });

  it("warns before unloading a draft retained offscreen", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary], statusSets: new Map() };
    await renderPage({ title: "Retained" });
    await act(async () => root.render(null));
    const unload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("shows expired attachments as readable names and can create after deleting their references", async () => {
    board = { tickets: [], loaded: true, environmentIds: [primary], statusSets: new Map() };
    const prefill = { title: "Draft" };
    const key = ticketDrafts.openManual(prefill, primary)!;
    const entry = ticketDrafts.store.getState().drafts[key]!;
    if (entry.value.kind !== "manual") throw new Error("Missing draft");
    ticketDrafts.edit(key, {
      ...entry.value,
      body: "![shot](vetra-attachment://pending-shot)",
      uploads: [
        {
          localId: "queue-key",
          attachment: {
            type: "image",
            id: "pending-shot",
            name: "shot.png",
            mimeType: "image/png",
            sizeBytes: 4,
          },
        },
      ],
    });
    verification.mockResolvedValue({ status: "missing" });
    await renderPage(prefill);
    expect(container.textContent).toContain(
      "shot.png: This upload expired. Remove it and attach the file again.",
    );
    await editField("Description", "Text-only ticket");
    await clickButton("Create ticket");
    expect(create).toHaveBeenCalledWith(primary, {
      title: "Draft",
      body: "Text-only ticket",
      labels: [],
    });
  });
});
