import {
  AUTOMATION_CLAIM_RESUME_WINDOW_MS,
  AUTOMATION_LATE_RUN_TOLERANCE_MS,
  AUTOMATION_MISSED_ONCE_GRACE_MS,
  type Automation,
  type AutomationCreateInput,
  type AutomationDeleteInput,
  AutomationError,
  type AutomationId,
  type AutomationRun,
  type AutomationRunReason,
  type AutomationRunVisibilityInput,
  type AutomationSchedule,
  type AutomationSnapshot,
  type AutomationTargetInput,
  type AutomationUpdateInput,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  PositiveInt,
  ThreadId,
  resolveAutomationNextRunAt,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { randomUuidV4 } from "../orchestration-v2/RandomUuid.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadLifecycleService from "../orchestration-v2/ThreadLifecycleService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import {
  type ProjectionAutomation,
  ProjectionAutomationRepository,
} from "../persistence/Services/ProjectionAutomations.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";

/**
 * Scheduled prompts that each fire into a thread of their own.
 *
 * Automations are not orchestration events: they are a handful of rows the
 * user edits, so they live in `projection_automations` and re-stream the whole
 * snapshot on every change, the way upstream's scheduled tasks do. A run is a
 * thread launched through `ThreadLaunchService`; `automation_runs` records which
 * threads an automation produced and which of them are still hidden from the
 * sidebar, since V2 threads have no notion of hidden.
 */
export class AutomationService extends Context.Service<
  AutomationService,
  {
    /** Emits the full snapshot on subscribe and again after every change. */
    readonly subscribe: () => Stream.Stream<AutomationSnapshot, AutomationError>;
    readonly create: (input: AutomationCreateInput) => Effect.Effect<void, AutomationError>;
    readonly update: (input: AutomationUpdateInput) => Effect.Effect<void, AutomationError>;
    readonly enable: (input: AutomationTargetInput) => Effect.Effect<void, AutomationError>;
    readonly disable: (input: AutomationTargetInput) => Effect.Effect<void, AutomationError>;
    readonly delete: (input: AutomationDeleteInput) => Effect.Effect<void, AutomationError>;
    readonly runNow: (input: AutomationTargetInput) => Effect.Effect<void, AutomationError>;
    readonly setRunHidden: (
      input: AutomationRunVisibilityInput,
    ) => Effect.Effect<void, AutomationError>;
  }
>()("t3/automation/AutomationService") {}

/** Automations claimed per tick. A cap keeps one tick from becoming a stampede. */
const CLAIM_BATCH_LIMIT = PositiveInt.make(16);

/**
 * How long a claimed run with no thread yet still counts as running. The gap
 * between a claim and its launch is sub-second; this only has to cover a Run
 * now racing a scheduled claim.
 */
const CLAIMED_RUN_LAUNCH_GRACE_MS = 60_000;

/** Ids are derived, not random: a retried launch after a crash must be a no-op. */
export function automationRunCommandId(automationId: string, scheduledFor: string): CommandId {
  return CommandId.make(`automation-run:${automationId}:${scheduledFor}`);
}

function automationRunMessageId(automationId: string, scheduledFor: string): MessageId {
  return MessageId.make(`automation-message:${automationId}:${scheduledFor}`);
}

/**
 * Whether a scheduled occurrence has gone stale. Recurring schedules get a
 * short tolerance for ordinary scheduler latency and otherwise skip to their
 * next occurrence — a briefing is for the morning, not for whenever the lid
 * happened to open. One-time schedules are the opposite: the user asked for a
 * specific thing once, so they still fire late, within a day.
 */
export function isLateAutomationRun(
  schedule: AutomationSchedule,
  input: { readonly scheduledFor: string; readonly now: string },
): boolean {
  const scheduledForMs = Date.parse(input.scheduledFor);
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(scheduledForMs) || Number.isNaN(nowMs)) return false;
  const latenessMs = nowMs - scheduledForMs;
  return schedule.kind === "once"
    ? latenessMs > AUTOMATION_MISSED_ONCE_GRACE_MS
    : latenessMs > AUTOMATION_LATE_RUN_TOLERANCE_MS;
}

/**
 * Whether a claimed run still deserves to be launched after a restart. A claim
 * with no thread means the server died between the two; a claim from hours ago
 * belongs to a machine that was off, and replaying its prompt on wake would
 * surprise the user.
 */
export function shouldResumeClaimedRun(input: {
  readonly occurredAt: string;
  readonly nowMs: number;
}): boolean {
  const occurredAtMs = Date.parse(input.occurredAt);
  if (Number.isNaN(occurredAtMs)) return false;
  const ageMs = input.nowMs - occurredAtMs;
  return ageMs >= 0 && ageMs <= AUTOMATION_CLAIM_RESUME_WINDOW_MS;
}

function toAutomation(row: ProjectionAutomation): Automation {
  return {
    id: row.automationId,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    projectId: row.projectId,
    ownsProject: row.ownsProject,
    modelSelection: row.modelSelection,
    runtimeMode: row.runtimeMode,
    envMode: row.envMode,
    baseBranch: row.baseBranch,
    startFromOrigin: row.startFromOrigin,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastRun: row.lastRun,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as Automation;
}

interface AutomationRunRow {
  readonly thread_id: string;
  readonly automation_id: string;
  readonly scheduled_for: string;
  readonly reason: string;
  readonly created_at: string;
  readonly hidden_at: string | null;
}

function toAutomationRun(row: AutomationRunRow): AutomationRun {
  return {
    threadId: ThreadId.make(row.thread_id),
    automationId: row.automation_id as AutomationId,
    scheduledFor: row.scheduled_for,
    reason: row.reason as AutomationRunReason,
    createdAt: row.created_at,
    hiddenAt: row.hidden_at,
  } as AutomationRun;
}

function automationError(message: string, automationId?: AutomationId) {
  return (cause: unknown) =>
    new AutomationError({
      message,
      ...(automationId === undefined ? {} : { automationId }),
      cause,
    });
}

/**
 * The runs table sits outside the migration ledger on purpose: fork ids in
 * that ledger mask upstream's later migrations (see
 * docs/internals/legacy-orchestration-migration.md). Run threads created
 * before V2 carry `automation_id` and `hidden_at` on the V1 thread rows the
 * V2 snapshot copied, so the first creation backfills from them.
 */
const ensureRunsTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automation_runs'
  `;
  if (existing.length > 0) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE automation_runs (
          thread_id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL,
          scheduled_for TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          hidden_at TEXT
        )
      `;
      yield* sql`
        CREATE INDEX idx_automation_runs_automation_id ON automation_runs(automation_id)
      `;
      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      if (threadColumns.some((column) => column.name === "automation_id")) {
        yield* sql`
          INSERT OR IGNORE INTO automation_runs (
            thread_id, automation_id, scheduled_for, reason, created_at, hidden_at
          )
          SELECT thread_id, automation_id, created_at, 'schedule', created_at, hidden_at
          FROM projection_threads
          WHERE automation_id IS NOT NULL AND deleted_at IS NULL
        `;
      }
    }),
  );
});

export const layer = Layer.effect(
  AutomationService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const repository = yield* ProjectionAutomationRepository;
    const projects = yield* ProjectService.ProjectService;
    const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
    const threadLifecycle = yield* ThreadLifecycleService.ThreadLifecycleService;
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
    const scheduler = yield* Scheduler.Scheduler;

    yield* ensureRunsTable.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not prepare the automation runs table", { cause }),
      ),
    );

    // Mutations and claims share one permit: the claim rules (overlap, paused,
    // missed) read state that an edit or another claim could change underneath.
    const permit = yield* Semaphore.make(1);
    const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) => permit.withPermits(1)(effect);

    // Sliding(1): every signal re-reads the whole snapshot, so a slow
    // subscriber only ever needs the latest one.
    const changes = yield* PubSub.sliding<void>(1);
    const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

    const listRuns = (automationId?: AutomationId) =>
      (automationId === undefined
        ? sql<AutomationRunRow>`SELECT * FROM automation_runs ORDER BY created_at`
        : sql<AutomationRunRow>`
            SELECT * FROM automation_runs
            WHERE automation_id = ${automationId}
            ORDER BY created_at
          `
      ).pipe(Effect.map((rows) => rows.map(toAutomationRun)));

    const snapshot = Effect.gen(function* () {
      const automations = yield* repository.listActive();
      const active = new Set<string>(automations.map((automation) => automation.automationId));
      const runs = yield* listRuns();
      return {
        automations: automations.map(toAutomation),
        runs: runs.filter((run) => active.has(run.automationId)),
      } satisfies AutomationSnapshot;
    }).pipe(Effect.mapError(automationError("Could not read automations.")));

    const requireAutomation = (automationId: AutomationId) =>
      repository.getById({ automationId }).pipe(
        Effect.mapError(automationError("Could not read the automation.", automationId)),
        Effect.flatMap((row) =>
          Option.isSome(row) && row.value.deletedAt === null
            ? Effect.succeed(row.value)
            : Effect.fail(
                new AutomationError({
                  message: `Automation '${automationId}' does not exist.`,
                  automationId,
                }),
              ),
        ),
      );

    const save = (row: ProjectionAutomation) =>
      repository
        .upsert(row)
        .pipe(Effect.mapError(automationError("Could not save the automation.", row.automationId)));

    const threadIsWorking = (run: AutomationRun, nowMs: number) =>
      threadManagement.getThreadShell(run.threadId).pipe(
        Effect.map((shell) => {
          if (shell === null) {
            // Claimed, not launched yet.
            return nowMs - Date.parse(run.createdAt) < CLAIMED_RUN_LAUNCH_GRACE_MS;
          }
          if (shell.deletedAt !== null || shell.archivedAt !== null) return false;
          return shell.activeRunId !== null || (shell.activityRunStatus ?? null) !== null;
        }),
        Effect.orElseSucceed(() => false),
      );

    /**
     * Whether any run of this automation is still working, so the next
     * occurrence must not start a second agent beside it. Asked of every run
     * thread rather than of `lastRun`, because a skip overwrites `lastRun`
     * with no thread id.
     */
    const hasWorkingRun = Effect.fn("AutomationService.hasWorkingRun")(function* (
      automationId: AutomationId,
    ) {
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      const runs = yield* listRuns(automationId);
      for (const run of runs) {
        if (yield* threadIsWorking(run, nowMs)) return true;
      }
      return false;
    });

    /**
     * The branch a run starts from. An automation that names one always gets
     * it; otherwise the project's current checkout decides, resolved at run
     * time so a schedule written months ago still starts somewhere sensible.
     */
    const resolveBaseBranch = (automation: ProjectionAutomation, workspaceRoot: string) =>
      automation.baseBranch !== null
        ? Effect.succeed<string | null>(automation.baseBranch)
        : gitWorkflow.localStatus({ cwd: workspaceRoot }).pipe(
            Effect.map((status) => status.refName),
            Effect.orElseSucceed(() => null),
          );

    const launchRun = Effect.fn("AutomationService.launchRun")(function* (
      automation: ProjectionAutomation,
      run: { readonly threadId: ThreadId; readonly scheduledFor: string },
    ) {
      const project = yield* projects
        .getById(automation.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(project)) {
        return yield* Effect.logWarning("Automation run skipped: its project is gone", {
          automationId: automation.automationId,
          projectId: automation.projectId,
        });
      }
      const baseBranch = yield* resolveBaseBranch(automation, project.value.workspaceRoot);
      yield* threadLaunch.launch({
        commandId: automationRunCommandId(automation.automationId, run.scheduledFor),
        threadId: run.threadId,
        projectId: automation.projectId,
        title: automation.title,
        modelSelection: automation.modelSelection,
        runtimeMode: automation.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        // A worktree needs a base to cut from; without one the run works in
        // the checkout, the same answer V1 gave.
        workspaceStrategy:
          automation.envMode === "worktree" && baseBranch !== null
            ? {
                type: "worktree",
                baseRef: baseBranch,
                startFromOrigin: automation.startFromOrigin,
              }
            : { type: "root", ...(baseBranch === null ? {} : { branch: baseBranch }) },
        initialMessage: {
          messageId: automationRunMessageId(automation.automationId, run.scheduledFor),
          text: automation.prompt,
          attachments: [],
        },
        createdBy: "system",
        creationSource: "server",
      });
    });

    const launchRunSafely = (
      automation: ProjectionAutomation,
      run: { readonly threadId: ThreadId; readonly scheduledFor: string },
    ) =>
      launchRun(automation, run).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : // The schedule has already moved on, so a failed launch is
              // history, not a retry: the automation page offers Run now.
              Effect.logWarning("Automation run failed to start", {
                automationId: automation.automationId,
                scheduledFor: run.scheduledFor,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    /**
     * Decides one attempt: a claim (the run owns a fresh hidden thread) or a
     * skip, and either way advances `nextRunAt`, so a backlog of missed
     * occurrences collapses into one step instead of firing in a burst.
     * Returns the claimed run for the caller to launch outside the permit.
     */
    const claim = Effect.fn("AutomationService.claim")(function* (input: {
      readonly automationId: AutomationId;
      readonly scheduledFor: string;
      readonly reason: AutomationRunReason;
    }) {
      const automation = yield* requireAutomation(input.automationId);
      const now = yield* nowIso;
      const nextRunAt = resolveAutomationNextRunAt(automation.schedule, now);
      const record = (outcome: "skipped-overlap" | "skipped-disabled" | "missed") =>
        save({
          ...automation,
          nextRunAt,
          lastRun: {
            scheduledFor: input.scheduledFor,
            occurredAt: now,
            outcome,
            reason: input.reason,
            threadId: null,
          },
          updatedAt: now,
        }).pipe(Effect.as(null));

      if (!automation.enabled && input.reason === "schedule") {
        return yield* record("skipped-disabled");
      }
      const working = yield* hasWorkingRun(input.automationId).pipe(
        Effect.mapError(automationError("Could not read automation runs.", input.automationId)),
      );
      if (working) {
        if (input.reason === "manual") {
          return yield* new AutomationError({
            message: `Automation '${input.automationId}' is already running.`,
            automationId: input.automationId,
          });
        }
        return yield* record("skipped-overlap");
      }
      if (
        input.reason === "schedule" &&
        isLateAutomationRun(automation.schedule, { scheduledFor: input.scheduledFor, now })
      ) {
        return yield* record("missed");
      }

      const threadId = ThreadId.make(yield* randomUuidV4);
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
            INSERT INTO automation_runs (
              thread_id, automation_id, scheduled_for, reason, created_at, hidden_at
            ) VALUES (
              ${threadId}, ${input.automationId}, ${input.scheduledFor}, ${input.reason}, ${now}, ${now}
            )
          `;
            yield* repository.upsert({
              ...automation,
              nextRunAt,
              lastRun: {
                scheduledFor: input.scheduledFor,
                occurredAt: now,
                outcome: "claimed",
                reason: input.reason,
                threadId,
              },
              updatedAt: now,
            });
          }),
        )
        .pipe(Effect.mapError(automationError("Could not claim the run.", input.automationId)));
      return { automation, run: { threadId, scheduledFor: input.scheduledFor } };
    });

    const claimAndLaunch = (input: Parameters<typeof claim>[0]) =>
      serialized(claim(input)).pipe(
        Effect.tap(() => notifyChanged),
        Effect.flatMap((claimed) =>
          claimed === null
            ? Effect.void
            : launchRunSafely(claimed.automation, claimed.run).pipe(Effect.andThen(notifyChanged)),
        ),
      );

    const runDueAutomations = Effect.gen(function* () {
      const dueAt = yield* nowIso;
      const due = yield* repository.listDue({ dueAt, limit: CLAIM_BATCH_LIMIT });
      yield* Effect.forEach(
        due,
        (automation) =>
          automation.nextRunAt === null
            ? Effect.void
            : claimAndLaunch({
                automationId: automation.automationId,
                scheduledFor: automation.nextRunAt,
                reason: "schedule",
              }).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Automation claim failed", {
                    automationId: automation.automationId,
                    cause,
                  }),
                ),
              ),
        { concurrency: 1, discard: true },
      );
    });

    // A claim whose thread never appeared means the server stopped between
    // the two. The launch command id is derived from the claim, so finishing
    // it now cannot start the run twice. Only claims from before this start
    // count: a claim made since is this process's own, mid-launch.
    const startedAtMs = DateTime.toEpochMillis(yield* DateTime.now);
    yield* Effect.gen(function* () {
      for (const automation of yield* repository.listActive()) {
        const lastRun = automation.lastRun;
        if (lastRun === null || lastRun.outcome !== "claimed" || lastRun.threadId === null) {
          continue;
        }
        if (Date.parse(lastRun.occurredAt) >= startedAtMs) continue;
        if (!shouldResumeClaimedRun({ occurredAt: lastRun.occurredAt, nowMs: startedAtMs })) {
          continue;
        }
        const threadId = ThreadId.make(lastRun.threadId);
        const shell = yield* threadManagement
          .getThreadShell(threadId)
          .pipe(Effect.orElseSucceed(() => null));
        if (shell !== null) continue;
        yield* Effect.logInfo("Resuming an automation run claimed before shutdown", {
          automationId: automation.automationId,
          scheduledFor: lastRun.scheduledFor,
        });
        yield* launchRunSafely(automation, { threadId, scheduledFor: lastRun.scheduledFor });
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not resume claimed automation runs", { cause }),
      ),
      Effect.forkScoped,
    );

    // Deliberately independent of client demand and host power policy: a
    // scheduled run has to fire with no client connected.
    yield* scheduler.register("automations", runDueAutomations);

    const create: AutomationService["Service"]["create"] = (input) =>
      serialized(
        Effect.gen(function* () {
          const existing = yield* repository
            .getById({ automationId: input.automationId })
            .pipe(Effect.mapError(automationError("Could not read the automation.")));
          if (Option.isSome(existing)) {
            return yield* new AutomationError({
              message: `Automation '${input.automationId}' already exists.`,
              automationId: input.automationId,
            });
          }
          const now = yield* nowIso;
          if (input.project.kind === "owned") {
            // The automation's own project, in a directory named after it under
            // Vetra home. Only the server knows that layout.
            yield* projects
              .create({
                commandId: CommandId.make(`automation-project:${input.automationId}`),
                projectId: input.project.projectId,
                title: input.title,
                workspaceRoot: path.join(config.automationsDir, input.automationId),
                createWorkspaceRootIfMissing: true,
                defaultModelSelection: input.modelSelection,
              })
              .pipe(
                Effect.mapError(
                  automationError("Could not create the automation's project.", input.automationId),
                ),
              );
          } else {
            const project = yield* projects
              .getById(input.project.projectId)
              .pipe(Effect.mapError(automationError("Could not read the project.")));
            if (Option.isNone(project)) {
              return yield* new AutomationError({
                message: `Project '${input.project.projectId}' does not exist.`,
                automationId: input.automationId,
              });
            }
          }
          yield* save({
            automationId: input.automationId,
            projectId: input.project.projectId,
            ownsProject: input.project.kind === "owned",
            title: input.title,
            prompt: input.prompt,
            schedule: input.schedule,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            envMode: input.envMode,
            baseBranch: input.baseBranch,
            startFromOrigin: input.startFromOrigin,
            enabled: input.enabled,
            nextRunAt: resolveAutomationNextRunAt(input.schedule, now),
            lastRun: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          } as ProjectionAutomation);
        }),
      ).pipe(Effect.andThen(notifyChanged));

    const update: AutomationService["Service"]["update"] = (input) =>
      serialized(
        Effect.gen(function* () {
          const automation = yield* requireAutomation(input.automationId);
          const now = yield* nowIso;
          yield* save({
            ...automation,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
            ...(input.envMode !== undefined ? { envMode: input.envMode } : {}),
            ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
            ...(input.startFromOrigin !== undefined
              ? { startFromOrigin: input.startFromOrigin }
              : {}),
            // A schedule edit re-anchors the next run to now. Leaving the old
            // nextRunAt standing would fire the new prompt on the old timetable.
            nextRunAt:
              input.schedule !== undefined
                ? resolveAutomationNextRunAt(input.schedule, now)
                : automation.nextRunAt,
            updatedAt: now,
          });
        }),
      ).pipe(Effect.andThen(notifyChanged));

    const setEnabled = (input: AutomationTargetInput, enabled: boolean) =>
      serialized(
        Effect.gen(function* () {
          const automation = yield* requireAutomation(input.automationId);
          const now = yield* nowIso;
          yield* save({
            ...automation,
            enabled,
            // Recomputed from now: a schedule that went stale while paused
            // must not fire the moment it is resumed.
            nextRunAt: enabled
              ? resolveAutomationNextRunAt(automation.schedule, now)
              : automation.nextRunAt,
            updatedAt: now,
          });
        }),
      ).pipe(Effect.andThen(notifyChanged));

    const deleteAutomation: AutomationService["Service"]["delete"] = (input) =>
      serialized(
        Effect.gen(function* () {
          const automation = yield* requireAutomation(input.automationId);
          const runs = yield* listRuns(input.automationId).pipe(
            Effect.mapError(automationError("Could not read automation runs.")),
          );
          const liveRuns: Array<AutomationRun> = [];
          for (const run of runs) {
            const shell = yield* threadManagement
              .getThreadShell(run.threadId)
              .pipe(Effect.orElseSucceed(() => null));
            if (shell !== null && shell.deletedAt === null) liveRuns.push(run);
          }
          const revealedRuns = liveRuns.filter((run) => run.hiddenAt === null);
          // Deleting an owned project takes every thread in it, revealed runs
          // included. Runs the user promoted to the sidebar are not
          // collateral, so that needs saying out loud.
          if (automation.ownsProject && revealedRuns.length > 0 && input.force !== true) {
            return yield* new AutomationError({
              message: `Automation '${input.automationId}' has ${revealedRuns.length} run(s) in the sidebar that would be deleted with its project. Pass force=true to delete them.`,
              automationId: input.automationId,
            });
          }
          if (automation.ownsProject) {
            yield* projects
              .delete({
                commandId: CommandId.make(`automation-delete:${input.automationId}`),
                projectId: automation.projectId,
                force: true,
              })
              .pipe(
                Effect.catchTag("ProjectNotFoundError", () => Effect.void),
                Effect.mapError(
                  automationError("Could not delete the automation's project.", input.automationId),
                ),
              );
          } else {
            // In a project of the user's own, hidden runs are reachable only
            // through this automation, so they go with it. Revealed runs are
            // in the sidebar and stay.
            yield* Effect.forEach(
              liveRuns.filter((run) => run.hiddenAt !== null),
              (run) =>
                threadLifecycle.delete({
                  commandId: CommandId.make(
                    `automation-delete:${input.automationId}:thread:${run.threadId}`,
                  ),
                  threadId: run.threadId,
                }),
              { concurrency: 1, discard: true },
            ).pipe(
              Effect.mapError(
                automationError("Could not delete the automation's runs.", input.automationId),
              ),
            );
          }
          const now = yield* nowIso;
          yield* save({ ...automation, deletedAt: now, updatedAt: now });
          yield* sql`DELETE FROM automation_runs WHERE automation_id = ${input.automationId}`.pipe(
            Effect.mapError(automationError("Could not delete automation runs.")),
          );
        }),
      ).pipe(Effect.andThen(notifyChanged));

    const runNow: AutomationService["Service"]["runNow"] = (input) =>
      Effect.gen(function* () {
        yield* claimAndLaunch({
          automationId: input.automationId,
          scheduledFor: yield* nowIso,
          reason: "manual",
        });
      });

    const setRunHidden: AutomationService["Service"]["setRunHidden"] = (input) =>
      Effect.gen(function* () {
        const now = yield* nowIso;
        // Hiding keeps the original stamp; revealing clears it.
        yield* (
          input.hidden
            ? sql`
                UPDATE automation_runs SET hidden_at = COALESCE(hidden_at, ${now})
                WHERE thread_id = ${input.threadId}
              `
            : sql`UPDATE automation_runs SET hidden_at = NULL WHERE thread_id = ${input.threadId}`
        ).pipe(Effect.mapError(automationError("Could not update the run.")));
        yield* notifyChanged;
      });

    const subscribe: AutomationService["Service"]["subscribe"] = () =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before the first read so a change between the two is
          // buffered rather than dropped.
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(snapshot),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => snapshot)),
          );
        }),
      );

    return AutomationService.of({
      subscribe,
      create,
      update,
      enable: (input) => setEnabled(input, true),
      disable: (input) => setEnabled(input, false),
      delete: deleteAutomation,
      runNow,
      setRunHidden,
    });
  }),
);
