// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TicketId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { TicketResourceLink, ThreadTicketWorkspace } from "./ThreadTicketWorkspace";

const owner = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread-1"));
const ticketRef = {
  environmentId: EnvironmentId.make("remote"),
  ticketId: TicketId.make("ticket-1"),
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderLinks(scoped: boolean) {
  const route = createRootRoute();
  const chat = createRoute({
    getParentRoute: () => route,
    path: "/chat",
    component: () => (
      <ThreadTicketWorkspace threadRef={scoped ? owner : null}>
        <TicketResourceLink target={{ kind: "ticket", ticketRef }}>Ticket</TicketResourceLink>
        <TicketResourceLink target={{ kind: "ticket-plan", ticketRef, planNumber: 2 }}>
          Plan
        </TicketResourceLink>
      </ThreadTicketWorkspace>
    ),
  });
  const ticket = createRoute({
    getParentRoute: () => route,
    path: "/tickets/$ticketKey",
    component: () => <div>Dedicated ticket</div>,
  });
  const plan = createRoute({
    getParentRoute: () => route,
    path: "/tickets/$ticketKey/plans/$planNumber",
    component: () => <div>Dedicated plan</div>,
  });
  const router = createRouter({
    routeTree: route.addChildren([chat, ticket, plan]),
    history: createMemoryHistory({ initialEntries: ["/chat"] }),
  });
  await router.load();
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}

function link(label: string) {
  const element = [...container.querySelectorAll("a")].find(
    (element) => element.textContent === label,
  );
  if (element === undefined) throw new Error(`Missing ${label} link`);
  return element;
}

describe("thread ticket links", () => {
  it("opens ticket and plan peer tabs while keeping the thread route and real page hrefs", async () => {
    const router = await renderLinks(true);
    expect(link("Ticket").getAttribute("href")).toBe("/tickets/remote%3Aticket-1");
    expect(link("Plan").getAttribute("href")).toBe("/tickets/remote%3Aticket-1/plans/2");
    await act(async () => {
      link("Ticket").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
      link("Plan").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(router.state.location.pathname).toBe("/chat");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, owner),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "ticket-plan:remote%3Aticket-1:2",
      surfaces: [
        { id: "ticket:remote%3Aticket-1", kind: "ticket", ticketRef },
        { id: "ticket-plan:remote%3Aticket-1:2", kind: "ticket-plan", ticketRef, planNumber: 2 },
      ],
    });
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("preserves native modified and middle link activation %j", async (input) => {
    await renderLinks(true);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...input });
    await act(async () => link("Plan").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, owner).surfaces,
    ).toEqual([]);
    await act(async () =>
      link("Plan").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, owner).activeSurfaceId,
    ).toBe("ticket-plan:remote%3Aticket-1:2");
  });

  it("uses dedicated routes outside a thread workspace", async () => {
    const router = await renderLinks(false);
    await act(async () =>
      link("Plan").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(router.state.location.pathname).toBe("/tickets/remote%3Aticket-1/plans/2");
    expect(container.textContent).toBe("Dedicated plan");
  });
});
