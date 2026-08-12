import * as Cron from "effect/Cron";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * When an automation runs. Lives here rather than in orchestration.ts so the
 * cron helpers below can be shared by the decider (which computes the next run
 * as part of deciding a claim) and by the client form (which previews it)
 * without either importing the orchestration command surface.
 */
const AutomationOnceSchedule = Schema.Struct({
  kind: Schema.Literal("once"),
  /** The instant to run at. A one-time automation has no next run afterwards. */
  runAt: IsoDateTime,
});

/**
 * Standard 5- or 6-field cron, evaluated in `timeZone`. Storing an IANA zone
 * rather than an offset is what makes "every weekday at 8am" survive DST, and
 * what lets an automation on a remote environment mean the user's morning
 * rather than the server's.
 */
const AutomationRecurringSchedule = Schema.Struct({
  kind: Schema.Literal("recurring"),
  cron: TrimmedNonEmptyString,
  timeZone: TrimmedNonEmptyString,
}).check(
  Schema.makeFilter((input) => {
    const parsed = Cron.parse(input.cron, input.timeZone);
    return (
      Result.isSuccess(parsed) ||
      `'${input.cron}' in time zone '${input.timeZone}' is not a valid schedule`
    );
  }),
);

export const AutomationSchedule = Schema.Union([
  AutomationOnceSchedule,
  AutomationRecurringSchedule,
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

/** Why a run was attempted. Manual runs come from the Run now action. */
export const AutomationRunReason = Schema.Literals(["schedule", "manual"]);
export type AutomationRunReason = typeof AutomationRunReason.Type;

/**
 * What became of the most recent attempt.
 *
 * `claimed` is the success case: the run owns a thread. There is deliberately
 * no terminal `finished`/`failed` outcome — the thread carries the run's own
 * status, so a second source of truth for it could only drift.
 */
export const AutomationRunOutcome = Schema.Literals([
  "claimed",
  "skipped-overlap",
  "skipped-disabled",
  "missed",
]);
export type AutomationRunOutcome = typeof AutomationRunOutcome.Type;

export const AutomationLastRun = Schema.Struct({
  /** The scheduled instant this attempt was for, not when it was decided. */
  scheduledFor: IsoDateTime,
  occurredAt: IsoDateTime,
  outcome: AutomationRunOutcome,
  reason: AutomationRunReason,
  /** The run's thread. Set only for a `claimed` outcome. */
  threadId: Schema.NullOr(ThreadId),
});
export type AutomationLastRun = typeof AutomationLastRun.Type;

/**
 * How late a one-time run may be and still fire. A schedule the user set for
 * 3pm should run when the machine wakes at 5pm; a week later it should not.
 * Recurring schedules never fire late — they skip to their next occurrence.
 */
export const AUTOMATION_MISSED_ONCE_GRACE_MS = 24 * 60 * 60 * 1_000;

/**
 * How late a recurring run may be and still fire. Wide enough to absorb
 * ordinary scheduler latency and a busy machine, narrow enough that a lid
 * opening at lunch does not run the morning briefing.
 */
export const AUTOMATION_LATE_RUN_TOLERANCE_MS = 5 * 60 * 1_000;

/**
 * How long a claimed-but-unstarted run stays resumable. A claim with no turn
 * means the server died between the two, which is a sub-second window; a claim
 * older than this is from a machine that was off, and replaying its prompt on
 * wake would surprise the user.
 */
export const AUTOMATION_CLAIM_RESUME_WINDOW_MS = 60 * 60 * 1_000;

export const AUTOMATION_PROMPT_MAX_CHARS = 20_000;
export const AUTOMATION_TITLE_MAX_CHARS = 200;

export const AutomationPrompt = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTOMATION_PROMPT_MAX_CHARS),
);
export const AutomationTitle = TrimmedNonEmptyString.check(
  Schema.isMaxLength(AUTOMATION_TITLE_MAX_CHARS),
);

/**
 * The next instant an automation should run, strictly after `after`, or null
 * when it has none: a one-time schedule that already passed, or a cron that
 * matches no real date (`0 0 30 2 *`). Total by construction — `Cron.next`
 * throws when its search finds nothing, and a schedule that cannot resolve
 * must leave the automation inert rather than fail the command that saved it.
 */
export function resolveAutomationNextRunAt(
  schedule: AutomationSchedule,
  after: string,
): string | null {
  const afterMs = Date.parse(after);
  if (Number.isNaN(afterMs)) return null;
  if (schedule.kind === "once") {
    const runAtMs = Date.parse(schedule.runAt);
    if (Number.isNaN(runAtMs)) return null;
    // Canonicalized rather than echoed back: nextRunAt is compared and sorted
    // as text in SQL, so every writer has to agree on the format.
    return runAtMs > afterMs ? DateTime.formatIso(DateTime.makeUnsafe(runAtMs)) : null;
  }
  const parsed = Cron.parse(schedule.cron, schedule.timeZone);
  if (Result.isFailure(parsed)) return null;
  try {
    return Cron.next(parsed.success, afterMs).toISOString();
  } catch {
    return null;
  }
}
