import { EnvironmentId, ProjectId, ProviderInstanceId } from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import {
  buildProjectRowModels,
  matchesProjectQuery,
  repositoryLabelOf,
  threadCountLabel,
} from "./projectsList.logic";

const primaryEnvironmentId = EnvironmentId.make("env-primary");
const remoteEnvironmentId = EnvironmentId.make("env-remote");
const groupingSettings = {
  sidebarProjectGroupingMode: "repository" as const,
  sidebarProjectGroupingOverrides: {},
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make("project-1"),
    environmentId: primaryEnvironmentId,
    title: "shared-repo",
    workspaceRoot: "/tmp/shared-repo",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

function makeSnapshots(projects: ReadonlyArray<Project>) {
  return buildSidebarProjectSnapshots({
    projects,
    settings: groupingSettings,
    primaryEnvironmentId,
    resolveEnvironmentLabel: (environmentId) =>
      environmentId === remoteEnvironmentId ? "workstation" : "primary",
  }).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function makeThread(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  updatedAt: string;
  hiddenAt?: string | null;
}) {
  return { hiddenAt: null, ...input };
}

describe("repositoryLabelOf", () => {
  it("names the repository the way a host does when owner and name are known", () => {
    const [group] = makeSnapshots([
      makeProject({
        repositoryIdentity: {
          canonicalKey: "github.com/example/shared-repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
          owner: "example",
          name: "shared-repo",
          displayName: "example/shared-repo",
        },
      }),
    ]);

    expect(repositoryLabelOf(group!)).toBe("example/shared-repo");
  });

  it("falls back to the identity's display name, then to nothing at all", () => {
    const [named] = makeSnapshots([
      makeProject({
        repositoryIdentity: {
          canonicalKey: "example.com/internal",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared-repo.git",
          },
          displayName: "internal",
        },
      }),
    ]);
    expect(repositoryLabelOf(named!)).toBe("internal");

    const [unidentified] = makeSnapshots([makeProject()]);
    expect(repositoryLabelOf(unidentified!)).toBeNull();
  });
});

describe("buildProjectRowModels", () => {
  const repositoryIdentity = {
    canonicalKey: "github.com/example/shared-repo",
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: "https://github.com/example/shared-repo.git",
    },
    owner: "example",
    name: "shared-repo",
  };

  it("sums threads across every checkout the one row stands for", () => {
    const local = makeProject({ repositoryIdentity });
    const remote = makeProject({
      id: ProjectId.make("project-remote"),
      environmentId: remoteEnvironmentId,
      repositoryIdentity,
    });
    const groups = makeSnapshots([local, remote]);
    expect(groups).toHaveLength(1);

    const [row] = buildProjectRowModels(groups, [
      makeThread({
        environmentId: primaryEnvironmentId,
        projectId: local.id,
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      makeThread({
        environmentId: primaryEnvironmentId,
        projectId: local.id,
        updatedAt: "2026-02-03T00:00:00.000Z",
      }),
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: remote.id,
        updatedAt: "2026-02-02T00:00:00.000Z",
      }),
    ]);

    expect(row?.threadCount).toBe(3);
    // The latest activity anywhere in the group, not the latest per checkout.
    expect(row?.lastActiveAt).toBe("2026-02-03T00:00:00.000Z");
  });

  it("leaves an automation's hidden runs out of the count", () => {
    const project = makeProject();
    const [row] = buildProjectRowModels(makeSnapshots([project]), [
      makeThread({
        environmentId: primaryEnvironmentId,
        projectId: project.id,
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      // A run the sidebar does not show must not be promised by the count.
      makeThread({
        environmentId: primaryEnvironmentId,
        projectId: project.id,
        updatedAt: "2026-02-05T00:00:00.000Z",
        hiddenAt: "2026-02-05T00:00:00.000Z",
      }),
    ]);
    expect(row?.threadCount).toBe(1);
    expect(row?.lastActiveAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("reports no threads and no activity for a project nothing has run in", () => {
    const [row] = buildProjectRowModels(makeSnapshots([makeProject()]), []);

    expect(row?.threadCount).toBe(0);
    expect(row?.lastActiveAt).toBeNull();
    expect(threadCountLabel(row!.threadCount)).toBe("No threads");
  });

  it("ignores threads belonging to another environment's copy of the same id", () => {
    const local = makeProject();
    const [row] = buildProjectRowModels(makeSnapshots([local]), [
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: local.id,
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);

    expect(row?.threadCount).toBe(0);
  });

  it("matches a search against the checkout paths and environments behind the row", () => {
    const local = makeProject({ repositoryIdentity });
    const remote = makeProject({
      id: ProjectId.make("project-remote"),
      environmentId: remoteEnvironmentId,
      workspaceRoot: "/srv/worktrees/hotfix",
      title: "hotfix",
      repositoryIdentity,
    });
    const [row] = buildProjectRowModels(makeSnapshots([local, remote]), []);

    expect(matchesProjectQuery(row!, "hotfix")).toBe(true);
    expect(matchesProjectQuery(row!, "worktrees")).toBe(true);
    expect(matchesProjectQuery(row!, "example/shared-repo")).toBe(true);
    expect(matchesProjectQuery(row!, "workstation")).toBe(true);
    expect(matchesProjectQuery(row!, "unrelated")).toBe(false);
  });
});

describe("threadCountLabel", () => {
  it("keeps the count singular when there is one thread", () => {
    expect(threadCountLabel(1)).toBe("1 thread");
    expect(threadCountLabel(2)).toBe("2 threads");
  });
});
