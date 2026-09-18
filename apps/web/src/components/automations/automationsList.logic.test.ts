import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { AutomationId, EnvironmentId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { describeAutomationDeletion } from "../../hooks/useAutomationActions";
import {
  buildAutomationRowModels,
  countUnreadAutomationRuns,
  isAutomationRunUnread,
  matchesAutomationQuery,
  resolveAutomationRowStatus,
  sortAutomationRows,
  unreadRunBadgeLabel,
} from "./automationsList.logic";
import {
  cronFromPreset,
  DEFAULT_SCHEDULE_PRESET,
  describeAutomationSchedule,
  formatMinutesOfDay,
  parseMinutesOfDay,
  presetFromCron,
} from "./automationSchedule.logic";

const ENVIRONMENT_ID = "env-1" as EnvironmentId;

function makeAutomation(overrides?: Partial<EnvironmentAutomation>): EnvironmentAutomation {
  return {
    environmentId: ENVIRONMENT_ID,
    id: "automation-1" as AutomationId,
    title: "Daily briefing",
    prompt: "Summarize what changed.",
    schedule: { kind: "recurring", cron: "0 8 * * 1-5", timeZone: "America/New_York" },
    projectId: "project-1" as ProjectId,
    ownsProject: false,
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    envMode: "local",
    baseBranch: null,
    startFromOrigin: false,
    enabled: true,
    nextRunAt: "2026-08-13T12:00:00.000Z",
    lastRun: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    deletedAt: null,
    ...overrides,
  } as EnvironmentAutomation;
}

function makeRunThread(overrides?: Partial<EnvironmentThreadShell>): EnvironmentThreadShell {
  return {
    environmentId: ENVIRONMENT_ID,
    id: "run-1" as ThreadId,
    projectId: "project-1" as ProjectId,
    title: "Daily briefing",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    hiddenAt: "2026-08-12T12:00:00.000Z",
    automationId: "automation-1" as AutomationId,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as EnvironmentThreadShell;
}

function makeFinishedRunThread(
  completedAt: string,
  overrides?: Partial<EnvironmentThreadShell>,
): EnvironmentThreadShell {
  return makeRunThread({
    latestTurn: {
      turnId: "turn-1" as TurnId,
      state: "completed",
      requestedAt: completedAt,
      startedAt: completedAt,
      completedAt,
      assistantMessageId: null,
    },
    ...overrides,
  });
}

describe("schedule presets", () => {
  it("round-trips every preset the picker can express", () => {
    const presets = [
      { ...DEFAULT_SCHEDULE_PRESET, kind: "daily" as const, minutesOfDay: 9 * 60 + 30 },
      { ...DEFAULT_SCHEDULE_PRESET, kind: "weekdays" as const, minutesOfDay: 8 * 60 },
      { ...DEFAULT_SCHEDULE_PRESET, kind: "weekly" as const, minutesOfDay: 16 * 60, weekday: 5 },
      { ...DEFAULT_SCHEDULE_PRESET, kind: "hourly" as const, everyHours: 6, minutesOfDay: 0 },
    ];
    for (const preset of presets) {
      const parsed = presetFromCron(cronFromPreset(preset));
      expect(parsed?.kind).toBe(preset.kind);
      if (preset.kind === "hourly") {
        expect(parsed?.everyHours).toBe(preset.everyHours);
      } else {
        expect(parsed?.minutesOfDay).toBe(preset.minutesOfDay);
      }
      if (preset.kind === "weekly") {
        expect(parsed?.weekday).toBe(preset.weekday);
      }
    }
  });

  it("refuses to round off a cron the picker cannot express", () => {
    // Read back as a preset these would silently become something else.
    expect(presetFromCron("0 9 1 * *")).toBeNull();
    expect(presetFromCron("*/15 * * * *")).toBeNull();
    expect(presetFromCron("0 9 * * 1,3,5")).toBeNull();
    expect(presetFromCron("0 9 * *")).toBeNull();
  });

  it("reads a schedule the way a list should", () => {
    expect(
      describeAutomationSchedule({
        kind: "recurring",
        cron: "0 8 * * 1-5",
        timeZone: "America/New_York",
      }),
    ).toBe("Weekdays at 8:00 AM");
    expect(
      describeAutomationSchedule({ kind: "recurring", cron: "0 16 * * 5", timeZone: "UTC" }),
    ).toBe("Every Friday at 4:00 PM");
    expect(
      describeAutomationSchedule({ kind: "recurring", cron: "0 9 * * *", timeZone: "UTC" }),
    ).toBe("Every day at 9:00 AM");
    expect(
      describeAutomationSchedule({ kind: "recurring", cron: "0 */6 * * *", timeZone: "UTC" }),
    ).toBe("Every 6 hours");
    expect(describeAutomationSchedule({ kind: "once", runAt: "2026-08-13T09:00:00.000Z" })).toBe(
      "Once",
    );
  });

  it("shows an unrecognized expression rather than a wrong summary", () => {
    expect(
      describeAutomationSchedule({ kind: "recurring", cron: "0 9 1 * *", timeZone: "UTC" }),
    ).toBe("0 9 1 * *");
  });

  it("honors a 24-hour clock preference", () => {
    expect(
      describeAutomationSchedule(
        { kind: "recurring", cron: "0 16 * * 5", timeZone: "UTC" },
        { use24Hour: true },
      ),
    ).toBe("Every Friday at 16:00");
  });

  it("parses and formats a time of day", () => {
    expect(formatMinutesOfDay(8 * 60 + 5)).toBe("08:05");
    expect(parseMinutesOfDay("08:05")).toBe(8 * 60 + 5);
    expect(parseMinutesOfDay("24:00")).toBeNull();
    expect(parseMinutesOfDay("8:5")).toBeNull();
  });
});

describe("automation row status", () => {
  it("leads with a run in flight", () => {
    expect(
      resolveAutomationRowStatus({
        automation: makeAutomation(),
        runThreads: [
          makeRunThread({
            session: {
              threadId: "run-1" as ThreadId,
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-08-12T12:00:00.000Z",
            },
          }),
        ],
      }),
    ).toEqual({ kind: "running" });
  });

  it("says paused before it says scheduled", () => {
    expect(
      resolveAutomationRowStatus({
        automation: makeAutomation({ enabled: false }),
        runThreads: [],
      }),
    ).toEqual({ kind: "paused" });
  });

  it("surfaces a missed run over the next one", () => {
    expect(
      resolveAutomationRowStatus({
        automation: makeAutomation({
          lastRun: {
            scheduledFor: "2026-08-12T12:00:00.000Z",
            occurredAt: "2026-08-12T18:00:00.000Z",
            outcome: "missed",
            reason: "schedule",
            threadId: null,
          },
        }),
        runThreads: [],
      }),
    ).toEqual({ kind: "missed", scheduledFor: "2026-08-12T12:00:00.000Z" });
  });

  it("has nothing to say once a one-time automation has run", () => {
    expect(
      resolveAutomationRowStatus({
        automation: makeAutomation({
          schedule: { kind: "once", runAt: "2026-08-12T12:00:00.000Z" },
          nextRunAt: null,
          lastRun: {
            scheduledFor: "2026-08-12T12:00:00.000Z",
            occurredAt: "2026-08-12T12:00:00.000Z",
            outcome: "claimed",
            reason: "schedule",
            threadId: "run-1" as ThreadId,
          },
        }),
        runThreads: [makeRunThread()],
      }),
    ).toEqual({ kind: "idle" });
  });
});

describe("automation rows", () => {
  const build = (automations: ReadonlyArray<EnvironmentAutomation>, threads = [makeRunThread()]) =>
    buildAutomationRowModels({
      automations,
      threads,
      resolveProjectName: () => "vetra-code",
      resolveModelLabel: () => "GPT-5",
      resolveEnvironmentLabel: () => null,
    });

  it("counts an automation's runs and dates the newest", () => {
    const rows = build(
      [makeAutomation()],
      [
        makeRunThread({ id: "run-1" as ThreadId, createdAt: "2026-08-11T12:00:00.000Z" }),
        makeRunThread({ id: "run-2" as ThreadId, createdAt: "2026-08-12T12:00:00.000Z" }),
        // A different automation's run must not be counted here.
        makeRunThread({ id: "run-3" as ThreadId, automationId: "automation-2" as AutomationId }),
      ],
    );
    expect(rows[0]?.runCount).toBe(2);
    expect(rows[0]?.lastRunAt).toBe("2026-08-12T12:00:00.000Z");
  });

  it("ignores threads that belong to no automation", () => {
    const rows = build([makeAutomation()], [makeRunThread({ automationId: null })]);
    expect(rows[0]?.runCount).toBe(0);
  });

  it("searches title, prompt, schedule, and project", () => {
    const [row] = build([makeAutomation()]);
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(matchesAutomationQuery(row, "briefing")).toBe(true);
    expect(matchesAutomationQuery(row, "summarize")).toBe(true);
    expect(matchesAutomationQuery(row, "weekdays")).toBe(true);
    expect(matchesAutomationQuery(row, "gpt-5")).toBe(true);
    expect(matchesAutomationQuery(row, "vetra")).toBe(true);
    expect(matchesAutomationQuery(row, "nothing here")).toBe(false);
    expect(matchesAutomationQuery(row, "   ")).toBe(true);
  });

  it("puts the soonest run first and sinks paused automations", () => {
    const rows = build([
      makeAutomation({ id: "later" as AutomationId, nextRunAt: "2026-08-14T12:00:00.000Z" }),
      makeAutomation({ id: "paused" as AutomationId, enabled: false }),
      makeAutomation({ id: "sooner" as AutomationId, nextRunAt: "2026-08-13T12:00:00.000Z" }),
      makeAutomation({ id: "unscheduled" as AutomationId, nextRunAt: null }),
    ]);
    expect(sortAutomationRows(rows).map((row) => row.automation.id)).toEqual([
      "sooner",
      "later",
      "unscheduled",
      "paused",
    ]);
  });
});

describe("unread runs", () => {
  const COMPLETED_AT = "2026-08-12T12:05:00.000Z";

  it("counts a finished run nobody opened as unread", () => {
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        lastVisitedAt: undefined,
      }),
    ).toBe(true);
  });

  it("clears once the run was opened after it finished", () => {
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        lastVisitedAt: COMPLETED_AT,
      }),
    ).toBe(false);
    // Opened while it was still working, then left before it landed.
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        lastVisitedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("keeps the signal when the stored visit is corrupt", () => {
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        lastVisitedAt: "not-a-date",
      }),
    ).toBe(true);
  });

  it("says nothing about runs with no result to read", () => {
    // Still running, archived, or not an automation's thread at all.
    expect(isAutomationRunUnread({ thread: makeRunThread(), lastVisitedAt: undefined })).toBe(
      false,
    );
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT, { archivedAt: "2026-08-12T13:00:00.000Z" }),
        lastVisitedAt: undefined,
      }),
    ).toBe(false);
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT, { automationId: null }),
        lastVisitedAt: undefined,
      }),
    ).toBe(false);
  });

  it("totals unread runs across environments for the sidebar badge", () => {
    const threads = [
      makeFinishedRunThread(COMPLETED_AT, { id: "run-1" as ThreadId }),
      makeFinishedRunThread(COMPLETED_AT, { id: "run-2" as ThreadId }),
      makeFinishedRunThread(COMPLETED_AT, {
        id: "run-3" as ThreadId,
        environmentId: "env-2" as EnvironmentId,
      }),
      // Not an automation run, and a run still in flight: neither counts.
      makeFinishedRunThread(COMPLETED_AT, { id: "chat-1" as ThreadId, automationId: null }),
      makeRunThread({ id: "run-4" as ThreadId }),
    ];

    expect(
      countUnreadAutomationRuns({
        threads,
        lastVisitedAtByThreadKey: { "env-1:run-1": COMPLETED_AT },
        knownAutomationKeys: new Set(["env-1:automation-1", "env-2:automation-1"]),
      }),
    ).toBe(2);
  });

  it("leaves a deleted automation's promoted run to the sidebar", () => {
    expect(
      countUnreadAutomationRuns({
        threads: [makeFinishedRunThread(COMPLETED_AT, { hiddenAt: null })],
        lastVisitedAtByThreadKey: {},
        knownAutomationKeys: new Set(),
      }),
    ).toBe(0);
  });

  it("hands each row the runs it still owes a read", () => {
    const rows = buildAutomationRowModels({
      automations: [makeAutomation()],
      threads: [
        makeFinishedRunThread(COMPLETED_AT, { id: "run-1" as ThreadId }),
        makeFinishedRunThread(COMPLETED_AT, { id: "run-2" as ThreadId }),
      ],
      resolveProjectName: () => null,
      resolveModelLabel: () => null,
      resolveEnvironmentLabel: () => null,
      lastVisitedAtByThreadKey: { "env-1:run-2": COMPLETED_AT },
    });

    expect(rows[0]?.runCount).toBe(2);
    expect(rows[0]?.unreadRunThreads.map((thread) => thread.id)).toEqual(["run-1"]);
  });

  it("stops the badge from stretching its row", () => {
    expect(unreadRunBadgeLabel(9)).toBe("9");
    expect(unreadRunBadgeLabel(99)).toBe("99");
    expect(unreadRunBadgeLabel(140)).toBe("99+");
  });
});

describe("automation deletion copy", () => {
  it("warns that an owned workspace takes promoted runs with it", () => {
    expect(
      describeAutomationDeletion({ ownsProject: true, runCount: 4, revealedRunCount: 2 }),
    ).toContain("including 2 in your sidebar");
  });

  it("promises promoted runs survive when the project is not the automation's", () => {
    expect(
      describeAutomationDeletion({ ownsProject: false, runCount: 4, revealedRunCount: 2 }),
    ).toContain("stay");
  });

  it("stays quiet about the sidebar when nothing was promoted", () => {
    for (const ownsProject of [true, false]) {
      const copy = describeAutomationDeletion({ ownsProject, runCount: 3, revealedRunCount: 0 });
      expect(copy).not.toContain("sidebar");
    }
  });
});
