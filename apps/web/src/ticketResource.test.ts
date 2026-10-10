import { EnvironmentId, TicketId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { parseTicketResourceHref, parseTicketResourceSurface } from "./ticketResource";

const ticketRef = {
  environmentId: EnvironmentId.make("remote"),
  ticketId: TicketId.make("ticket-1"),
};

describe("ticket resource links", () => {
  it("resolves relative and same-origin page links without substituting the owning environment", () => {
    const target = { kind: "ticket-plan", ticketRef, planNumber: 2 } as const;
    expect(parseTicketResourceHref("/tickets/remote%3Aticket-1", "https://vetra.example")).toEqual({
      kind: "ticket",
      ticketRef,
    });
    expect(
      parseTicketResourceHref(
        "https://vetra.example/tickets/remote%3Aticket-1/plans/2?edit=true",
        "https://vetra.example",
      ),
    ).toEqual(target);
  });

  it.each([
    "https://external.example/tickets/remote%3Aticket-1/plans/2",
    "/tickets/remote%3Aticket-1/plans/0",
    "/tickets/remote%3Aticket-1/plans/1.5",
    "/tickets/remote%3Aticket-1/plans/9007199254740992",
    "/tickets/%E0%A4%A",
    "/tickets/missing-scope",
  ])("leaves external and malformed links alone (%s)", (href) => {
    expect(parseTicketResourceHref(href, "https://vetra.example")).toBeNull();
  });

  it("normalizes saved resources and drops transient edit intent", () => {
    expect(
      parseTicketResourceSurface({
        kind: "ticket-plan",
        ticketRef,
        planNumber: 2,
        startEditing: true,
      }),
    ).toEqual({
      id: "ticket-plan:remote%3Aticket-1:2",
      kind: "ticket-plan",
      ticketRef,
      planNumber: 2,
    });
    for (const planNumber of [0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseTicketResourceSurface({ kind: "ticket-plan", ticketRef, planNumber })).toBeNull();
    }
  });
});
