import { describe, expect, it } from "vite-plus/test";

import { AutomationId, ProjectId, ProviderInstanceId, ThreadId } from "@vetra-studio/contracts";
import type {
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "@vetra-studio/contracts";

import { applyShellStreamEvent } from "./shellReducer.ts";

const baseSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
  automations: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const stubProject = {
  id: ProjectId.make("project-1"),
  title: "Test Project",
  workspaceRoot: "/workspace/test",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
} as const;

describe("applyShellStreamEvent", () => {
  it("ignores stale project upserts without mutating the snapshot", () => {
    const snapshotWithProject: OrchestrationShellSnapshot = {
      ...baseSnapshot,
      snapshotSequence: 4,
      projects: [stubProject],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project-upserted",
        sequence,
        project: { ...stubProject, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe("Test Project");
    }
  });

  describe("project-upserted", () => {
    it("adds a new project", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 1,
        project: stubProject,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.id).toBe("project-1");
      expect(next.snapshotSequence).toBe(1);
    });

    it("updates an existing project", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const updatedProject = { ...stubProject, title: "Updated Title" };
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 2,
        project: updatedProject,
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.title).toBe("Updated Title");
      expect(next.snapshotSequence).toBe(2);
    });
  });

  describe("project-removed", () => {
    it("removes a project by id", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(0);
      expect(next.snapshotSequence).toBe(3);
    });
  });

  describe("thread-upserted", () => {
    it("adds a new thread", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 4,
        thread: stubThread,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.id).toBe("thread-1");
      expect(next.snapshotSequence).toBe(4);
    });

    it("updates an existing thread", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
        automations: [],
      };

      const updatedThread = { ...stubThread, title: "Updated Thread" };
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 5,
        thread: updatedThread,
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.title).toBe("Updated Thread");
    });
  });

  describe("thread-removed", () => {
    it("removes a thread by id", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
        automations: [],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "thread-removed",
        sequence: 6,
        threadId: ThreadId.make("thread-1"),
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(6);
    });
  });

  describe("automation events", () => {
    const stubAutomation = {
      id: AutomationId.make("automation-1"),
      title: "Daily briefing",
      prompt: "Summarize what changed.",
      schedule: { kind: "recurring" as const, cron: "0 8 * * 1-5", timeZone: "UTC" },
      projectId: ProjectId.make("project-1"),
      ownsProject: false,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access" as const,
      envMode: "local" as const,
      baseBranch: null,
      startFromOrigin: false,
      enabled: true,
      nextRunAt: "2026-04-02T08:00:00.000Z",
      lastRun: null,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      deletedAt: null,
    };

    it("adds an automation it has not seen", () => {
      const next = applyShellStreamEvent(baseSnapshot, {
        kind: "automation-upserted",
        sequence: 1,
        automation: stubAutomation,
      });
      expect(next.automations).toHaveLength(1);
      expect(next.snapshotSequence).toBe(1);
    });

    it("replaces an automation in place rather than duplicating it", () => {
      const withAutomation = applyShellStreamEvent(baseSnapshot, {
        kind: "automation-upserted",
        sequence: 1,
        automation: stubAutomation,
      });
      const next = applyShellStreamEvent(withAutomation, {
        kind: "automation-upserted",
        sequence: 2,
        automation: { ...stubAutomation, enabled: false },
      });
      expect(next.automations).toHaveLength(1);
      expect(next.automations[0]?.enabled).toBe(false);
    });

    it("drops a removed automation", () => {
      const withAutomation = applyShellStreamEvent(baseSnapshot, {
        kind: "automation-upserted",
        sequence: 1,
        automation: stubAutomation,
      });
      const next = applyShellStreamEvent(withAutomation, {
        kind: "automation-removed",
        sequence: 2,
        automationId: AutomationId.make("automation-1"),
      });
      expect(next.automations).toHaveLength(0);
      expect(next.snapshotSequence).toBe(2);
    });

    it("ignores an event at or behind the snapshot it already holds", () => {
      const withAutomation = applyShellStreamEvent(baseSnapshot, {
        kind: "automation-upserted",
        sequence: 5,
        automation: stubAutomation,
      });
      const next = applyShellStreamEvent(withAutomation, {
        kind: "automation-removed",
        sequence: 5,
        automationId: AutomationId.make("automation-1"),
      });
      expect(next).toBe(withAutomation);
    });
  });

  it("returns original snapshot for unrecognized event kinds", () => {
    const unknownEvent = { kind: "unknown-future-event", sequence: 99 } as any;
    const next = applyShellStreamEvent(baseSnapshot, unknownEvent);
    expect(next).toBe(baseSnapshot);
  });
});
