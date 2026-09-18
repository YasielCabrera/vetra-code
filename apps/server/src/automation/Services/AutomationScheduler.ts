/**
 * AutomationScheduler - fires automations when they come due.
 *
 * Two halves that meet at an event. The claim loop waits for the next
 * scheduled instant and dispatches `automation.run.claim`; a worker reacts to
 * the resulting `automation.run-claimed` events by starting the run's turn.
 * Splitting them there is what makes the Run now action work from any client
 * with no extra plumbing: a claim dispatched over the wire lands in the same
 * worker as one the timer produced.
 *
 * @module AutomationScheduler
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface AutomationSchedulerShape {
  /**
   * Start the claim loop and the run worker, and resume any run that was
   * claimed but never started.
   *
   * The returned effect must be run in a scope so both fibers are finalized on
   * shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when every claimed run has been started (or given up on).
   * Intended for tests, to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

export class AutomationScheduler extends Context.Service<
  AutomationScheduler,
  AutomationSchedulerShape
>()("t3/automation/Services/AutomationScheduler") {}
