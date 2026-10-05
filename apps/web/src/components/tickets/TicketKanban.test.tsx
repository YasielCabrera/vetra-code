// @vitest-environment jsdom

import { type EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import {
  EnvironmentId,
  TicketId,
  TicketStatusId,
  type TicketStatusDefinition,
  type TicketStatusSet,
} from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TicketKanban } from "./TicketKanban";

vi.mock("../../hooks/useTicketActions", () => ({
  useTicketActions: () => ({ move: async () => null }),
  confirmGitHubStateChange: async () => true,
}));

const LOCAL = EnvironmentId.make("env-local");

function status(collapsedByDefault: boolean): TicketStatusDefinition {
  return {
    id: TicketStatusId.make("local-todo"),
    name: "Todo",
    color: "gray",
    category: "open",
    position: 0,
    collapsedByDefault,
    isDefault: true,
  };
}

function ticket(index: number): EnvironmentTicket {
  return {
    kind: "local",
    environmentId: LOCAL,
    id: TicketId.make(`ticket-${index}`),
    number: index + 1,
    title: `Ticket ${index + 1}`,
    labels: [],
    statusId: TicketStatusId.make("local-todo"),
    sortKey: `a${index.toString().padStart(3, "0")}`,
    revision: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    createdBy: { type: "user" },
    linkRefs: [],
    attachmentCount: 0,
    plans: [],
  };
}

function Harness(props: {
  readonly count: number;
  readonly collapsedByDefault: boolean;
  readonly initialOverrides: ReadonlyMap<string, boolean> | undefined;
  readonly onOpen: (ticket: EnvironmentTicket) => void;
}) {
  const [collapsedOverrides, setCollapsedOverrides] = useState(
    () => props.initialOverrides ?? new Map<string, boolean>(),
  );
  const tickets = Array.from({ length: props.count }, (_, index) => ticket(index));
  const statusSets: ReadonlyMap<EnvironmentId, TicketStatusSet> = new Map([
    [LOCAL, { statuses: [status(props.collapsedByDefault)] }],
  ]);
  return (
    <TicketKanban
      tickets={tickets}
      statusSets={statusSets}
      statusFilter={undefined}
      collapsedOverrides={collapsedOverrides}
      environmentLabels={new Map()}
      projectByKey={new Map()}
      onToggleColumn={(group, collapsed) => {
        setCollapsedOverrides((current) => new Map(current).set(group.key, !collapsed));
      }}
      onOpen={props.onOpen}
    />
  );
}

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

async function renderBoard(props: {
  readonly count: number;
  readonly collapsedByDefault?: boolean;
  readonly initialOverrides?: ReadonlyMap<string, boolean>;
}) {
  const onOpen = vi.fn<(ticket: EnvironmentTicket) => void>();
  await act(async () => {
    root.render(
      <Harness
        count={props.count}
        collapsedByDefault={props.collapsedByDefault ?? false}
        initialOverrides={props.initialOverrides}
        onOpen={onOpen}
      />,
    );
  });
  return onOpen;
}

function labeled(label: string) {
  const control = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (control === null) throw new Error(`Missing control: ${label}`);
  return control;
}

function card(title: string) {
  const control = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.includes(title) && candidate.dataset.kanbanToggle === undefined,
  );
  if (control === undefined) throw new Error(`Missing card: ${title}`);
  return control;
}

describe("TicketKanban columns", () => {
  it("keeps focus and restores the same cards and list scroll", async () => {
    const onOpen = await renderBoard({ count: 2 });
    const toggle = labeled("Todo, 2 tickets");
    const list = container.querySelector<HTMLElement>("[data-kanban-list]");
    const openCard = card("Ticket 1");
    if (list === null) throw new Error("Missing list");

    list.scrollTop = 80;
    toggle.focus();
    await act(async () => {
      openCard.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    await act(async () => {
      toggle.click();
    });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list.isConnected).toBe(true);
    expect(list.scrollTop).toBe(80);
    expect(openCard.closest("[inert]")).toBeTruthy();

    await act(async () => {
      toggle.click();
    });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.scrollTop).toBe(80);
    expect(openCard.closest("[inert]")).toBeNull();
    await act(async () => {
      openCard.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("starts from the status default and returns there after a reversed toggle", async () => {
    await renderBoard({ count: 1, collapsedByDefault: true });
    const toggle = labeled("Todo, 1 tickets");
    const openCard = card("Ticket 1");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(openCard.closest("[inert]")).toBeTruthy();
    toggle.focus();
    await act(async () => {
      toggle.click();
    });
    await act(async () => {
      toggle.click();
    });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(openCard.closest("[inert]")).toBeTruthy();
  });

  it("lets an override open a column that defaults to collapsed", async () => {
    await renderBoard({
      count: 1,
      collapsedByDefault: true,
      initialOverrides: new Map([["open:todo", false]]),
    });
    const toggle = labeled("Todo, 1 tickets");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(card("Ticket 1").closest("[inert]")).toBeNull();
  });

  it("keeps a long column openable across collapse", async () => {
    const rect = new DOMRect(0, 0, 288, 600);
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(288);
    try {
      const onOpen = await renderBoard({ count: 51 });
      const toggle = labeled("Todo, 51 tickets");
      const openCard = card("Ticket 1");
      expect(container.querySelector("[data-kanban-list]")).toBeNull();

      await act(async () => {
        openCard.click();
      });
      expect(onOpen).toHaveBeenCalledTimes(1);

      await act(async () => {
        toggle.click();
      });
      expect(openCard.isConnected).toBe(true);
      expect(openCard.closest("[inert]")).toBeTruthy();
      await act(async () => {
        toggle.click();
      });
      await act(async () => {
        openCard.click();
      });
      expect(onOpen).toHaveBeenCalledTimes(2);
    } finally {
      bounds.mockRestore();
      height.mockRestore();
      width.mockRestore();
    }
  });
});
