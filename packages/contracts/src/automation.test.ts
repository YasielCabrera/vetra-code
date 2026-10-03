import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  Automation,
  AutomationCreateInput,
  AutomationSchedule,
  resolveAutomationNextRunAt,
} from "./automation.ts";

const decodeSchedule = Schema.decodeUnknownEffect(AutomationSchedule);
const decodeAutomation = Schema.decodeUnknownEffect(Automation);
const decodeCreateInput = Schema.decodeUnknownEffect(AutomationCreateInput);

const baseAutomation = {
  id: "automation-1",
  title: "Daily briefing",
  prompt: "Summarize what changed since yesterday.",
  schedule: { kind: "recurring", cron: "0 8 * * 1-5", timeZone: "America/New_York" },
  projectId: "project-1",
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
} as const;

it.effect("decodes a recurring schedule", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSchedule({
      kind: "recurring",
      cron: "0 8 * * 1-5",
      timeZone: "America/New_York",
    });
    assert.strictEqual(parsed.kind, "recurring");
  }),
);

it.effect("rejects a schedule whose cron expression is malformed", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeSchedule({ kind: "recurring", cron: "not a cron", timeZone: "UTC" }),
    );
    assert.isTrue(result._tag === "Failure");
  }),
);

it.effect("rejects a schedule whose time zone is not a real zone", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeSchedule({ kind: "recurring", cron: "0 8 * * *", timeZone: "Mars/Olympus_Mons" }),
    );
    assert.isTrue(result._tag === "Failure");
  }),
);

it.effect("decodes an automation and its run state", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeAutomation({
      ...baseAutomation,
      lastRun: {
        scheduledFor: "2026-08-12T12:00:00.000Z",
        occurredAt: "2026-08-12T12:00:01.000Z",
        outcome: "claimed",
        reason: "schedule",
        threadId: "thread-1",
      },
    });
    assert.strictEqual(parsed.lastRun?.outcome, "claimed");
    assert.strictEqual(parsed.lastRun?.threadId, "thread-1");
  }),
);

it.effect("decodes an owned-project create from a client", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeCreateInput({
      automationId: "automation-1",
      title: "Daily briefing",
      prompt: "Summarize what changed since yesterday.",
      schedule: { kind: "recurring", cron: "0 8 * * 1-5", timeZone: "America/New_York" },
      project: { kind: "owned", projectId: "project-1" },
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      envMode: "local",
      baseBranch: null,
      startFromOrigin: false,
      enabled: true,
    });
    // The client asks for an owned project without naming a root: only the
    // server knows where its Vetra home is.
    assert.deepStrictEqual(parsed.project, { kind: "owned", projectId: "project-1" });
  }),
);

it.effect("resolves the next recurring run in the automation's own time zone", () => {
  // 08:00 on weekdays in New York is 12:00Z while daylight saving is in effect.
  return Effect.sync(() => {
    const next = resolveAutomationNextRunAt(
      { kind: "recurring", cron: "0 8 * * 1-5", timeZone: "America/New_York" },
      "2026-08-12T13:00:00.000Z",
    );
    assert.strictEqual(next, "2026-08-13T12:00:00.000Z");
  });
});

it.effect("keeps a weekday schedule on weekdays across a weekend", () =>
  Effect.sync(() => {
    // 2026-08-14 is a Friday, so the next weekday run is the following Monday.
    const next = resolveAutomationNextRunAt(
      { kind: "recurring", cron: "0 8 * * 1-5", timeZone: "America/New_York" },
      "2026-08-14T13:00:00.000Z",
    );
    assert.strictEqual(next, "2026-08-17T12:00:00.000Z");
  }),
);

it.effect("resolves a one-time schedule once and then never again", () =>
  Effect.sync(() => {
    const schedule = { kind: "once", runAt: "2026-08-13T09:30:00.000Z" } as const;
    assert.strictEqual(
      resolveAutomationNextRunAt(schedule, "2026-08-12T10:00:00.000Z"),
      "2026-08-13T09:30:00.000Z",
    );
    assert.isNull(resolveAutomationNextRunAt(schedule, "2026-08-13T09:30:00.000Z"));
    assert.isNull(resolveAutomationNextRunAt(schedule, "2026-08-14T00:00:00.000Z"));
  }),
);

it.effect("has no next run for a cron that matches no real date", () =>
  Effect.sync(() => {
    assert.isNull(
      resolveAutomationNextRunAt(
        { kind: "recurring", cron: "0 0 30 2 *", timeZone: "UTC" },
        "2026-08-12T10:00:00.000Z",
      ),
    );
  }),
);
