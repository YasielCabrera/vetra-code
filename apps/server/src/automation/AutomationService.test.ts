import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type AutomationId,
  type AutomationSnapshot,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadLifecycleService from "../orchestration-v2/ThreadLifecycleService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectionAutomationRepositoryLive } from "../persistence/Layers/ProjectionAutomations.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as AutomationService from "./AutomationService.ts";

const PROJECT_ID = ProjectId.make("project-1");
const NOW = "2026-09-09T12:00:00.000Z";

const createInput = (automationId: string) => ({
  automationId: automationId as AutomationId,
  title: "Daily briefing",
  prompt: "Summarize what changed.",
  schedule: { kind: "recurring" as const, cron: "0 8 * * *", timeZone: "UTC" },
  project: { kind: "existing" as const, projectId: PROJECT_ID },
  modelSelection: { instanceId: "codex", model: "gpt-5" } as never,
  runtimeMode: "full-access" as const,
  envMode: "local" as const,
  baseBranch: null,
  startFromOrigin: false,
  enabled: true,
});

/**
 * The service against an in-memory database and recording fakes. `shells`
 * plays the V2 thread store: a launched run has no shell until a test adds one.
 */
const makeHarness = Effect.gen(function* () {
  const launches = yield* Ref.make<ReadonlyArray<ThreadLaunchService.ThreadLaunchInput>>([]);
  const deletedThreads = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const shells = yield* Ref.make(new Map<ThreadId, Partial<OrchestrationV2ThreadShell>>());
  const dueWork = yield* Ref.make<Effect.Effect<void> | null>(null);

  const fakes = Layer.mergeAll(
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (input) =>
        Ref.update(launches, (all) => [...all, input]).pipe(
          Effect.as({ threadId: input.threadId!, resumed: false } as never),
        ),
    }),
    Layer.mock(ThreadLifecycleService.ThreadLifecycleService)({
      delete: (input) =>
        Ref.update(deletedThreads, (all) => [...all, input.threadId]).pipe(Effect.as({} as never)),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Ref.get(shells).pipe(
          Effect.map((all) => (all.get(threadId) ?? null) as OrchestrationV2ThreadShell | null),
        ),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: (projectId) =>
        Effect.succeed(
          projectId === PROJECT_ID
            ? Option.some({ id: PROJECT_ID, workspaceRoot: "/repo" } as never)
            : Option.none(),
        ),
    }),
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      localStatus: () => Effect.succeed({ refName: "main" } as never),
    }),
    Layer.mock(Scheduler.Scheduler)({
      register: (_name, runDueWork) => Ref.set(dueWork, runDueWork as never),
    }),
    ProjectionAutomationRepositoryLive,
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-automation-service-test-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
    NodeServices.layer,
  );
  const context = yield* Layer.build(AutomationService.layer.pipe(Layer.provide(fakes)));
  const automations = Context.get(context, AutomationService.AutomationService);
  const snapshot = Stream.runHead(automations.subscribe()).pipe(
    Effect.map((head) => Option.getOrThrow(head) as AutomationSnapshot),
  );
  return { automations, snapshot, launches, deletedThreads, shells, dueWork };
});

it.effect("launches a manual run as a hidden thread the user can reveal", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const { automations, snapshot, launches } = yield* makeHarness;
    yield* automations.create(createInput("automation-1"));
    yield* automations.runNow({ automationId: "automation-1" as AutomationId });

    const [launch] = yield* Ref.get(launches);
    assert.equal(launch?.initialMessage?.text, "Summarize what changed.");
    assert.deepStrictEqual(launch?.workspaceStrategy, { type: "root", branch: "main" });
    assert.equal(launch?.commandId, `automation-run:automation-1:${NOW}`);

    const [run] = (yield* snapshot).runs;
    assert.equal(run?.threadId, launch?.threadId);
    assert.equal(run?.reason, "manual");
    assert.equal(run?.hiddenAt, NOW);
    assert.equal((yield* snapshot).automations[0]?.lastRun?.outcome, "claimed");

    yield* automations.setRunHidden({ threadId: run!.threadId, hidden: false });
    assert.isNull((yield* snapshot).runs[0]?.hiddenAt);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
);

it.effect("refuses a manual run while the previous one is still working", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const { automations, launches, shells } = yield* makeHarness;
    yield* automations.create(createInput("automation-1"));
    yield* automations.runNow({ automationId: "automation-1" as AutomationId });
    const [launch] = yield* Ref.get(launches);
    yield* Ref.update(shells, (all) =>
      new Map(all).set(launch!.threadId!, {
        deletedAt: null,
        archivedAt: null,
        activeRunId: "run-1" as never,
      }),
    );

    const error = yield* Effect.flip(
      automations.runNow({ automationId: "automation-1" as AutomationId }),
    );
    assert.include(error.message, "already running");
    assert.equal((yield* Ref.get(launches)).length, 1);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
);

it.effect("skips a recurring occurrence the machine slept through", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-09-09T07:00:00.000Z"));
    const { automations, snapshot, launches, dueWork } = yield* makeHarness;
    yield* automations.create(createInput("automation-1"));
    assert.equal((yield* snapshot).automations[0]?.nextRunAt, "2026-09-09T08:00:00.000Z");

    // The lid opens at lunch: the morning run is hours late.
    yield* TestClock.setTime(Date.parse(NOW));
    yield* (yield* Ref.get(dueWork))!;

    const [automation] = (yield* snapshot).automations;
    assert.equal(automation?.lastRun?.outcome, "missed");
    assert.equal(automation?.nextRunAt, "2026-09-10T08:00:00.000Z");
    assert.equal((yield* Ref.get(launches)).length, 0);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
);

it.effect("deleting an automation takes its hidden runs and leaves revealed ones", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const { automations, snapshot, launches, deletedThreads, shells } = yield* makeHarness;
    yield* automations.create(createInput("automation-1"));
    yield* automations.runNow({ automationId: "automation-1" as AutomationId });
    yield* TestClock.adjust("1 hour");
    yield* automations.runNow({ automationId: "automation-1" as AutomationId });
    const [hidden, revealed] = (yield* Ref.get(launches)).map((launch) => launch.threadId!);
    for (const threadId of [hidden!, revealed!]) {
      yield* Ref.update(shells, (all) =>
        new Map(all).set(threadId, { deletedAt: null, archivedAt: null, activeRunId: null }),
      );
    }
    yield* automations.setRunHidden({ threadId: revealed!, hidden: false });

    yield* automations.delete({ automationId: "automation-1" as AutomationId });

    assert.deepStrictEqual(yield* Ref.get(deletedThreads), [hidden!]);
    assert.deepStrictEqual(yield* snapshot, { automations: [], runs: [] });
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
);

it.effect("keeps V1 run threads hidden after the V2 cutover", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* TestClock.setTime(Date.parse(NOW));
    // A V1 database: the automation row and its run threads' V1 columns.
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
    const { automations, snapshot } = yield* makeHarness;
    yield* automations.create(createInput("automation-1"));

    const runs = (yield* snapshot).runs.map((run) => [run.threadId, run.hiddenAt]);
    assert.deepStrictEqual(runs, [
      ["v1-hidden", "2026-09-01T08:00:00.000Z"],
      ["v1-revealed", null],
    ]);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory)),
);
