import { AUTOMATION_CLAIM_RESUME_WINDOW_MS } from "@vetra-studio/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  automationClaimCommandId,
  automationTurnCommandId,
  resolveSchedulerDelay,
  shouldResumeClaimedRun,
} from "./AutomationScheduler.ts";

const MINUTE_MS = 60_000;
const NOW_MS = Date.parse("2026-08-12T10:00:00.000Z");

describe("automation scheduler timing", () => {
  it("waits exactly until the next scheduled instant when it is close", () => {
    expect(
      resolveSchedulerDelay({
        nextRunAt: "2026-08-12T10:00:30.000Z",
        nowMs: NOW_MS,
        maxSleepMs: MINUTE_MS,
      }),
    ).toBe(30_000);
  });

  it("never sleeps past its ceiling, however far off the next run is", () => {
    // A single sleep of a week would be at the mercy of the machine
    // suspending; the loop re-decides instead.
    expect(
      resolveSchedulerDelay({
        nextRunAt: "2026-09-12T10:00:00.000Z",
        nowMs: NOW_MS,
        maxSleepMs: MINUTE_MS,
      }),
    ).toBe(MINUTE_MS);
  });

  it("does not wait at all for a run that is already due", () => {
    expect(
      resolveSchedulerDelay({
        nextRunAt: "2026-08-12T09:00:00.000Z",
        nowMs: NOW_MS,
        maxSleepMs: MINUTE_MS,
      }),
    ).toBe(0);
  });

  it("still wakes on a bounded interval when nothing is scheduled", () => {
    expect(resolveSchedulerDelay({ nextRunAt: null, nowMs: NOW_MS, maxSleepMs: MINUTE_MS })).toBe(
      MINUTE_MS,
    );
    expect(
      resolveSchedulerDelay({ nextRunAt: "not a date", nowMs: NOW_MS, maxSleepMs: MINUTE_MS }),
    ).toBe(MINUTE_MS);
  });
});

describe("automation claim resume", () => {
  it("resumes a run whose server died moments after claiming it", () => {
    expect(
      shouldResumeClaimedRun({
        occurredAt: "2026-08-12T09:59:59.000Z",
        nowMs: NOW_MS,
        windowMs: AUTOMATION_CLAIM_RESUME_WINDOW_MS,
      }),
    ).toBe(true);
  });

  it("abandons a claim from a machine that was off for hours", () => {
    expect(
      shouldResumeClaimedRun({
        occurredAt: "2026-08-11T09:00:00.000Z",
        nowMs: NOW_MS,
        windowMs: AUTOMATION_CLAIM_RESUME_WINDOW_MS,
      }),
    ).toBe(false);
  });

  it("abandons a claim stamped in the future by a skewed clock", () => {
    expect(
      shouldResumeClaimedRun({
        occurredAt: "2026-08-12T11:00:00.000Z",
        nowMs: NOW_MS,
        windowMs: AUTOMATION_CLAIM_RESUME_WINDOW_MS,
      }),
    ).toBe(false);
  });

  it("abandons a claim with an unreadable timestamp", () => {
    expect(
      shouldResumeClaimedRun({
        occurredAt: "sometime",
        nowMs: NOW_MS,
        windowMs: AUTOMATION_CLAIM_RESUME_WINDOW_MS,
      }),
    ).toBe(false);
  });
});

describe("automation command ids", () => {
  it("derives one id per automation and scheduled instant", () => {
    // This is what makes firing exactly-once: the same occurrence dispatched
    // twice is deduplicated by the command receipt, across a restart.
    expect(automationClaimCommandId("automation-1", "2026-08-12T09:00:00.000Z")).toBe(
      "automation-run:automation-1:2026-08-12T09:00:00.000Z",
    );
    expect(automationClaimCommandId("automation-1", "2026-08-13T09:00:00.000Z")).not.toBe(
      automationClaimCommandId("automation-1", "2026-08-12T09:00:00.000Z"),
    );
    expect(automationTurnCommandId("automation-1", "2026-08-12T09:00:00.000Z")).not.toBe(
      automationClaimCommandId("automation-1", "2026-08-12T09:00:00.000Z"),
    );
  });
});
