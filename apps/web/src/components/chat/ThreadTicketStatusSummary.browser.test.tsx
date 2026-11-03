import { TicketStatusId, type TicketStatusDefinition } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadTicketStatusSummary } from "./ThreadTicketStatusSummary";

const queued = {
  id: TicketStatusId.make("queued"),
  name: "Queued",
  color: "blue",
  category: "open",
  position: 0,
  collapsedByDefault: false,
  isDefault: true,
} satisfies TicketStatusDefinition;
const initialTickets = [{ statusId: queued.id }];

function TicketSection(props: Parameters<typeof ThreadTicketStatusSummary>[0]) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="w-70">
      <ThreadDetailsSection
        headingId="test-ticket-heading"
        title={`Tickets · ${props.tickets.length}`}
        expanded={expanded}
        onExpandedChange={setExpanded}
        actionsPlacement="after-title"
        actions={<ThreadTicketStatusSummary {...props} />}
      >
        <ul aria-label="Linked tickets">
          <li>A linked ticket</li>
        </ul>
      </ThreadDetailsSection>
      <button type="button">Outside the summary</button>
    </div>
  );
}

it("opens on hover, allows pointer travel, and dismisses without expanding the list", async () => {
  await using screen = await render(<TicketSection tickets={initialTickets} statuses={[queued]} />);
  const trigger = screen.getByRole("button", { name: "Show ticket status counts" });
  const popup = page.getByRole("dialog", { name: "Ticket status counts" });
  const heading = screen.getByRole("button", { name: "Tickets · 1" });

  await userEvent.hover(trigger);
  await expect.element(popup).toBeVisible();
  await userEvent.hover(popup);
  await expect.element(popup).toBeVisible();
  await expect.element(heading).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByRole("list", { name: "Linked tickets" }))
    .not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(popup).not.toBeInTheDocument();

  await userEvent.hover(screen.getByRole("button", { name: "Outside the summary" }));
  await trigger.click();
  await expect.element(popup).toBeVisible();
  await screen.getByRole("button", { name: "Outside the summary" }).click();
  await expect.element(popup).not.toBeInTheDocument();
  await expect.element(heading).toHaveAttribute("aria-expanded", "false");
});

it("opens from keyboard focus, closes on Escape, and supports keyboard activation", async () => {
  await using screen = await render(
    <ThreadTicketStatusSummary tickets={initialTickets} statuses={[queued]} />,
  );
  const trigger = screen.getByRole("button", { name: "Show ticket status counts" });
  const popup = page.getByRole("dialog", { name: "Ticket status counts" });

  await userEvent.tab();
  await expect.element(trigger).toHaveFocus();
  await expect.element(popup).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(popup).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(popup).toBeVisible();
  await act(() => popup.element().focus());
  await expect.element(popup).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(popup).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
  await userEvent.keyboard(" ");
  await expect.element(popup).toBeVisible();
});

it("keeps an open summary current when ticket and status streams update independently", async () => {
  await using screen = await render(
    <TicketSection tickets={initialTickets} statuses={undefined} />,
  );
  await screen.getByRole("button", { name: "Show ticket status counts" }).click();
  const popup = page.getByRole("dialog", { name: "Ticket status counts" });
  await expect.element(popup.getByText("No status", { exact: true })).toBeVisible();

  await screen.rerender(
    <TicketSection tickets={[...initialTickets, { statusId: queued.id }]} statuses={[queued]} />,
  );
  await expect.element(popup.getByText("Queued", { exact: true })).toBeVisible();
  await expect.element(popup.getByText("No status", { exact: true })).not.toBeInTheDocument();
  await expect.element(popup.getByText("2 total", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Tickets · 2" }).click();
  await expect.element(screen.getByRole("list", { name: "Linked tickets" })).toBeVisible();
});
