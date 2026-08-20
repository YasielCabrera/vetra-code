import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitHubIssueCli from "./GitHubIssueCli.ts";
import { make } from "./GitHubIssueProvider.ts";
import type { GitHubIssue } from "./githubIssueJson.ts";

function issue(): GitHubIssue {
  return {
    number: 7,
    title: "Login fails",
    url: "https://github.com/acme/web/issues/7",
    author: { login: "octocat", name: "The Octocat", avatarUrl: null },
    state: "open",
    body: "Steps to reproduce",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    closedAt: null,
    labels: [],
    assignees: [{ login: "dependabot[bot]", name: null, avatarUrl: null }],
    milestone: null,
    comments: [
      {
        id: "IC_1",
        author: { login: "hubot", name: null, avatarUrl: null },
        body: "Confirmed",
        createdAt: "2026-08-02T00:00:00Z",
        updatedAt: null,
        url: null,
      },
    ],
    commentCount: 1,
    commentsTruncated: false,
  };
}

it.effect("adds GitHub avatar URLs to issue actors while retaining generic fallbacks", () =>
  Effect.gen(function* () {
    const provider = yield* make;
    const input = {
      cwd: "/work/acme-web",
      host: "github.com",
      repository: "acme/web",
      state: "open" as const,
      limit: 20,
    };

    const list = yield* provider.listIssues(input);
    const detail = yield* provider.getIssue({
      cwd: input.cwd,
      host: input.host,
      repository: input.repository,
      number: 7,
    });
    const activity = yield* provider.getIssueActivity({
      cwd: input.cwd,
      host: input.host,
      repository: input.repository,
      number: 7,
    });

    expect(list.issues[0]?.author?.avatarUrl).toBe("https://github.com/octocat.png?size=80");
    expect(list.issues[0]?.assignees[0]?.avatarUrl).toBeNull();
    expect(detail.comments[0]?.author?.avatarUrl).toBe("https://github.com/hubot.png?size=80");
    expect(activity.items[0]?.actor?.avatarUrl).toBe("https://github.com/hubot.png?size=80");
  }).pipe(
    Effect.provide(
      Layer.mock(GitHubIssueCli.GitHubIssueCli)({
        listIssues: () => Effect.succeed({ issues: [issue()], truncated: false }),
        getIssue: () => Effect.succeed(issue()),
        getIssueActivity: () =>
          Effect.succeed({
            items: [
              {
                type: "comment",
                id: "IC_1",
                actor: { login: "hubot", name: null, avatarUrl: null },
                body: "Confirmed",
                createdAt: "2026-08-02T00:00:00Z",
                updatedAt: null,
                url: null,
              },
            ],
            truncated: false,
          }),
        listAssigneeCandidates: () => Effect.succeed({ candidates: [], truncated: false }),
        setAssignees: () => Effect.void,
      }),
    ),
  ),
);
