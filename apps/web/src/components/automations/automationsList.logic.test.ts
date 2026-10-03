import {
  automationRunKey,
  type EnvironmentAutomation,
  type EnvironmentAutomationRun,
} from "@t3tools/client-runtime/state/automations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  ProjectId,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
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
  DEFAULT_SCHEDULE_PRESET,
  describeAutomationSchedule,
  formatMinutesOfDay,
  parseMinutesOfDay,
  presetFromSchedule,
  scheduleFromPreset,
  type SchedulePreset,
} from "./automationSchedule.logic";

const ENVIRONMENT_ID = "env-1" as EnvironmentId;

function makeAutomation(overrides?: Partial<EnvironmentAutomation>): EnvironmentAutomation {
  return {
    environmentId: ENVIRONMENT_ID,
    id: "automation-1" as ScheduledTaskId,
    title: "Daily briefing",
    prompt: "Summarize what changed.",
    schedule: { type: "fixed_time", timeOfDay: "08:00", weekdays: [1, 2, 3, 4, 5] },
    projectId: "project-1" as ProjectId,
    threadId: null,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    enabled: true,
    nextRunAt: "2026-08-13T12:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
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
    latestRun: {
      runId: "run-run-1" as RunId,
      status: "running",
      requestedAt: "2026-08-12T12:00:00.000Z",
      startedAt: "2026-08-12T12:00:00.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
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
    latestRun: {
      runId: "run-run-1" as RunId,
      status: "completed",
      requestedAt: completedAt,
      startedAt: completedAt,
      completedAt,
      assistantMessageId: null,
    },
    ...overrides,
  });
}

/** Every thread given is a run of `automationId` unless it is listed in `others`. */
function runsFor(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  others: Readonly<Record<string, string | null>> = {},
): ReadonlyMap<string, EnvironmentAutomationRun> {
  const runs = new Map<string, EnvironmentAutomationRun>();
  for (const thread of threads) {
    const automationId = thread.id in others ? others[thread.id] : "automation-1";
    if (automationId === null || automationId === undefined) continue;
    const run = {
      environmentId: thread.environmentId,
      threadId: thread.id,
      scheduledTaskId: automationId as ScheduledTaskId,
      createdAt: thread.createdAt,
      hiddenAt: thread.createdAt,
    } satisfies EnvironmentAutomationRun;
    runs.set(automationRunKey(run), run);
  }
  return runs;
}

describe("schedule presets", () => {
  it.each<SchedulePreset>([
    { ...DEFAULT_SCHEDULE_PRESET, kind: "daily", minutesOfDay: 9 * 60 + 30 },
    { ...DEFAULT_SCHEDULE_PRESET, kind: "weekdays", minutesOfDay: 8 * 60 },
    { ...DEFAULT_SCHEDULE_PRESET, kind: "weekly", minutesOfDay: 16 * 60, weekday: 5 },
    { ...DEFAULT_SCHEDULE_PRESET, kind: "hourly", everyHours: 6 },
  ])("round-trips the $kind preset", (preset) => {
    const parsed = presetFromSchedule(scheduleFromPreset(preset));
    expect(parsed?.kind).toBe(preset.kind);
    expect(parsed?.[preset.kind === "hourly" ? "everyHours" : "minutesOfDay"]).toBe(
      preset[preset.kind === "hourly" ? "everyHours" : "minutesOfDay"],
    );
    expect(parsed?.weekday).toBe(preset.kind === "weekly" ? preset.weekday : 1);
  });

  it.each([
    { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3, 5] },
    { type: "interval", everyMs: 15 * 60_000 },
    { type: "interval", everyMs: 24 * 60 * 60_000 },
  ] as const)("refuses to round off a schedule the picker cannot express", (schedule) => {
    expect(presetFromSchedule(schedule)).toBeNull();
  });

  it("reads a schedule the way a list should", () => {
    expect(
      describeAutomationSchedule({
        type: "fixed_time",
        timeOfDay: "08:00",
        weekdays: [1, 2, 3, 4, 5],
      }),
    ).toBe("Weekdays at 8:00 AM");
    expect(
      describeAutomationSchedule({ type: "fixed_time", timeOfDay: "16:00", weekdays: [5] }),
    ).toBe("Every Friday at 4:00 PM");
    expect(describeAutomationSchedule({ type: "fixed_time", timeOfDay: "09:00" })).toBe(
      "Every day at 9:00 AM",
    );
    expect(describeAutomationSchedule({ type: "interval", everyMs: 6 * 60 * 60_000 })).toBe(
      "Every 6 hours",
    );
    expect(describeAutomationSchedule({ type: "interval", everyMs: 15 * 60_000 })).toBe(
      "Every 15 minutes",
    );
  });

  it("names the days of a schedule no preset covers", () => {
    expect(
      describeAutomationSchedule({ type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3, 5] }),
    ).toBe("Mon, Wed, Fri at 9:00 AM");
  });

  it("honors a 24-hour clock preference", () => {
    expect(
      describeAutomationSchedule(
        { type: "fixed_time", timeOfDay: "16:00", weekdays: [5] },
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
        runThreads: [makeRunThread()],
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

  it("surfaces a failed run over the next one", () => {
    expect(
      resolveAutomationRowStatus({
        automation: makeAutomation({
          lastRunAt: "2026-08-12T12:00:00.000Z",
          lastRunStatus: "failed",
          lastRunError: "Project not found.",
        }),
        runThreads: [],
      }),
    ).toEqual({ kind: "failed", at: "2026-08-12T12:00:00.000Z", error: "Project not found." });
  });

  it("has nothing to say once nothing is scheduled", () => {
    expect(
      resolveAutomationRowStatus({
        automation: makeAutomation({ nextRunAt: null, lastRunStatus: "succeeded" }),
        runThreads: [makeFinishedRunThread("2026-08-12T12:05:00.000Z")],
      }),
    ).toEqual({ kind: "idle" });
  });
});

describe("automation rows", () => {
  const build = (
    automations: ReadonlyArray<EnvironmentAutomation>,
    threads = [makeRunThread()],
    others: Readonly<Record<string, string | null>> = {},
  ) =>
    buildAutomationRowModels({
      automations,
      threads,
      runsByThreadKey: runsFor(threads, others),
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
        makeRunThread({ id: "run-3" as ThreadId }),
      ],
      { "run-3": "automation-2" },
    );
    expect(rows[0]?.runCount).toBe(2);
    expect(rows[0]?.lastRunAt).toBe("2026-08-12T12:00:00.000Z");
  });

  it("ignores threads that belong to no automation", () => {
    const rows = build([makeAutomation()], [makeRunThread()], { "run-1": null });
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
      makeAutomation({ id: "later" as ScheduledTaskId, nextRunAt: "2026-08-14T12:00:00.000Z" }),
      makeAutomation({ id: "paused" as ScheduledTaskId, enabled: false }),
      makeAutomation({ id: "sooner" as ScheduledTaskId, nextRunAt: "2026-08-13T12:00:00.000Z" }),
      makeAutomation({ id: "unscheduled" as ScheduledTaskId, nextRunAt: null }),
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
        localLastVisitedAt: undefined,
      }),
    ).toBe(true);
  });

  it("clears once the run was opened after it finished", () => {
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        localLastVisitedAt: COMPLETED_AT,
      }),
    ).toBe(false);
    // Opened while it was still working, then left before it landed.
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        localLastVisitedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("trusts the server's visit over this browser's when the server tracks visits", () => {
    // Opened on any device: the server stamp clears it with no local stamp.
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT, { lastVisitedAt: COMPLETED_AT }),
        localLastVisitedAt: undefined,
      }),
    ).toBe(false);
    // Marked unread on the server: a stale local stamp must not hide it.
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT, { lastVisitedAt: null }),
        localLastVisitedAt: COMPLETED_AT,
      }),
    ).toBe(true);
  });

  it("keeps the signal when the stored visit is corrupt", () => {
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT),
        localLastVisitedAt: "not-a-date",
      }),
    ).toBe(true);
  });

  it("says nothing about runs with no result to read", () => {
    // Still running, or archived.
    expect(isAutomationRunUnread({ thread: makeRunThread(), localLastVisitedAt: undefined })).toBe(
      false,
    );
    expect(
      isAutomationRunUnread({
        thread: makeFinishedRunThread(COMPLETED_AT, { archivedAt: "2026-08-12T13:00:00.000Z" }),
        localLastVisitedAt: undefined,
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
      makeFinishedRunThread(COMPLETED_AT, { id: "chat-1" as ThreadId }),
      makeRunThread({ id: "run-4" as ThreadId }),
    ];

    expect(
      countUnreadAutomationRuns({
        threads,
        runsByThreadKey: runsFor(threads, { "chat-1": null }),
        lastVisitedAtByThreadKey: { "env-1:run-1": COMPLETED_AT },
      }),
    ).toBe(2);
  });

  it("leaves a deleted automation's promoted run to the sidebar", () => {
    expect(
      // The stream only carries runs of live automations.
      countUnreadAutomationRuns({
        threads: [makeFinishedRunThread(COMPLETED_AT)],
        runsByThreadKey: new Map(),
        lastVisitedAtByThreadKey: {},
      }),
    ).toBe(0);
  });

  it("hands each row the runs it still owes a read", () => {
    const threads = [
      makeFinishedRunThread(COMPLETED_AT, { id: "run-1" as ThreadId }),
      makeFinishedRunThread(COMPLETED_AT, { id: "run-2" as ThreadId }),
    ];
    const rows = buildAutomationRowModels({
      automations: [makeAutomation()],
      threads,
      runsByThreadKey: runsFor(threads),
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
  it("promises promoted runs stay in the sidebar", () => {
    expect(describeAutomationDeletion({ revealedRunCount: 2 })).toContain("stay");
  });

  it("stays quiet about the sidebar when nothing was promoted", () => {
    expect(describeAutomationDeletion({ revealedRunCount: 0 })).not.toContain("sidebar");
  });
});
