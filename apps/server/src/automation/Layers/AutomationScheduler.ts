import {
  AUTOMATION_CLAIM_RESUME_WINDOW_MS,
  type AutomationId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  PositiveInt,
  ThreadId,
} from "@vetra-code/contracts";
import { makeDrainableWorker } from "@vetra-code/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { ProjectionAutomationRepository } from "../../persistence/Services/ProjectionAutomations.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadTurnBootstrap } from "../../orchestration/Services/ThreadTurnBootstrap.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  AutomationScheduler,
  type AutomationSchedulerShape,
} from "../Services/AutomationScheduler.ts";

/**
 * The claim loop never sleeps longer than this in one go. A single long sleep
 * would be at the mercy of the machine suspending, the clock jumping, or a
 * daylight-saving shift; re-deciding once a minute costs nothing and is
 * correct through all three.
 */
const MAX_SLEEP = Duration.seconds(60);

/** Automations claimed per wake. A cap keeps one wake from becoming a stampede. */
const CLAIM_BATCH_LIMIT = PositiveInt.make(16);

/**
 * How long to hold off after a claim the engine would not take. A rejected
 * claim leaves `nextRunAt` in the past, and the delay for a past instant is
 * zero — so without a floor a persistently failing claim spins the loop and
 * floods the log. A backlog that is merely larger than the batch limit still
 * drains at full speed, because those claims succeed.
 */
const CLAIM_FAILURE_BACKOFF = Duration.seconds(30);

interface PendingRun {
  readonly automationId: AutomationId;
  readonly threadId: ThreadId;
  readonly scheduledFor: string;
}

/** Command ids are derived, not random: a retry after a crash must be a no-op. */
export function automationClaimCommandId(automationId: string, scheduledFor: string): CommandId {
  return CommandId.make(`automation-run:${automationId}:${scheduledFor}`);
}

export function automationTurnCommandId(automationId: string, scheduledFor: string): CommandId {
  return CommandId.make(`automation-turn:${automationId}:${scheduledFor}`);
}

/**
 * How long to wait before looking again. `null` means "nothing is scheduled" —
 * still a bounded wait, because an automation created a moment from now should
 * not have to wait for a wakeup that was never armed.
 */
export function resolveSchedulerDelay(input: {
  readonly nextRunAt: string | null;
  readonly nowMs: number;
  readonly maxSleepMs: number;
}): number {
  if (input.nextRunAt === null) return input.maxSleepMs;
  const nextRunAtMs = Date.parse(input.nextRunAt);
  if (Number.isNaN(nextRunAtMs)) return input.maxSleepMs;
  return Math.max(0, Math.min(nextRunAtMs - input.nowMs, input.maxSleepMs));
}

/**
 * Whether a claimed run still deserves to be started. A claim with no turn
 * means the server died between the two, a sub-second window — so a claim from
 * hours ago belongs to a machine that was off, and replaying its prompt on
 * wake would surprise the user.
 */
export function shouldResumeClaimedRun(input: {
  readonly occurredAt: string;
  readonly nowMs: number;
  readonly windowMs: number;
}): boolean {
  const occurredAtMs = Date.parse(input.occurredAt);
  if (Number.isNaN(occurredAtMs)) return false;
  const ageMs = input.nowMs - occurredAtMs;
  return ageMs >= 0 && ageMs <= input.windowMs;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const automationRepository = yield* ProjectionAutomationRepository;
  const threadTurnBootstrap = yield* ThreadTurnBootstrap;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  /**
   * The branch a run starts from. An automation that names one always gets it;
   * otherwise the project's current checkout decides, resolved at run time so
   * a schedule written months ago still starts somewhere sensible.
   */
  const resolveBaseBranch = (input: {
    readonly baseBranch: string | null;
    readonly workspaceRoot: string;
  }) =>
    input.baseBranch !== null
      ? Effect.succeed(input.baseBranch)
      : gitWorkflow.localStatus({ cwd: input.workspaceRoot }).pipe(
          Effect.map((status) => status.refName),
          Effect.catchCause(() => Effect.succeed(null)),
        );

  const startRun = Effect.fn("automation.startRun")(function* (run: PendingRun) {
    const automation = yield* automationRepository.getById({ automationId: run.automationId });
    // Deleted counts as gone. The row survives its own deletion, so without
    // this a delete landing between the claim and here would still start the
    // run — leaving a hidden thread no page can reach.
    if (Option.isNone(automation) || automation.value.deletedAt !== null) {
      yield* Effect.logDebug("automation run skipped: automation is gone", { run });
      return;
    }
    const project = yield* projectionSnapshotQuery.getProjectShellById(automation.value.projectId);
    if (Option.isNone(project)) {
      yield* Effect.logWarning("automation run skipped: its project is gone", {
        automationId: run.automationId,
        projectId: automation.value.projectId,
      });
      return;
    }

    const createdAt = yield* nowIso;
    const messageId = MessageId.make(yield* crypto.randomUUIDv4);
    const baseBranch = yield* resolveBaseBranch({
      baseBranch: automation.value.baseBranch,
      workspaceRoot: project.value.workspaceRoot,
    });
    // Null unless this run gets a worktree of its own, which needs a base
    // branch to cut from — so the two questions have one answer.
    const worktreeBaseBranch = automation.value.envMode === "worktree" ? baseBranch : null;

    yield* threadTurnBootstrap.dispatchBootstrapTurnStart({
      type: "thread.turn.start",
      // Derived, so a resumed claim cannot start the same run twice.
      commandId: automationTurnCommandId(run.automationId, run.scheduledFor),
      threadId: run.threadId,
      message: {
        messageId,
        role: "user",
        text: automation.value.prompt,
        attachments: [],
      },
      modelSelection: automation.value.modelSelection,
      runtimeMode: automation.value.runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      bootstrap: {
        createThread: {
          projectId: automation.value.projectId,
          title: automation.value.title,
          modelSelection: automation.value.modelSelection,
          runtimeMode: automation.value.runtimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          // The worktree branch is stamped on by the bootstrap once it exists.
          branch: worktreeBaseBranch !== null ? null : baseBranch,
          worktreePath: null,
          hidden: true,
          automationId: run.automationId,
          createdAt,
        },
        ...(worktreeBaseBranch !== null
          ? {
              prepareWorktree: {
                projectCwd: project.value.workspaceRoot,
                baseBranch: worktreeBaseBranch,
                startFromOrigin: automation.value.startFromOrigin,
              },
              runSetupScript: true,
            }
          : {}),
      },
      createdAt,
    });
  });

  const startRunSafely = (run: PendingRun) =>
    startRun(run).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        // The schedule has already moved on, so a failed run is history, not a
        // retry: the automations page shows it and offers Run now.
        return Effect.logWarning("automation run failed to start", {
          automationId: run.automationId,
          scheduledFor: run.scheduledFor,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(startRunSafely);

  /** False when any due automation could not be claimed, so the loop backs off. */
  const claimDueAutomations = Effect.fn("automation.claimDue")(function* () {
    const dueAt = yield* nowIso;
    const due = yield* automationRepository.listDue({ dueAt, limit: CLAIM_BATCH_LIMIT });
    let allClaimed = true;
    for (const automation of due) {
      const scheduledFor = automation.nextRunAt;
      if (scheduledFor === null) continue;
      const threadId = ThreadId.make(yield* crypto.randomUUIDv4);
      yield* orchestrationEngine
        .dispatch({
          type: "automation.run.claim",
          commandId: automationClaimCommandId(automation.automationId, scheduledFor),
          automationId: automation.automationId,
          scheduledFor,
          reason: "schedule",
          threadId,
          createdAt: dueAt,
        })
        .pipe(
          Effect.catchCause((cause) => {
            allClaimed = false;
            return Effect.logWarning("automation claim rejected", {
              automationId: automation.automationId,
              scheduledFor,
              cause: Cause.pretty(cause),
            });
          }),
        );
    }
    return allClaimed;
  });

  const claimDueAutomationsSafely = claimDueAutomations().pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      // A failed read must not kill the loop: the next wake tries again.
      return Effect.logWarning("automation scheduler tick failed", {
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(false));
    }),
  );

  /**
   * Anything that moves a schedule — a new automation, an edited one, a claim
   * that advanced nextRunAt — should be reacted to now rather than at the next
   * bounded wake.
   */
  const resolveNextDelay = Effect.gen(function* () {
    const earliest = yield* automationRepository
      .getEarliestNextRunAt()
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none<string>())));
    const now = yield* DateTime.now;
    return Duration.millis(
      resolveSchedulerDelay({
        nextRunAt: Option.getOrNull(earliest),
        nowMs: DateTime.toEpochMillis(now),
        maxSleepMs: Duration.toMillis(MAX_SLEEP),
      }),
    );
  });

  const resumeClaimedRuns = Effect.fn("automation.resumeClaimedRuns")(function* () {
    const automations = yield* automationRepository.listActive();
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    for (const automation of automations) {
      const lastRun = automation.lastRun;
      if (lastRun === null || lastRun.outcome !== "claimed" || lastRun.threadId === null) {
        continue;
      }
      if (
        !shouldResumeClaimedRun({
          occurredAt: lastRun.occurredAt,
          nowMs,
          windowMs: AUTOMATION_CLAIM_RESUME_WINDOW_MS,
        })
      ) {
        continue;
      }
      const threadId = ThreadId.make(lastRun.threadId);
      const thread = yield* projectionSnapshotQuery.getThreadShellById(threadId);
      if (Option.isSome(thread)) {
        continue;
      }
      yield* Effect.logInfo("resuming an automation run claimed before shutdown", {
        automationId: automation.automationId,
        scheduledFor: lastRun.scheduledFor,
      });
      yield* worker.enqueue({
        automationId: automation.automationId,
        threadId,
        scheduledFor: lastRun.scheduledFor,
      });
    }
  });

  /**
   * Deliberately independent of `BackgroundPolicy`. That service gates
   * *opportunistic* polling on client demand and host power; a scheduled run is
   * demand-independent work, like a turn already in flight, and has to fire
   * with no client connected. Do not "fix" this by consulting it.
   */
  const start: AutomationSchedulerShape["start"] = Effect.fn("start")(function* () {
    // Sliding so a burst of automation edits collapses into one re-arm.
    const wakeups = yield* Queue.sliding<void>(1);

    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.aggregateKind !== "automation") {
          return Effect.void;
        }
        return (
          event.type === "automation.run-claimed"
            ? worker.enqueue({
                automationId: event.payload.automationId,
                threadId: event.payload.threadId,
                scheduledFor: event.payload.scheduledFor,
              })
            : Effect.void
        ).pipe(Effect.andThen(Queue.offer(wakeups, undefined)), Effect.asVoid);
      }),
    );

    yield* forkParked(
      Effect.gen(function* () {
        yield* resumeClaimedRuns().pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("automation claim resume failed", { cause: Cause.pretty(cause) }),
          ),
        );
        return yield* Effect.forever(
          Effect.gen(function* () {
            const allClaimed = yield* claimDueAutomationsSafely;
            const delay = yield* resolveNextDelay;
            // Whichever comes first: the next scheduled instant (bounded), or
            // a change to what is scheduled.
            yield* Effect.raceFirst(
              Effect.sleep(allClaimed ? delay : Duration.max(delay, CLAIM_FAILURE_BACKOFF)),
              Queue.take(wakeups),
            );
          }),
        );
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies AutomationSchedulerShape;
});

export const AutomationSchedulerLive = Layer.effect(AutomationScheduler, make);
