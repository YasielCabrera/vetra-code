import type { EnvironmentId, ProjectId } from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentIssueEntry, MergedIssueList } from "~/state/issues";

import { mergeIssueListPage } from "./issueListPagination";

const ENV_1 = "env-1" as EnvironmentId;
const ENV_2 = "env-2" as EnvironmentId;

function entry(environmentId: EnvironmentId, number: number): EnvironmentIssueEntry {
  return {
    environmentId,
    provider: "github",
    host: "github.com",
    projectId: `${environmentId}-project` as ProjectId,
    projectTitle: `${environmentId} project`,
    repository: `${environmentId}/web`,
    number,
    title: `Issue ${number}`,
    url: `https://github.com/${environmentId}/web/issues/${number}`,
    author: null,
    state: "open",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    closedAt: null,
    labels: [],
    assignees: [],
    milestone: null,
  };
}

function answer(
  environmentId: EnvironmentId,
  entries: ReadonlyArray<EnvironmentIssueEntry>,
  nextCursors: MergedIssueList["nextCursors"],
): MergedIssueList {
  return {
    entries,
    providers: [
      {
        environmentId,
        host: "github.com",
        kind: "github",
        projectCount: 1,
        configured: true,
        detail: null,
      },
    ],
    repositories: [
      {
        environmentId,
        provider: "github",
        host: "github.com",
        projectId: `${environmentId}-project` as ProjectId,
        projectTitle: `${environmentId} project`,
        repository: `${environmentId}/web`,
        repositoryUrl: `https://github.com/${environmentId}/web`,
        newIssueUrl: `https://github.com/${environmentId}/web/issues/new`,
      },
    ],
    errors: [],
    truncated: Object.keys(nextCursors).length > 0,
    nextCursors,
  };
}

describe("mergeIssueListPage", () => {
  it("appends a continuation and retains environments that already ran out", () => {
    const held: MergedIssueList = {
      ...answer(ENV_1, [entry(ENV_1, 3)], {
        [ENV_1]: { "github.com env-1/web": "cursor-1" },
      }),
      entries: [entry(ENV_1, 3), entry(ENV_2, 8)],
      providers: [...answer(ENV_1, [], {}).providers, ...answer(ENV_2, [], {}).providers],
      repositories: [...answer(ENV_1, [], {}).repositories, ...answer(ENV_2, [], {}).repositories],
    };
    const arrived = answer(ENV_1, [entry(ENV_1, 2)], {});

    const merged = mergeIssueListPage(held, arrived, true);

    expect(merged.entries.map(({ environmentId, number }) => [environmentId, number])).toEqual([
      [ENV_1, 3],
      [ENV_2, 8],
      [ENV_1, 2],
    ]);
    expect(merged.providers.map(({ environmentId }) => environmentId)).toEqual([ENV_1, ENV_2]);
    expect(merged.repositories.map(({ environmentId }) => environmentId)).toEqual([ENV_1, ENV_2]);
    expect(merged.truncated).toBe(false);
    expect(merged.nextCursors).toEqual({});
  });

  it("updates a repeated boundary row in place instead of duplicating it", () => {
    const held = answer(ENV_1, [entry(ENV_1, 3)], {
      [ENV_1]: { "github.com env-1/web": "cursor-1" },
    });
    const arrived = answer(
      ENV_1,
      [{ ...entry(ENV_1, 3), title: "Updated title" }, entry(ENV_1, 2)],
      {},
    );

    const merged = mergeIssueListPage(held, arrived, true);

    expect(merged.entries).toHaveLength(2);
    expect(merged.entries[0]?.title).toBe("Updated title");
  });
});
