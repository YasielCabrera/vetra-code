import {
  AutomationId,
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AutomationSchedule,
  type OrchestrationAutomation,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

// The decider reads the Effect test clock, pinned to the epoch, so anything
// "now" in these tests is 1970-01-01T00:00:00.000Z.
const NOW = "1970-01-01T00:00:00.000Z";
const MODEL = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" } as const;
const DAILY_9AM: AutomationSchedule = {
  kind: "recurring",
  cron: "0 9 * * *",
  timeZone: "UTC",
};

function makeProject(overrides?: Partial<OrchestrationProject>): OrchestrationProject {
  return {
    id: ProjectId.make("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project-1",
    defaultModelSelection: MODEL,
    defaultThreadEnvMode: null,
    faviconPath: null,
    scripts: [],
    automationId: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeAutomation(overrides?: Partial<OrchestrationAutomation>): OrchestrationAutomation {
  return {
    id: AutomationId.make("automation-1"),
    title: "Daily briefing",
    prompt: "Summarize what changed.",
    schedule: DAILY_9AM,
    projectId: ProjectId.make("project-1"),
    ownsProject: false,
    modelSelection: MODEL,
    runtimeMode: "full-access",
    envMode: "local",
    baseBranch: null,
    startFromOrigin: false,
    enabled: true,
    nextRunAt: "1970-01-01T09:00:00.000Z",
    lastRun: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeRunThread(overrides?: Partial<OrchestrationThread>): OrchestrationThread {
  return {
    id: ThreadId.make("run-thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Daily briefing",
    modelSelection: MODEL,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    hiddenAt: NOW,
    automationId: AutomationId.make("automation-1"),
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeReadModel(input?: {
  readonly projects?: ReadonlyArray<OrchestrationProject>;
  readonly threads?: ReadonlyArray<OrchestrationThread>;
  readonly automations?: ReadonlyArray<OrchestrationAutomation>;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: input?.projects ?? [makeProject()],
    threads: input?.threads ?? [],
    automations: input?.automations ?? [],
    updatedAt: NOW,
  };
}

const createCommand = {
  type: "automation.create",
  commandId: CommandId.make("cmd-create"),
  automationId: AutomationId.make("automation-1"),
  title: "Daily briefing",
  prompt: "Summarize what changed.",
  schedule: DAILY_9AM,
  project: { kind: "existing", projectId: ProjectId.make("project-1") },
  modelSelection: MODEL,
  runtimeMode: "full-access",
  envMode: "local",
  baseBranch: null,
  startFromOrigin: false,
  enabled: true,
  createdAt: NOW,
} as const;

const claimCommand = {
  type: "automation.run.claim",
  commandId: CommandId.make("cmd-claim"),
  automationId: AutomationId.make("automation-1"),
  scheduledFor: "1970-01-01T09:00:00.000Z",
  reason: "schedule",
  threadId: ThreadId.make("run-thread-1"),
  createdAt: "1970-01-01T09:00:00.000Z",
} as const;

it.layer(NodeServices.layer)("automation decider", (it) => {
  it.effect("creates an automation in an existing project and resolves its first run", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: createCommand,
        readModel: makeReadModel(),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("automation.created");
      if (events[0]?.type === "automation.created") {
        expect(events[0].payload.ownsProject).toBe(false);
        expect(events[0].payload.nextRunAt).toBe("1970-01-01T09:00:00.000Z");
      }
    }),
  );

  it.effect("creates an owned project in the same decision as the automation", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          ...createCommand,
          project: {
            kind: "owned",
            projectId: ProjectId.make("project-owned"),
            workspaceRoot: "/tmp/vetra/automations/automation-1",
          },
        },
        readModel: makeReadModel({ projects: [] }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual(["project.created", "automation.created"]);
      if (events[0]?.type === "project.created") {
        expect(events[0].payload.automationId).toBe("automation-1");
      }
      if (events[1]?.type === "automation.created") {
        expect(events[1].payload.ownsProject).toBe(true);
      }
    }),
  );

  it.effect("rejects an automation whose project does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: createCommand,
        readModel: makeReadModel({ projects: [] }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("re-anchors the next run when the schedule changes", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "automation.meta.update",
          commandId: CommandId.make("cmd-update"),
          automationId: AutomationId.make("automation-1"),
          schedule: { kind: "recurring", cron: "30 16 * * *", timeZone: "UTC" },
        },
        readModel: makeReadModel({ automations: [makeAutomation()] }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.meta-updated");
      if (events[0]?.type === "automation.meta-updated") {
        expect(events[0].payload.nextRunAt).toBe("1970-01-01T16:30:00.000Z");
      }
    }),
  );

  it.effect("leaves the next run alone when the schedule is untouched", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "automation.meta.update",
          commandId: CommandId.make("cmd-update-title"),
          automationId: AutomationId.make("automation-1"),
          title: "Renamed",
        },
        readModel: makeReadModel({ automations: [makeAutomation()] }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      if (events[0]?.type === "automation.meta-updated") {
        expect(events[0].payload.nextRunAt).toBe("1970-01-01T09:00:00.000Z");
        expect(events[0].payload.title).toBe("Renamed");
      }
    }),
  );

  it.effect("recomputes the next run from now when a paused automation resumes", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "automation.enable",
          commandId: CommandId.make("cmd-enable"),
          automationId: AutomationId.make("automation-1"),
        },
        readModel: makeReadModel({
          // A wake time from before the pause, long past by now.
          automations: [makeAutomation({ enabled: false, nextRunAt: "1969-01-01T09:00:00.000Z" })],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.enabled");
      if (events[0]?.type === "automation.enabled") {
        expect(events[0].payload.nextRunAt).toBe("1970-01-01T09:00:00.000Z");
      }
    }),
  );

  it.effect("claims a due run and advances the schedule past it", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: claimCommand,
        readModel: makeReadModel({ automations: [makeAutomation()] }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.run-claimed");
      if (events[0]?.type === "automation.run-claimed") {
        expect(events[0].payload.threadId).toBe("run-thread-1");
        expect(events[0].payload.nextRunAt).toBe("1970-01-02T09:00:00.000Z");
      }
    }),
  );

  it.effect("collapses a backlog of missed occurrences into one skip", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          ...claimCommand,
          // Due four days ago; the machine was off in between.
          scheduledFor: "1969-12-28T09:00:00.000Z",
          createdAt: "1970-01-01T00:00:00.000Z",
        },
        readModel: makeReadModel({
          automations: [makeAutomation({ nextRunAt: "1969-12-28T09:00:00.000Z" })],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.run-skipped");
      if (events[0]?.type === "automation.run-skipped") {
        expect(events[0].payload.outcome).toBe("missed");
        // One step forward, not one run per missed day.
        expect(events[0].payload.nextRunAt).toBe("1970-01-01T09:00:00.000Z");
      }
    }),
  );

  it.effect("still fires a one-time run that the machine slept through", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          ...claimCommand,
          scheduledFor: "1969-12-31T22:00:00.000Z",
          createdAt: "1970-01-01T00:00:00.000Z",
        },
        readModel: makeReadModel({
          automations: [
            makeAutomation({
              schedule: { kind: "once", runAt: "1969-12-31T22:00:00.000Z" },
              nextRunAt: "1969-12-31T22:00:00.000Z",
            }),
          ],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.run-claimed");
      if (events[0]?.type === "automation.run-claimed") {
        // Nothing left to schedule once it has run.
        expect(events[0].payload.nextRunAt).toBeNull();
      }
    }),
  );

  it.effect("skips a scheduled run while the previous one is still working", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: { ...claimCommand, threadId: ThreadId.make("run-thread-2") },
        readModel: makeReadModel({
          threads: [
            makeRunThread({
              session: {
                threadId: ThreadId.make("run-thread-1"),
                status: "running",
                providerName: "codex",
                providerInstanceId: ProviderInstanceId.make("codex"),
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: NOW,
              },
            }),
          ],
          automations: [
            makeAutomation({
              lastRun: {
                scheduledFor: "1969-12-31T09:00:00.000Z",
                occurredAt: "1969-12-31T09:00:00.000Z",
                outcome: "claimed",
                reason: "schedule",
                threadId: ThreadId.make("run-thread-1"),
              },
            }),
          ],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.run-skipped");
      if (events[0]?.type === "automation.run-skipped") {
        expect(events[0].payload.outcome).toBe("skipped-overlap");
      }
    }),
  );

  // The skip above overwrote lastRun with no thread id, so a guard that reads
  // only lastRun would have nothing left to see and would claim a second agent
  // beside the run still working.
  it.effect("keeps skipping while one long run outlasts several occurrences", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: { ...claimCommand, threadId: ThreadId.make("run-thread-3") },
        readModel: makeReadModel({
          threads: [
            makeRunThread({
              session: {
                threadId: ThreadId.make("run-thread-1"),
                status: "running",
                providerName: "codex",
                providerInstanceId: ProviderInstanceId.make("codex"),
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: NOW,
              },
            }),
          ],
          automations: [
            makeAutomation({
              lastRun: {
                scheduledFor: "1969-12-31T10:00:00.000Z",
                occurredAt: "1969-12-31T10:00:00.000Z",
                outcome: "skipped-overlap",
                reason: "schedule",
                threadId: null,
              },
            }),
          ],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.run-skipped");
      if (events[0]?.type === "automation.run-skipped") {
        expect(events[0].payload.outcome).toBe("skipped-overlap");
      }
    }),
  );

  it.effect("claims once every run thread has finished", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: { ...claimCommand, threadId: ThreadId.make("run-thread-3") },
        readModel: makeReadModel({
          threads: [makeRunThread({ session: null })],
          automations: [
            makeAutomation({
              lastRun: {
                scheduledFor: "1969-12-31T10:00:00.000Z",
                occurredAt: "1969-12-31T10:00:00.000Z",
                outcome: "skipped-overlap",
                reason: "schedule",
                threadId: null,
              },
            }),
          ],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.type).toBe("automation.run-claimed");
    }),
  );

  it.effect("tells the user when Run now collides with a run in flight", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          ...claimCommand,
          reason: "manual",
          threadId: ThreadId.make("run-thread-2"),
        },
        readModel: makeReadModel({
          threads: [
            makeRunThread({
              session: {
                threadId: ThreadId.make("run-thread-1"),
                status: "running",
                providerName: "codex",
                providerInstanceId: ProviderInstanceId.make("codex"),
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: NOW,
              },
            }),
          ],
          automations: [
            makeAutomation({
              lastRun: {
                scheduledFor: "1969-12-31T09:00:00.000Z",
                occurredAt: "1969-12-31T09:00:00.000Z",
                outcome: "claimed",
                reason: "schedule",
                threadId: ThreadId.make("run-thread-1"),
              },
            }),
          ],
        }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("runs a paused automation on demand but not on schedule", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel({ automations: [makeAutomation({ enabled: false })] });
      const scheduled = yield* decideOrchestrationCommand({
        command: claimCommand,
        readModel,
      });
      const scheduledEvents = Array.isArray(scheduled) ? scheduled : [scheduled];
      expect(scheduledEvents[0]?.type).toBe("automation.run-skipped");
      if (scheduledEvents[0]?.type === "automation.run-skipped") {
        expect(scheduledEvents[0].payload.outcome).toBe("skipped-disabled");
      }

      const manual = yield* decideOrchestrationCommand({
        command: { ...claimCommand, reason: "manual" },
        readModel,
      });
      const manualEvents = Array.isArray(manual) ? manual : [manual];
      expect(manualEvents[0]?.type).toBe("automation.run-claimed");
    }),
  );

  it.effect("takes hidden runs with a deleted automation and leaves revealed ones", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "automation.delete",
          commandId: CommandId.make("cmd-delete"),
          automationId: AutomationId.make("automation-1"),
        },
        readModel: makeReadModel({
          threads: [
            makeRunThread({ id: ThreadId.make("hidden-run"), hiddenAt: NOW }),
            makeRunThread({ id: ThreadId.make("revealed-run"), hiddenAt: null }),
          ],
          automations: [makeAutomation()],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual(["automation.deleted", "thread.deleted"]);
      if (events[1]?.type === "thread.deleted") {
        expect(events[1].payload.threadId).toBe("hidden-run");
      }
    }),
  );

  it.effect("deleting an automation that owns its project deletes the project", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "automation.delete",
          commandId: CommandId.make("cmd-delete-owned"),
          automationId: AutomationId.make("automation-1"),
        },
        readModel: makeReadModel({
          threads: [makeRunThread({ id: ThreadId.make("hidden-run") })],
          automations: [makeAutomation({ ownsProject: true })],
        }),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      // One deletion event each, in dependency order.
      expect(events.map((event) => event.type)).toEqual([
        "automation.deleted",
        "thread.deleted",
        "project.deleted",
      ]);
    }),
  );

  it.effect("refuses to delete an owned project holding runs the user promoted", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel({
        threads: [makeRunThread({ id: ThreadId.make("revealed-run"), hiddenAt: null })],
        automations: [makeAutomation({ ownsProject: true })],
      });
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "automation.delete",
          commandId: CommandId.make("cmd-delete-owned-revealed"),
          automationId: AutomationId.make("automation-1"),
        },
        readModel,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");

      const forced = yield* decideOrchestrationCommand({
        command: {
          type: "automation.delete",
          commandId: CommandId.make("cmd-delete-owned-forced"),
          automationId: AutomationId.make("automation-1"),
          force: true,
        },
        readModel,
      });
      const events = Array.isArray(forced) ? forced : [forced];
      expect(events.map((event) => event.type)).toEqual([
        "automation.deleted",
        "thread.deleted",
        "project.deleted",
      ]);
    }),
  );

  it.effect("will not delete a project out from under its automations", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel({ automations: [makeAutomation()] });
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "project.delete",
          commandId: CommandId.make("cmd-project-delete"),
          projectId: ProjectId.make("project-1"),
        },
        readModel,
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");

      const forced = yield* decideOrchestrationCommand({
        command: {
          type: "project.delete",
          commandId: CommandId.make("cmd-project-delete-forced"),
          projectId: ProjectId.make("project-1"),
          force: true,
        },
        readModel,
      });
      const events = Array.isArray(forced) ? forced : [forced];
      expect(events.map((event) => event.type)).toEqual(["automation.deleted", "project.deleted"]);
    }),
  );

  it.effect("hides and reveals a thread idempotently", () =>
    Effect.gen(function* () {
      const hiddenThread = makeRunThread({ hiddenAt: "1969-12-31T00:00:00.000Z" });
      const rehide = yield* decideOrchestrationCommand({
        command: {
          type: "thread.hide",
          commandId: CommandId.make("cmd-rehide"),
          threadId: hiddenThread.id,
        },
        readModel: makeReadModel({ threads: [hiddenThread] }),
      });
      const rehideEvents = Array.isArray(rehide) ? rehide : [rehide];
      if (rehideEvents[0]?.type === "thread.hidden") {
        // The original moment survives, and updatedAt does not churn.
        expect(rehideEvents[0].payload.hiddenAt).toBe("1969-12-31T00:00:00.000Z");
        expect(rehideEvents[0].payload.updatedAt).toBe(hiddenThread.updatedAt);
      }

      const reveal = yield* decideOrchestrationCommand({
        command: {
          type: "thread.reveal",
          commandId: CommandId.make("cmd-reveal"),
          threadId: hiddenThread.id,
        },
        readModel: makeReadModel({ threads: [hiddenThread] }),
      });
      const revealEvents = Array.isArray(reveal) ? reveal : [reveal];
      expect(revealEvents[0]?.type).toBe("thread.revealed");
    }),
  );
});
