import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { resolveTicketThreadStatus } from "./ticketThreadStatus.logic";

const runtime = {
  status: "running" as const,
  providerName: "Codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  activeRunId: null,
  lastError: null,
  updatedAt: "2026-10-03T10:00:00.000Z",
};

describe("resolveTicketThreadStatus", () => {
  it("keeps idle and settled threads quiet", () => {
    expect(resolveTicketThreadStatus(makeThreadFixture({ runtime: null }))).toBeNull();
    expect(
      resolveTicketThreadStatus(
        makeThreadFixture({ runtime: { ...runtime, status: "completed" } }),
      ),
    ).toBeNull();
  });

  it.each(["queued", "preparing", "starting", "running", "waiting"] as const)(
    "uses the shared %s presentation without its animation",
    (status) => {
      const thread = makeThreadFixture({ runtime: { ...runtime, status } });
      expect(resolveTicketThreadStatus(thread)).toMatchObject({
        ...resolveThreadStatusPill({ thread }),
        pulse: false,
      });
    },
  );

  it("prioritizes approval and input over running or failed state", () => {
    for (const status of ["running", "failed"] as const) {
      const thread = makeThreadFixture({
        runtime: { ...runtime, status },
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      });
      expect(resolveTicketThreadStatus(thread)).toMatchObject({ label: "Pending Approval" });
      expect(resolveTicketThreadStatus({ ...thread, hasPendingApprovals: false })).toMatchObject({
        label: "Awaiting Input",
      });
    }
  });

  it.each([
    { lastErrorClass: "provider_error", label: "Failed", colorClass: "text-error" },
    { lastErrorClass: "usage_limit", label: "Limited", colorClass: "text-warning" },
  ] as const)(
    "shows $label using the sidebar error tone",
    ({ lastErrorClass, label, colorClass }) => {
      const thread = makeThreadFixture({
        runtime: {
          ...runtime,
          status: "failed",
          lastError: "Provider unavailable",
          lastErrorClass,
        },
      });
      expect(resolveTicketThreadStatus(thread)).toEqual({
        kind: "error",
        label,
        colorClass,
        tooltip: "Provider unavailable",
      });
    },
  );
});
