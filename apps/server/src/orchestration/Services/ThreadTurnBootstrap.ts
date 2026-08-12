/**
 * ThreadTurnBootstrap - the "start a turn, creating whatever it needs first"
 * step of a thread.turn.start.
 *
 * A bootstrapped turn start can create the thread, prepare a git worktree for
 * it, and launch the project's setup script before the turn itself is
 * dispatched — cleaning the thread up again if any of that fails. It lived
 * inside the websocket connection's closure until automations needed it: a
 * scheduled run has no connection, and duplicating the sequence would have
 * meant two versions of the cleanup rules.
 *
 * @module ThreadTurnBootstrap
 */
import type {
  OrchestrationCommand,
  OrchestrationDispatchCommandError,
} from "@vetra-code/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ThreadTurnBootstrapShape {
  /**
   * Dispatch a `thread.turn.start` that carries a `bootstrap` block.
   *
   * Commands without one should go straight to the orchestration engine; this
   * is only the compound path.
   */
  readonly dispatchBootstrapTurnStart: (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
}

export class ThreadTurnBootstrap extends Context.Service<
  ThreadTurnBootstrap,
  ThreadTurnBootstrapShape
>()("@vetra-code/server/orchestration/Services/ThreadTurnBootstrap") {}
