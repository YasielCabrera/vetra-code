import * as NodeCrypto from "node:crypto";

import {
  AutomationError,
  type AutomationRun,
  type AutomationRunVisibilityInput,
  type AutomationRunsSnapshot,
  CommandId,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ScheduledTaskId,
  ScheduledTaskSchedule,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadLifecycleService from "../orchestration-v2/ThreadLifecycleService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { nextScheduledRunAt } from "../scheduledTasks/Schedule.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { convertLegacyAutomationSchedule } from "./legacyAutomationSchedule.ts";

/**
 * Automations are upstream's scheduled tasks, unmodified. This service adds
 * the one thing they lack: knowing which threads a task launched, so those
 * runs can be kept out of the sidebar and listed under their automation.
 *
 * Runs are recorded by `trackingThreadLaunchLayer`, which wraps the
 * ThreadLaunchService handed to ScheduledTaskService, and pruned by
 * `cleanupLive` when their task is deleted. `automation_runs` sits outside the
 * migration ledger on purpose: fork ids in that ledger mask upstream's later
 * migrations (see docs/internals/legacy-orchestration-migration.md).
 */
export class AutomationRuns extends Context.Service<
  AutomationRuns,
  {
    /** Emits every tracked run on subscribe and again after every change. */
    readonly subscribe: () => Stream.Stream<AutomationRunsSnapshot, AutomationError>;
    readonly setHidden: (
      input: AutomationRunVisibilityInput,
    ) => Effect.Effect<void, AutomationError>;
    /** Records a scheduled launch's thread, hidden, before the thread exists. */
    readonly recordLaunch: (input: {
      readonly threadId: ThreadId;
      readonly scheduledTaskId: ScheduledTaskId;
    }) => Effect.Effect<void, AutomationError>;
    /**
     * Forgets the runs of tasks that no longer exist and returns the threads
     * among them that were still hidden, which nothing else can reach.
     */
    readonly pruneDeletedTasks: () => Effect.Effect<ReadonlyArray<ThreadId>, AutomationError>;
  }
>()("t3/automation/AutomationRuns") {}

interface AutomationRunRow {
  readonly thread_id: string;
  readonly automation_id: string;
  readonly created_at: string;
  readonly hidden_at: string | null;
}

function toRun(row: AutomationRunRow): AutomationRun {
  return {
    threadId: ThreadId.make(row.thread_id),
    scheduledTaskId: ScheduledTaskId.make(row.automation_id),
    createdAt: row.created_at,
    hiddenAt: row.hidden_at,
  } as AutomationRun;
}

const automationError = (message: string) => (cause: unknown) =>
  new AutomationError({ message, cause });

/**
 * The thread id a scheduled launch gets, derived from its command id so a
 * retried launch reuses the same thread instead of recording a second run.
 */
export function automationRunThreadId(commandId: string): ThreadId {
  const hex = NodeCrypto.createHash("sha256").update(commandId).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return ThreadId.make(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
}

/**
 * Creates `automation_runs` the first time. Run threads from before the V2
 * cutover carry their owner and hidden state on the V1 thread rows the V2
 * snapshot copied, so the first creation backfills from them.
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

interface LegacyAutomationRow {
  readonly automation_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly prompt: string;
  readonly schedule_json: string;
  readonly model: string;
  readonly runtime_mode: string;
  readonly env_mode: string;
  readonly base_branch: string | null;
  readonly start_from_origin: number;
  readonly enabled: number;
  readonly last_run_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const decodeJsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeSchedule = Schema.encodeSync(Schema.fromJsonString(ScheduledTaskSchedule));
const encodeWorkspaceStrategy = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationV2ThreadLaunchWorkspaceStrategy),
);

function parseJson(value: string | null): unknown {
  return value === null ? null : Option.getOrNull(decodeJsonOption(value));
}

/**
 * Moves automations created before automations became scheduled tasks into
 * `scheduled_tasks`, keeping their ids so their tracked runs stay attached.
 * Each migrated row is marked deleted in the old table, so the move happens
 * once and a task the user later deletes does not come back.
 */
const migrateLegacyAutomations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectService.ProjectService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('projection_automations', 'scheduled_tasks')
  `;
  if (tables.length < 2) return;
  const legacy = yield* sql<LegacyAutomationRow>`
    SELECT automation_id, project_id, title, prompt, schedule_json, model, runtime_mode,
      env_mode, base_branch, start_from_origin, enabled, last_run_json, created_at, updated_at
    FROM projection_automations
    WHERE deleted_at IS NULL
  `;
  if (legacy.length === 0) return;

  const now = yield* DateTime.now;
  const nowIso = DateTime.formatIso(now);
  const localNow = yield* DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);
  const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  for (const row of legacy) {
    const converted = convertLegacyAutomationSchedule(parseJson(row.schedule_json), {
      serverTimeZone,
      nowMs: DateTime.toEpochMillis(now),
    });
    // A schedule with no faithful equivalent stays paused, so it never runs on
    // a timetable the user did not choose.
    const enabled = row.enabled === 1 && converted.exact;
    const title = converted.exact
      ? row.title
      : `${row.title} (schedule needs review)`.slice(0, 200);

    let workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy = { type: "root" };
    if (row.env_mode === "worktree") {
      let baseRef = row.base_branch;
      if (baseRef === null) {
        const project = yield* projects
          .getById(row.project_id as never)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        baseRef = Option.isSome(project)
          ? yield* gitWorkflow.localStatus({ cwd: project.value.workspaceRoot }).pipe(
              Effect.map((status) => status.refName),
              Effect.orElseSucceed(() => null),
            )
          : null;
      }
      workspaceStrategy = {
        type: "worktree",
        baseRef: baseRef ?? "main",
        startFromOrigin: row.start_from_origin === 1,
      };
    }

    const lastRun = parseJson(row.last_run_json) as {
      occurredAt?: unknown;
      outcome?: unknown;
    } | null;
    const lastRunAt =
      lastRun !== null && lastRun.outcome === "claimed" && typeof lastRun.occurredAt === "string"
        ? lastRun.occurredAt
        : null;
    const runCountRows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM automation_runs WHERE automation_id = ${row.automation_id}
    `;
    const next = enabled ? nextScheduledRunAt(converted.schedule, localNow) : null;

    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT OR IGNORE INTO scheduled_tasks (
            task_id, title, prompt, enabled, schedule_json, project_id, thread_id,
            workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode,
            created_by, creation_source, created_at, updated_at, next_run_at, last_run_at,
            last_run_status, last_run_error, run_count
          ) VALUES (
            ${row.automation_id}, ${title}, ${row.prompt}, ${enabled ? 1 : 0},
            ${encodeSchedule(converted.schedule)}, ${row.project_id}, ${null},
            ${encodeWorkspaceStrategy(workspaceStrategy)}, ${row.model}, ${row.runtime_mode}, ${"default"},
            ${"user"}, ${"web"}, ${row.created_at}, ${nowIso},
            ${next === null ? null : DateTime.formatIso(DateTime.toUtc(next))}, ${lastRunAt},
            ${lastRunAt === null ? "never" : "succeeded"}, ${null}, ${runCountRows[0]?.count ?? 0}
          )
        `;
        yield* sql`
          UPDATE projection_automations SET deleted_at = ${nowIso}
          WHERE automation_id = ${row.automation_id}
        `;
      }),
    );
    yield* Effect.logInfo("Moved an automation onto scheduled tasks", {
      automationId: row.automation_id,
      enabled,
      exactSchedule: converted.exact,
    });
  }
});

export const layer = Layer.effect(
  AutomationRuns,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* ensureRunsTable.pipe(
      Effect.andThen(migrateLegacyAutomations),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not prepare automation runs", { cause }),
      ),
    );

    // Sliding(1): every signal re-reads the whole list, so a slow subscriber
    // only ever needs the latest one.
    const changes = yield* PubSub.sliding<void>(1);
    const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

    const snapshot = sql<AutomationRunRow>`
      SELECT thread_id, automation_id, created_at, hidden_at
      FROM automation_runs
      ORDER BY created_at
    `.pipe(
      Effect.map((rows) => ({ runs: rows.map(toRun) }) satisfies AutomationRunsSnapshot),
      Effect.mapError(automationError("Could not read automation runs.")),
    );

    const recordLaunch: AutomationRuns["Service"]["recordLaunch"] = (input) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          INSERT OR IGNORE INTO automation_runs (
            thread_id, automation_id, scheduled_for, reason, created_at, hidden_at
          ) VALUES (
            ${input.threadId}, ${input.scheduledTaskId}, ${now}, ${"schedule"}, ${now}, ${now}
          )
        `;
        yield* notifyChanged;
      }).pipe(Effect.mapError(automationError("Could not record the automation run.")));

    const setHidden: AutomationRuns["Service"]["setHidden"] = (input) =>
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now);
        // Hiding keeps the original stamp; revealing clears it.
        yield* input.hidden
          ? sql`
              UPDATE automation_runs SET hidden_at = COALESCE(hidden_at, ${now})
              WHERE thread_id = ${input.threadId}
            `
          : sql`UPDATE automation_runs SET hidden_at = NULL WHERE thread_id = ${input.threadId}`;
        yield* notifyChanged;
      }).pipe(Effect.mapError(automationError("Could not update the run.")));

    const pruneDeletedTasks: AutomationRuns["Service"]["pruneDeletedTasks"] = () =>
      Effect.gen(function* () {
        // Raw ids rather than the decoded task list: a row that fails to
        // decode still exists and must keep its runs. An automation the
        // migration has not moved yet (it failed, or never ran) still owns its
        // runs too.
        const orphaned = yield* sql<AutomationRunRow>`
          SELECT thread_id, automation_id, created_at, hidden_at
          FROM automation_runs
          WHERE automation_id NOT IN (SELECT task_id FROM scheduled_tasks)
            AND automation_id NOT IN (
              SELECT automation_id FROM projection_automations WHERE deleted_at IS NULL
            )
        `;
        if (orphaned.length === 0) return [];
        yield* sql`
          DELETE FROM automation_runs
          WHERE thread_id IN ${sql.in(orphaned.map((row) => row.thread_id))}
        `;
        yield* notifyChanged;
        return orphaned
          .filter((row) => row.hidden_at !== null)
          .map((row) => ThreadId.make(row.thread_id));
      }).pipe(Effect.mapError(automationError("Could not prune automation runs.")));

    const subscribe: AutomationRuns["Service"]["subscribe"] = () =>
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

    return AutomationRuns.of({ subscribe, setHidden, recordLaunch, pruneDeletedTasks });
  }),
);

/**
 * The ThreadLaunchService handed to ScheduledTaskService. A launch carrying a
 * scheduled task id gets a thread id derived from its command id and is
 * recorded as a hidden run before the thread exists, so it never flashes into
 * the sidebar. Every other launch passes through untouched.
 */
export const trackingThreadLaunchLayer = Layer.effect(
  ThreadLaunchService.ThreadLaunchService,
  Effect.gen(function* () {
    const inner = yield* ThreadLaunchService.ThreadLaunchService;
    const runs = yield* AutomationRuns;
    return ThreadLaunchService.ThreadLaunchService.of({
      launch: (input) => {
        const scheduledTaskId = input.initialMessage?.scheduledTaskId;
        if (scheduledTaskId === undefined || input.threadId !== undefined) {
          return inner.launch(input);
        }
        const threadId = automationRunThreadId(input.commandId);
        return runs.recordLaunch({ threadId, scheduledTaskId }).pipe(
          // A run that cannot be recorded still runs; it just shows up as an
          // ordinary thread.
          Effect.catch((cause) =>
            Effect.logWarning("Could not record an automation run", { scheduledTaskId, cause }),
          ),
          Effect.andThen(inner.launch({ ...input, threadId })),
        );
      },
      retryPreparation: inner.retryPreparation,
    });
  }),
);

/**
 * Archives the hidden runs of deleted tasks. Driven by the task list stream,
 * so it covers every way a task goes away: the Automations page, upstream's
 * settings page, an agent's MCP call, or a deletion while the server was off.
 * Archived rather than deleted, so a run is never lost to an agent's call.
 */
export const cleanupLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const tasks = yield* ScheduledTaskService.ScheduledTaskService;
    const lifecycle = yield* ThreadLifecycleService.ThreadLifecycleService;
    const runs = yield* AutomationRuns;
    const archiveOrphans = runs.pruneDeletedTasks().pipe(
      Effect.flatMap((threadIds) =>
        Effect.forEach(
          threadIds,
          (threadId) =>
            lifecycle
              .archive({
                commandId: CommandId.make(`automation-run-archive:${threadId}`),
                threadId,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logDebug("Could not archive an orphaned automation run", {
                    threadId,
                    cause,
                  }),
                ),
              ),
          { concurrency: 1, discard: true },
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not clean up automation runs", { cause }),
      ),
    );
    yield* tasks.subscribeList().pipe(
      Stream.runForEach(() => archiveOrphans),
      Effect.catchCause((cause) => Effect.logWarning("Automation run cleanup stopped", { cause })),
      Effect.forkScoped,
    );
  }),
);
