import { afterEach, assert, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as GitHubApi from "../sourceControl/GitHubApi.ts";
import * as GitHubCredentials from "../sourceControl/GitHubCredentials.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import * as GitHubIssueCli from "./GitHubIssueCli.ts";

const graphql = vi.fn<GitHubApi.GitHubApi["Service"]["graphql"]>();
const rest = vi.fn<GitHubApi.GitHubApi["Service"]["rest"]>();
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const layer = it.layer(
  GitHubIssueCli.layer.pipe(Layer.provide(Layer.mock(GitHubApi.GitHubApi)({ graphql, rest }))),
);

function issue(number: number, url = `https://github.com/acme/web/issues/${number}`) {
  return {
    number,
    title: `Issue ${number}`,
    url,
    state: "OPEN",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
  };
}

function issues(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => issue(from + index));
}

/** One page of a GraphQL issue search, as GitHub answers it. */
function searchPage(nodes: ReadonlyArray<unknown>, endCursor: string | null = null) {
  return Effect.succeed(
    encodeJson({
      data: { search: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } },
    }),
  );
}

function issueDetail(node: unknown) {
  return Effect.succeed(encodeJson({ data: { repository: { issue: node } } }));
}

function restResponse(body: unknown, truncated = false) {
  return Effect.succeed({
    status: 200,
    headers: {},
    body: typeof body === "string" ? body : encodeJson(body),
    truncated,
    invalidUtf8: false,
  });
}

const graphqlCall = (index: number) => {
  const call = graphql.mock.calls.at(index)?.[0];
  assert.isDefined(call);
  return call;
};

const repository = { cwd: "/w", host: "github.com", repository: "acme/web" } as const;

afterEach(() => {
  graphql.mockReset();
  rest.mockReset();
});

layer("GitHubIssueCli.layer", (it) => {
  it.effect("searches the repository's issues and quotes user text as one literal phrase", () =>
    Effect.gen(function* () {
      graphql.mockReturnValueOnce(searchPage([issue(1), issue(2), issue(3)]));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({
        ...repository,
        state: "open",
        limit: 2,
        query: 'login" state:closed',
      });

      assert.isTrue(result.truncated);
      expect(result.issues.map(({ number }) => number)).toEqual([1, 2]);
      expect(graphqlCall(0)).toMatchObject({
        host: "github.com",
        variables: {
          query: 'repo:acme/web is:issue is:open "login\\" state:closed" sort:updated-desc',
          first: 3,
          after: null,
          withBody: false,
        },
      });
    }),
  );

  it.effect("writes each state and assignee narrowing as the qualifier GitHub reads it", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const searchFor = (state: "all" | "open" | "closed", assignee: string) =>
        Effect.gen(function* () {
          graphql.mockReturnValueOnce(searchPage([]));
          yield* cli.listIssues({ ...repository, state, limit: 2, assignee });
          return graphqlCall(-1).variables?.query;
        });

      // Unquoted, because quoted it is an account nobody has rather than the signed-in one.
      expect(yield* searchFor("all", "@me")).toBe(
        "repo:acme/web is:issue assignee:@me sort:updated-desc",
      );
      // "Nobody" has no `assignee:` value of its own; it is a different qualifier entirely.
      expect(yield* searchFor("closed", "@none")).toBe(
        "repo:acme/web is:issue is:closed no:assignee sort:updated-desc",
      );
      expect(yield* searchFor("open", "gpuente")).toBe(
        'repo:acme/web is:issue is:open assignee:"gpuente" sort:updated-desc',
      );
    }),
  );

  it.effect("reads past rows already delivered at an inclusive cursor boundary", () =>
    Effect.gen(function* () {
      graphql.mockReturnValueOnce(searchPage(issues(1, 5), "next"));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({
        ...repository,
        state: "open",
        limit: 2,
        cursor: { updatedBefore: "2026-08-02T00:00:00Z", seenAt: [1, 2] },
      });

      expect(graphql).toHaveBeenCalledTimes(1);
      expect(graphqlCall(0).variables).toMatchObject({
        query: "repo:acme/web is:issue is:open updated:<=2026-08-02T00:00:00Z sort:updated-desc",
        first: 5,
      });
      expect(result.issues.map(({ number }) => number)).toEqual([1, 2, 3, 4]);
      expect(result.truncated).toBe(true);
    }),
  );

  it.effect("follows the search past GraphQL's 100-row page until it has the probe row", () =>
    Effect.gen(function* () {
      graphql
        .mockReturnValueOnce(searchPage(issues(1, 100), "page-2"))
        .mockReturnValueOnce(searchPage(issues(101, 20)));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({ ...repository, state: "open", limit: 120 });

      expect(
        graphql.mock.calls.map(([call]) => [call.variables?.first, call.variables?.after]),
      ).toEqual([
        [100, null],
        [21, "page-2"],
      ]);
      expect(result.issues).toHaveLength(120);
      expect(result.issues.at(-1)?.number).toBe(120);
      expect(result.truncated).toBe(false);
    }),
  );

  it.effect("drops list rows whose URL belongs to another repository", () =>
    Effect.gen(function* () {
      graphql.mockReturnValueOnce(
        searchPage([issue(1), issue(2, "https://github.com/other/repo/issues/2")]),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({ ...repository, state: "all", limit: 10 });

      expect(result.issues.map(({ number }) => number)).toEqual([1]);
    }),
  );

  it.effect("refuses a repository GitHub cannot address before calling GitHub", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const issue = { cwd: "/w", host: "github.com", number: 7 } as const;

      for (const selector of ["acme/web --state closed", "../web", "acme/.."]) {
        const list = yield* Effect.flip(
          cli.listIssues({ ...issue, repository: selector, state: "open", limit: 10 }),
        );
        const comment = yield* Effect.flip(
          cli.addComment({ ...issue, repository: selector, body: "Hi" }),
        );
        expect([list._tag, comment._tag]).toEqual(["GitHubIssueReadError", "GitHubIssueReadError"]);
      }
      expect(graphql).not.toHaveBeenCalled();
      expect(rest).not.toHaveBeenCalled();
    }),
  );

  it.effect("refuses detail URLs outside the selected repository", () =>
    Effect.gen(function* () {
      graphql.mockReturnValueOnce(issueDetail(issue(7, "https://github.com/other/repo/issues/7")));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const error = yield* Effect.flip(cli.getIssue({ ...repository, number: 7 }));

      expect(error._tag).toBe("GitHubIssueReadError");
    }),
  );

  it.effect("reads an issue, its close reason, and how many comments it has", () =>
    Effect.gen(function* () {
      graphql.mockReturnValueOnce(
        issueDetail({
          ...issue(7),
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
          body: "Steps",
          author: { login: "octocat", name: "The Octocat" },
          labels: { nodes: [{ name: "bug", color: "D73A4A", description: null }] },
          assignees: { nodes: [{ login: "hubot", name: null }] },
          comments: {
            totalCount: 130,
            nodes: [
              {
                id: "IC_1",
                author: { login: "hubot" },
                body: "Confirmed",
                createdAt: "2026-08-02T00:00:00Z",
                updatedAt: "2026-08-02T00:00:00Z",
                url: "https://github.com/acme/web/issues/7#issuecomment-1",
              },
            ],
          },
        }),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const detail = yield* cli.getIssue({ ...repository, number: 7 });

      expect(graphqlCall(0)).toMatchObject({
        host: "github.com",
        variables: { owner: "acme", name: "web", number: 7 },
      });
      expect(detail).toMatchObject({
        state: "closed",
        stateReason: "not_planned",
        body: "Steps",
        author: { login: "octocat", name: "The Octocat" },
        labels: [{ name: "bug", color: "d73a4a" }],
        assignees: [{ login: "hubot" }],
        commentCount: 130,
        commentsTruncated: true,
      });
      expect(detail.comments.map(({ id, body }) => [id, body])).toEqual([["IC_1", "Confirmed"]]);
    }),
  );

  it.effect("reports a missing issue as not found, however GitHub phrases it", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      // GitHub answers a missing issue with a NOT_FOUND error, which the API fails as such.
      graphql.mockReturnValueOnce(
        Effect.fail(new GitHubApi.GitHubApiNotFoundError({ host: "github.com", operation: "x" })),
      );
      const refused = yield* Effect.flip(cli.getIssue({ ...repository, number: 404 }));
      // An answer that simply carries no issue means the same.
      graphql.mockReturnValueOnce(issueDetail(null));
      const empty = yield* Effect.flip(cli.getIssue({ ...repository, number: 404 }));

      expect([refused._tag, empty._tag]).toEqual([
        "GitHubPullRequestNotFoundError",
        "GitHubPullRequestNotFoundError",
      ]);
      expect([refused.cwd, empty.cwd]).toEqual(["/w", "/w"]);
    }),
  );

  it.effect("maps credential and rate-limit refusals onto the GitHub errors callers handle", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const failWith = (error: GitHubApi.GitHubApiError) =>
        Effect.gen(function* () {
          rest.mockReturnValueOnce(Effect.fail(error));
          return yield* Effect.flip(cli.addComment({ ...repository, number: 7, body: "Hi" }));
        });

      const unauthenticated = yield* failWith(
        new GitHubApi.GitHubApiAuthenticationError({ host: "github.com", operation: "x" }),
      );
      const signedOut = yield* failWith(
        new GitHubCredentials.GitHubNotSignedInError({ host: "github.com" }),
      );
      const limited = yield* failWith(
        new GitHubApi.GitHubApiRateLimitError({
          host: "github.com",
          operation: "x",
          retryAt: 1_000,
        }),
      );
      const paused = yield* failWith(
        new SourceControlRateLimit.SourceControlRateLimitPausedError({
          provider: "github",
          host: "github.com",
          retryAt: 2_000,
        }),
      );

      expect([unauthenticated._tag, signedOut._tag]).toEqual([
        "GitHubCliAuthenticationError",
        "GitHubCliAuthenticationError",
      ]);
      expect(
        [limited, paused].map((error) => [error._tag, "retryAt" in error && error.retryAt]),
      ).toEqual([
        ["GitHubCliRateLimitError", 1_000],
        ["GitHubCliRateLimitError", 2_000],
      ]);
    }),
  );

  it.effect("walks issue timeline pages until GitHub returns a partial page", () =>
    Effect.gen(function* () {
      const firstPage = Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        event: "labeled",
        created_at: "2026-08-02T00:00:00Z",
        label: { name: `label-${index}`, color: "ff0000" },
      }));
      rest.mockReturnValueOnce(restResponse(firstPage)).mockReturnValueOnce(
        restResponse([
          {
            id: 101,
            event: "commented",
            actor: { login: "octocat" },
            body: "Finished",
            created_at: "2026-08-03T00:00:00Z",
          },
        ]),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const activity = yield* cli.getIssueActivity({ ...repository, number: 7 });

      expect(activity.items).toHaveLength(101);
      expect(activity.items.at(-1)).toMatchObject({ type: "comment", body: "Finished" });
      expect(activity.truncated).toBe(false);
      expect(rest.mock.calls.map(([call]) => [call.host, call.method, call.path])).toEqual([
        ["github.com", undefined, "repos/acme/web/issues/7/timeline?per_page=100&page=1"],
        ["github.com", undefined, "repos/acme/web/issues/7/timeline?per_page=100&page=2"],
      ]);
    }),
  );

  it.effect("marks a timeline truncated when its bounded page walk fills", () =>
    Effect.gen(function* () {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        event: "reopened",
        created_at: "2026-08-02T00:00:00Z",
      }));
      rest.mockReturnValue(restResponse(fullPage));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const activity = yield* cli.getIssueActivity({ ...repository, number: 7 });

      expect(activity.items).toHaveLength(500);
      expect(activity.truncated).toBe(true);
      expect(rest).toHaveBeenCalledTimes(5);
    }),
  );

  it.effect("refuses a timeline page GitHub cut at the response limit", () =>
    Effect.gen(function* () {
      rest.mockReturnValueOnce(restResponse('[{"id":1,"event":"labe', true));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const error = yield* Effect.flip(cli.getIssueActivity({ ...repository, number: 7 }));

      expect(error).toMatchObject({ _tag: "GitHubIssueReadError", operation: "getIssueActivity" });
    }),
  );

  it.effect("reads assignable people, current assignees, and the viewer in one request", () =>
    Effect.gen(function* () {
      graphql.mockReturnValueOnce(
        Effect.succeed(
          encodeJson({
            data: {
              viewer: { login: "octocat" },
              repository: {
                assignableUsers: {
                  pageInfo: { hasNextPage: false },
                  nodes: [{ login: "octocat" }, { login: "hubot" }],
                },
                issue: { assignees: { nodes: [{ login: "octocat" }] } },
              },
            },
          }),
        ),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listAssigneeCandidates({ ...repository, number: 7 });

      expect(
        result.candidates.map(({ login, isAssigned, isViewer }) => [login, isAssigned, isViewer]),
      ).toEqual([
        ["octocat", true, true],
        ["hubot", false, false],
      ]);
      expect(graphql).toHaveBeenCalledTimes(1);
      expect(graphqlCall(0)).toMatchObject({
        host: "github.com",
        variables: { owner: "acme", name: "web", number: 7 },
      });
    }),
  );

  it.effect("adds and removes assignees through GitHub's issue collection", () =>
    Effect.gen(function* () {
      rest.mockReturnValue(restResponse({}));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const input = { ...repository, number: 7, assignees: ["octocat"] } as const;

      yield* cli.setAssignees({ ...input, assigned: true });
      yield* cli.setAssignees({ ...input, assigned: false });

      expect(rest.mock.calls.map(([call]) => [call.method, call.path, call.body])).toEqual([
        ["POST", "repos/acme/web/issues/7/assignees", { assignees: ["octocat"] }],
        ["DELETE", "repos/acme/web/issues/7/assignees", { assignees: ["octocat"] }],
      ]);
    }),
  );

  it.effect("closes with GitHub's reason, reopens, and comments with the body as data", () =>
    Effect.gen(function* () {
      rest.mockReturnValue(restResponse(""));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const issue = { ...repository, number: 7 } as const;

      yield* cli.setState({ ...issue, change: { state: "closed", reason: "not_planned" } });
      yield* cli.setState({ ...issue, change: { state: "closed", reason: "completed" } });
      yield* cli.setState({ ...issue, change: { state: "open" } });
      yield* cli.addComment({ ...issue, body: "--not-a-flag" });

      expect(rest.mock.calls.map(([call]) => [call.method, call.path, call.body])).toEqual([
        ["PATCH", "repos/acme/web/issues/7", { state: "closed", state_reason: "not_planned" }],
        ["PATCH", "repos/acme/web/issues/7", { state: "closed", state_reason: "completed" }],
        ["PATCH", "repos/acme/web/issues/7", { state: "open" }],
        ["POST", "repos/acme/web/issues/7/comments", { body: "--not-a-flag" }],
      ]);
    }),
  );

  it.effect("addresses Enterprise fork reads and writes explicitly", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const target = {
        cwd: "/fork",
        host: "github.acme.com",
        repository: "YasielCabrera/vetra-code",
        number: 7,
      };
      graphql.mockReturnValueOnce(
        issueDetail(issue(7, "https://github.acme.com/YasielCabrera/vetra-code/issues/7")),
      );
      yield* cli.getIssue(target);
      rest.mockReturnValueOnce(restResponse(""));
      yield* cli.setState({ ...target, change: { state: "closed", reason: "completed" } });
      rest.mockReturnValueOnce(
        Effect.fail(
          new GitHubApi.GitHubApiResponseError({
            host: "github.acme.com",
            operation: "x",
            status: 422,
          }),
        ),
      );
      const failed = yield* Effect.flip(cli.addComment({ ...target, body: "Fixed" }));

      expect(graphqlCall(0)).toMatchObject({
        host: "github.acme.com",
        variables: { owner: "YasielCabrera", name: "vetra-code", number: 7 },
      });
      expect(rest.mock.calls.map(([call]) => [call.host, call.path])).toEqual([
        ["github.acme.com", "repos/YasielCabrera/vetra-code/issues/7"],
        ["github.acme.com", "repos/YasielCabrera/vetra-code/issues/7/comments"],
      ]);
      expect(failed).toMatchObject({
        _tag: "GitHubCliCommandError",
        cwd: "/fork",
        httpStatus: 422,
      });
    }),
  );

  it.effect("lists bodies only when asked", () =>
    Effect.gen(function* () {
      graphql
        .mockReturnValueOnce(searchPage([{ ...issue(1), body: "Why" }]))
        .mockReturnValueOnce(searchPage([issue(1)]));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const withBody = yield* cli.listIssues({
        ...repository,
        state: "open",
        limit: 50,
        includeBody: true,
      });
      const withoutBody = yield* cli.listIssues({ ...repository, state: "open", limit: 50 });

      expect([graphqlCall(0).variables?.withBody, graphqlCall(1).variables?.withBody]).toEqual([
        true,
        false,
      ]);
      expect([withBody.issues[0]?.body, withoutBody.issues[0]?.body]).toEqual(["Why", ""]);
    }),
  );
});
