// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TicketId, TicketStatusId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { ThreadTicketWorkspace } from "../tickets/ThreadTicketWorkspace";
import { ProposedPlanCard } from "./ProposedPlanCard";

const state = vi.hoisted(() => ({ createPlan: vi.fn(), toastAction: null as (() => void) | null }));

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { writeFile: {} } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => false,
  readEnvironmentScope: () => false,
}));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn(), isCopied: false }),
}));
vi.mock("../../hooks/useTicketActions", () => ({
  useTicketActions: () => ({ createPlan: state.createPlan }),
}));
vi.mock("../../state/tickets", () => ({ useTicketsForThread: () => [ticket] }));
vi.mock("./markdownFindContext", () => ({ useFindRevealRef: () => undefined }));
vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuTrigger: () => null,
  MenuPopup: ({ children }: { children: ReactNode }) => children,
  MenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  MenuSub: ({ children }: { children: ReactNode }) => children,
  MenuSubTrigger: () => null,
  MenuSubPopup: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: {
    add: (input: { actionProps?: { onClick: () => void } }) => {
      state.toastAction = input.actionProps?.onClick ?? null;
    },
  },
}));

const owner = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("origin-thread"));
const ticket = {
  environmentId: EnvironmentId.make("remote"),
  id: TicketId.make("ticket-1"),
  number: 1,
  kind: "local" as const,
  title: "Ticket",
  labels: [],
  statusId: TicketStatusId.make("open"),
  sortKey: "a",
  revision: 1,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  createdBy: { type: "user" as const },
  linkRefs: [],
  attachmentCount: 0,
  plans: [],
};

it.each([true, false])(
  "reveals a saved plan after leaving, using the explicit owner when present (%s)",
  async (explicitOwner) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    state.toastAction = null;
    state.createPlan.mockResolvedValue({ plan: { number: 2, ref: "T-1/P2", title: "Saved plan" } });
    useRightPanelStore.setState({
      byThreadKey: {},
      threadPanelVisibilityByThreadKey: {},
      userActionRevisionByThreadKey: {},
      closeRevisionByThreadKey: {},
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      const route = createRootRoute();
      const thread = createRoute({
        getParentRoute: () => route,
        path: "/$environmentId/$threadId",
        component: () => (
          <ThreadTicketWorkspace threadRef={owner}>
            <ProposedPlanCard
              planMarkdown={"# Saved plan\nImplementation body"}
              environmentId={owner.environmentId}
              threadRef={explicitOwner ? owner : undefined}
              cwd={undefined}
              workspaceRoot={undefined}
            />
          </ThreadTicketWorkspace>
        ),
      });
      const other = createRoute({
        getParentRoute: () => route,
        path: "/tickets",
        component: () => <p>Another page</p>,
      });
      const plan = createRoute({
        getParentRoute: () => route,
        path: "/tickets/$ticketKey/plans/$planNumber",
        component: () => <p>Dedicated plan</p>,
      });
      const router = createRouter({
        routeTree: route.addChildren([thread, other, plan]),
        history: createMemoryHistory({ initialEntries: ["/local/origin-thread"] }),
      });
      await router.load();
      await act(async () => root.render(<RouterProvider router={router} />));
      const save = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Save as plan on T-1",
      );
      if (save === undefined) throw new Error("Missing save-plan action");
      await act(async () => save.click());
      await act(async () => router.navigate({ to: "/tickets" }));
      expect(container.textContent).toBe("Another page");
      await act(async () => state.toastAction?.());
      if (explicitOwner) {
        expect(router.state.location.pathname).toBe("/local/origin-thread");
        expect(
          selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, owner),
        ).toMatchObject({
          isOpen: true,
          activeSurfaceId: "ticket-plan:remote%3Aticket-1:2",
          surfaces: [
            {
              kind: "ticket-plan",
              ticketRef: { environmentId: ticket.environmentId, ticketId: ticket.id },
              planNumber: 2,
            },
          ],
        });
      } else {
        expect(router.state.location.pathname).toBe("/tickets/remote%3Aticket-1/plans/2");
        expect(container.textContent).toBe("Dedicated plan");
        expect(
          selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, owner).surfaces,
        ).toEqual([]);
      }
      expect(state.createPlan.mock.calls).toEqual([
        [
          ticket.environmentId,
          { ticketId: ticket.id, title: "Saved plan", body: "Implementation body" },
        ],
      ]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  },
);
