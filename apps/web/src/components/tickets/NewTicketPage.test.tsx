// @vitest-environment jsdom

import type { TicketBoardState } from "@t3tools/client-runtime/state/tickets";
import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NewTicketPage } from "./NewTicketPage";

const primary = EnvironmentId.make("primary");
const remote = EnvironmentId.make("remote");
let board: TicketBoardState;

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../hooks/useTicketActions", () => ({ useTicketActions: () => ({}) }));
vi.mock("../../state/tickets", () => ({ useTickets: () => board }));
vi.mock("../../state/entities", () => ({ useProjects: () => [], useThreadShells: () => [] }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [] }),
  usePrimaryEnvironmentId: () => primary,
}));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  return { cn: cx };
});
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("./TicketBodyEditor", () => ({ default: () => null }));

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

async function renderPage(prefill: { readonly env?: string }) {
  await act(async () => root.render(<NewTicketPage prefill={prefill} />));
}

const UNAVAILABLE = "The selected environment is unavailable.";

describe("NewTicketPage environment", () => {
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
