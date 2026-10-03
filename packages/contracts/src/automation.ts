import * as Schema from "effect/Schema";

import { IsoDateTime, ScheduledTaskId, ThreadId } from "./baseSchemas.ts";

/**
 * Automations are upstream's scheduled tasks. What this fork adds is run
 * tracking: which threads a task launched, and which of them are still kept
 * out of the sidebar. Run threads are born hidden so a schedule firing
 * overnight does not fill the inbox; revealing one clears `hiddenAt` without
 * disowning it, so the automation's run history stays complete.
 */
export const AutomationRun = Schema.Struct({
  threadId: ThreadId,
  scheduledTaskId: ScheduledTaskId,
  createdAt: IsoDateTime,
  hiddenAt: Schema.NullOr(IsoDateTime),
});
export type AutomationRun = typeof AutomationRun.Type;

/** Every tracked run. Small, so the stream re-sends the whole list after every change. */
export const AutomationRunsSnapshot = Schema.Struct({
  runs: Schema.Array(AutomationRun),
});
export type AutomationRunsSnapshot = typeof AutomationRunsSnapshot.Type;

/** Promote a run to the sidebar, or put it back. */
export const AutomationRunVisibilityInput = Schema.Struct({
  threadId: ThreadId,
  hidden: Schema.Boolean,
});
export type AutomationRunVisibilityInput = typeof AutomationRunVisibilityInput.Type;

export class AutomationError extends Schema.TaggedError<AutomationError>()("AutomationError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
