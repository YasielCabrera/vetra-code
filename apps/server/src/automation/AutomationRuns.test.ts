import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ScheduledTaskId,
  type AutomationRunsSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as SqlitePersistence from "../persistence/Layers/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as AutomationRuns from "./AutomationRuns.ts";

const PROJECT_ID = ProjectId.make("project-1");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const TASK_ID = ScheduledTaskId.make("scheduled-task:daily");

const dependencies = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeedSome({ workspaceRoot: "/repo" } as never),
  }),
  Layer.mock(GitWorkflowService.GitWorkflowService)({
    localStatus: () => Effect.succeed({ refName: "develop" } as never),
  }),
);

/** The service plus a recording launch underneath the tracking wrapper. */
const makeHarness = Effect.gen(function* () {
  const launches = yield* Ref.make<ReadonlyArray<ThreadLaunchService.ThreadLaunchInput>>([]);
  const runsContext = yield* Layer.build(AutomationRuns.layer.pipe(Layer.provide(dependencies)));
  const runs = Context.get(runsContext, AutomationRuns.AutomationRuns);
  const launchContext = yield* Layer.build(
    AutomationRuns.trackingThreadLaunchLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeedContext(runsContext),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: (input) =>
              Ref.update(launches, (all) => [...all, input]).pipe(Effect.as({} as never)),
          }),
        ),
      ),
    ),
  );
  const launcher = Context.get(launchContext, ThreadLaunchService.ThreadLaunchService);
  const snapshot = Stream.runHead(runs.subscribe()).pipe(
    Effect.map((head) => Option.getOrThrow(head) as AutomationRunsSnapshot),
  );
  return { runs, launcher, launches, snapshot };
});

const scheduledLaunch = (commandId: string) =>
  ({
    commandId: CommandId.make(commandId),
    projectId: PROJECT_ID,
    title: "Daily briefing",
    modelSelection: { instanceId: "codex", model: "gpt-5" } as never,
    runtimeMode: "full-access",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
    initialMessage: {
      messageId: MessageId.make(`message:${commandId}`),
      scheduledTaskId: TASK_ID,
      text: "Summarize what changed.",
      attachments: [],
    },
    createdBy: "user",
    creationSource: "web",
  }) satisfies ThreadLaunchService.ThreadLaunchInput;

const insertTask = (sql: SqlClient.SqlClient, taskId: string) =>
  sql`INSERT INTO scheduled_tasks ${sql.insert({
    task_id: taskId,
    title: "task",
    prompt: "Run task",
    enabled: 1,
    schedule_json: '{"type":"fixed_time","timeOfDay":"09:00"}',
    project_id: PROJECT_ID,
    thread_id: null,
    workspace_strategy_json: '{"type":"root"}',
    model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
    runtime_mode: "full-access",
    interaction_mode: "default",
    created_by: "user",
    creation_source: "web",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    next_run_at: null,
    last_run_at: null,
    last_run_status: "never",
    last_run_error: null,
    run_count: 0,
  })}`;

it.effect("records a scheduled launch as a hidden run on a stable thread", () =>
  Effect.gen(function* () {
    const { launcher, launches, snapshot } = yield* makeHarness;
    yield* launcher.launch(scheduledLaunch("scheduled-task:daily:1:scheduled"));
    // A retried launch of the same fire reuses the thread instead of adding a run.
    yield* launcher.launch(scheduledLaunch("scheduled-task:daily:1:scheduled"));

    const [first, retry] = yield* Ref.get(launches);
    assert.isDefined(first?.threadId);
    assert.equal(retry?.threadId, first?.threadId);
    const { runs } = yield* snapshot;
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.threadId, first?.threadId);
    assert.equal(runs[0]?.scheduledTaskId, TASK_ID);
    assert.isNotNull(runs[0]?.hiddenAt);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("leaves launches that are not scheduled runs alone", () =>
  Effect.gen(function* () {
    const { launcher, launches, snapshot } = yield* makeHarness;
    const { initialMessage: _, ...plain } = scheduledLaunch("thread-1");
    yield* launcher.launch(plain);

    assert.isUndefined((yield* Ref.get(launches))[0]?.threadId);
    assert.deepStrictEqual((yield* snapshot).runs, []);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("moves a run into the sidebar and back", () =>
  Effect.gen(function* () {
    const { runs, launcher, launches, snapshot } = yield* makeHarness;
    yield* launcher.launch(scheduledLaunch("scheduled-task:daily:1:scheduled"));
    const threadId = (yield* Ref.get(launches))[0]!.threadId!;

    yield* runs.setHidden({ threadId, hidden: false });
    assert.isNull((yield* snapshot).runs[0]?.hiddenAt);
    yield* runs.setHidden({ threadId, hidden: true });
    assert.isNotNull((yield* snapshot).runs[0]?.hiddenAt);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("hands back the hidden runs of a deleted task and keeps the rest", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { runs, launcher, launches, snapshot } = yield* makeHarness;
    yield* insertTask(sql, "scheduled-task:kept");
    yield* launcher.launch(scheduledLaunch("scheduled-task:daily:1:scheduled"));
    yield* launcher.launch(scheduledLaunch("scheduled-task:daily:2:scheduled"));
    const [hidden, revealed] = (yield* Ref.get(launches)).map((launch) => launch.threadId!);
    yield* runs.setHidden({ threadId: revealed!, hidden: false });
    yield* runs.recordLaunch({
      threadId: "kept-run" as never,
      scheduledTaskId: ScheduledTaskId.make("scheduled-task:kept"),
    });

    // scheduled-task:daily was never saved, so both of its runs are orphans.
    assert.deepStrictEqual(yield* runs.pruneDeletedTasks(), [hidden!]);
    assert.deepStrictEqual(
      (yield* snapshot).runs.map((run) => run.threadId),
      ["kept-run"],
    );
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("moves pre-existing automations onto scheduled tasks once", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const legacy = (id: string, cron: string, envMode: string) =>
      sql`INSERT INTO projection_automations ${sql.insert({
        automation_id: id,
        project_id: PROJECT_ID,
        owns_project: 0,
        title: "Daily briefing",
        prompt: "Summarize what changed.",
        schedule_json: encodeJson({ kind: "recurring", cron, timeZone: "UTC" }),
        model: '{"instanceId":"codex","model":"gpt-5"}',
        runtime_mode: "full-access",
        env_mode: envMode,
        base_branch: null,
        start_from_origin: 1,
        enabled: 1,
        next_run_at: null,
        last_run_json: encodeJson({
          scheduledFor: "2026-10-01T09:00:00.000Z",
          occurredAt: "2026-10-01T09:00:01.000Z",
          outcome: "claimed",
          reason: "schedule",
          threadId: "old-run",
        }),
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        deleted_at: null,
      })}`;
    yield* legacy("automation-daily", "0 9 * * *", "worktree");
    yield* legacy("automation-monthly", "0 9 1 * *", "local");

    yield* makeHarness;
    // A second start must not resurrect a task the user deleted meanwhile.
    yield* sql`DELETE FROM scheduled_tasks WHERE task_id = 'automation-monthly'`;
    yield* makeHarness;

    const tasks = yield* sql<{
      readonly task_id: string;
      readonly title: string;
      readonly enabled: number;
      readonly schedule_json: string;
      readonly workspace_strategy_json: string;
      readonly last_run_status: string;
      readonly last_run_at: string | null;
    }>`SELECT task_id, title, enabled, schedule_json, workspace_strategy_json, last_run_status,
         last_run_at FROM scheduled_tasks ORDER BY task_id`;
    assert.equal(tasks.length, 1);
    const [daily] = tasks;
    assert.equal(daily?.task_id, "automation-daily");
    assert.equal(daily?.enabled, 1);
    assert.equal(daily?.last_run_status, "succeeded");
    assert.equal(daily?.last_run_at, "2026-10-01T09:00:01.000Z");
    assert.deepStrictEqual(decodeJson(daily!.workspace_strategy_json), {
      type: "worktree",
      baseRef: "develop",
      startFromOrigin: true,
    });
    assert.equal((decodeJson(daily!.schedule_json) as { type: string }).type, "fixed_time");
    const remaining = yield* sql`
      SELECT automation_id FROM projection_automations WHERE deleted_at IS NULL
    `;
    assert.deepStrictEqual(remaining, []);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("pauses a migrated automation whose schedule has no equivalent", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_automations ${sql.insert({
      automation_id: "automation-monthly",
      project_id: PROJECT_ID,
      owns_project: 0,
      title: "Monthly",
      prompt: "Report.",
      schedule_json: encodeJson({ kind: "recurring", cron: "0 9 1 * *", timeZone: "UTC" }),
      model: '{"instanceId":"codex","model":"gpt-5"}',
      runtime_mode: "full-access",
      env_mode: "local",
      base_branch: null,
      start_from_origin: 0,
      enabled: 1,
      next_run_at: null,
      last_run_json: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      deleted_at: null,
    })}`;
    yield* makeHarness;
    const [task] = yield* sql<{ readonly enabled: number; readonly title: string }>`
      SELECT enabled, title FROM scheduled_tasks WHERE task_id = 'automation-monthly'
    `;
    assert.equal(task?.enabled, 0);
    assert.equal(task?.title, "Monthly (schedule needs review)");
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("keeps V1 run threads hidden after the V2 cutover", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{
      readonly name: string;
      readonly notnull: number;
      readonly type: string;
    }>`PRAGMA table_info(projection_threads)`;
    const row: Record<string, unknown> = {};
    for (const column of columns) {
      if (column.notnull === 1) row[column.name] = column.type === "INTEGER" ? 0 : "";
    }
    for (const [threadId, hiddenAt] of [
      ["v1-hidden", "2026-09-01T08:00:00.000Z"],
      ["v1-revealed", null],
    ] as const) {
      yield* sql`INSERT INTO projection_threads ${sql.insert({
        ...row,
        thread_id: threadId,
        project_id: PROJECT_ID,
        created_at: "2026-09-01T08:00:00.000Z",
        updated_at: "2026-09-01T08:00:00.000Z",
        deleted_at: null,
        automation_id: "automation-1",
        hidden_at: hiddenAt,
      })}`;
    }
    const { snapshot } = yield* makeHarness;

    assert.deepStrictEqual(
      (yield* snapshot).runs.map((run) => [run.threadId, run.hiddenAt]),
      [
        ["v1-hidden", "2026-09-01T08:00:00.000Z"],
        ["v1-revealed", null],
      ],
    );
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);
