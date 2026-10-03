import * as Cron from "effect/Cron";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  AutomationId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ThreadEnvMode } from "./environment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";

/**
 * When an automation runs. The cron helpers below are shared by the server
 * (which computes the next run on every claim) and by the client form (which
 * previews it).
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

/**
 * A prompt plus a schedule. Each firing produces its own thread in
 * `projectId`, so a run is a thread and the automation holds only what the
 * next one needs.
 */
export const Automation = Schema.Struct({
  id: AutomationId,
  title: AutomationTitle,
  prompt: AutomationPrompt,
  schedule: AutomationSchedule,
  projectId: ProjectId,
  /** True when `projectId` is the automation's own project under Vetra home. */
  ownsProject: Schema.Boolean,
  modelSelection: ModelSelection,
  /**
   * Unattended work parks forever on the first approval request, so
   * automations default to full access and the form says so.
   */
  runtimeMode: RuntimeMode,
  /** Where a run works: the project's checkout, or a worktree per run. */
  envMode: ThreadEnvMode,
  /** Null means "whatever the checkout is on when the run starts". */
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  startFromOrigin: Schema.Boolean,
  /** Paused automations keep their schedule and stop firing. */
  enabled: Schema.Boolean,
  /**
   * The next instant this should fire, or null when nothing is scheduled: a
   * one-time run that already happened, or a cron matching no real date.
   * Recomputed on every schedule change and every claim; the scheduler treats
   * it as its queue key.
   */
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRun: Schema.NullOr(AutomationLastRun),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

/**
 * A claimed run: the thread one firing produced. Run threads are born hidden
 * so a schedule firing overnight does not fill the sidebar; revealing one
 * clears `hiddenAt` without disowning it, so the automation's history stays
 * complete.
 */
export const AutomationRun = Schema.Struct({
  threadId: ThreadId,
  automationId: AutomationId,
  scheduledFor: IsoDateTime,
  reason: AutomationRunReason,
  createdAt: IsoDateTime,
  hiddenAt: Schema.NullOr(IsoDateTime),
});
export type AutomationRun = typeof AutomationRun.Type;

/** Everything the automations surfaces render. Few and tiny, so the stream
    re-sends the whole snapshot after every change. */
export const AutomationSnapshot = Schema.Struct({
  automations: Schema.Array(Automation),
  runs: Schema.Array(AutomationRun),
});
export type AutomationSnapshot = typeof AutomationSnapshot.Type;

/**
 * An automation either runs in a project the user chose, or gets one of its
 * own rooted under Vetra home. Only the server knows where that is, so the
 * client asks for "owned" and names the id the project should get.
 */
export const AutomationProjectTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("existing"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("owned"), projectId: ProjectId }),
]);
export type AutomationProjectTarget = typeof AutomationProjectTarget.Type;

export const AutomationCreateInput = Schema.Struct({
  automationId: AutomationId,
  title: AutomationTitle,
  prompt: AutomationPrompt,
  schedule: AutomationSchedule,
  project: AutomationProjectTarget,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  envMode: ThreadEnvMode,
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  startFromOrigin: Schema.Boolean,
  enabled: Schema.Boolean,
});
export type AutomationCreateInput = typeof AutomationCreateInput.Type;

/** Absent fields are left unchanged. Which project an automation runs in is
    deliberately not editable: an owned project would be orphaned by the move. */
export const AutomationUpdateInput = Schema.Struct({
  automationId: AutomationId,
  title: Schema.optional(AutomationTitle),
  prompt: Schema.optional(AutomationPrompt),
  schedule: Schema.optional(AutomationSchedule),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  envMode: Schema.optional(ThreadEnvMode),
  baseBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  startFromOrigin: Schema.optional(Schema.Boolean),
});
export type AutomationUpdateInput = typeof AutomationUpdateInput.Type;

/** Enable, disable, and Run now. Run now works on a paused automation: that is
    how a schedule gets tested before it is turned loose. */
export const AutomationTargetInput = Schema.Struct({ automationId: AutomationId });
export type AutomationTargetInput = typeof AutomationTargetInput.Type;

export const AutomationDeleteInput = Schema.Struct({
  automationId: AutomationId,
  /**
   * Required only when deleting would take revealed run threads with it —
   * which happens when the automation owns its project, since the project goes
   * too. Hidden runs are reachable only through the automation, so they are
   * always cleaned up.
   */
  force: Schema.optional(Schema.Boolean),
});
export type AutomationDeleteInput = typeof AutomationDeleteInput.Type;

/** Promote a run to the sidebar, or put it back. */
export const AutomationRunVisibilityInput = Schema.Struct({
  threadId: ThreadId,
  hidden: Schema.Boolean,
});
export type AutomationRunVisibilityInput = typeof AutomationRunVisibilityInput.Type;

export class AutomationError extends Schema.TaggedError<AutomationError>()("AutomationError", {
  message: Schema.String,
  automationId: Schema.optional(AutomationId),
  cause: Schema.optional(Schema.Defect()),
}) {}
