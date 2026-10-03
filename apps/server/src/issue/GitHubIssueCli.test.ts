import { afterEach, assert, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubIssueCli from "./GitHubIssueCli.ts";

const execute = vi.fn<GitHubCli.GitHubCli["Service"]["execute"]>();
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const layer = it.layer(
  GitHubIssueCli.layer.pipe(Layer.provide(Layer.mock(GitHubCli.GitHubCli)({ execute }))),
);

function output(stdout: string) {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
  };
}

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

afterEach(() => execute.mockReset());

layer("GitHubIssueCli.layer", (it) => {
  it.effect("uses separate bounded arguments and quotes search as literal text", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(
        Effect.succeed(output(encodeJson([issue(1), issue(2), issue(3)]))),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        state: "open",
        limit: 2,
        query: 'login" state:closed',
      });

      assert.isTrue(result.truncated);
      assert.strictEqual(result.issues.length, 2);
      const call = execute.mock.calls[0]?.[0];
      assert.isDefined(call);
      expect(call.args).toContain("github.com/acme/web");
      expect(call.args).toContain("3");
      const searchIndex = call.args.indexOf("--search");
      expect(call.args[searchIndex + 1]).toBe('"login\\" state:closed" sort:updated-desc');
    }),
  );

  it.effect("writes each assignee narrowing as the qualifier GitHub reads it", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const searchFor = (assignee: string) =>
        Effect.gen(function* () {
          execute.mockReturnValueOnce(Effect.succeed(output(encodeJson([]))));
          yield* cli.listIssues({
            cwd: "/w",
            host: "github.com",
            repository: "acme/web",
            state: "open",
            limit: 2,
            assignee,
          });
          const call = execute.mock.calls.at(-1)?.[0];
          assert.isDefined(call);
          return call.args[call.args.indexOf("--search") + 1];
        });

      // Unquoted, because quoted it is an account nobody has rather than the signed-in one.
      expect(yield* searchFor("@me")).toBe("assignee:@me sort:updated-desc");
      // "Nobody" has no `assignee:` value of its own; it is a different qualifier entirely.
      expect(yield* searchFor("@none")).toBe("no:assignee sort:updated-desc");
      expect(yield* searchFor("gpuente")).toBe('assignee:"gpuente" sort:updated-desc');
    }),
  );

  it.effect("reads past rows already delivered at an inclusive cursor boundary", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(
        Effect.succeed(output(encodeJson([issue(1), issue(2), issue(3), issue(4), issue(5)]))),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        state: "open",
        limit: 2,
        cursor: {
          updatedBefore: "2026-08-02T00:00:00Z",
          seenAt: [1, 2],
        },
      });

      const call = execute.mock.calls[0]?.[0];
      assert.isDefined(call);
      expect(call.args).toContain("5");
      expect(call.args[call.args.indexOf("--search") + 1]).toBe(
        "updated:<=2026-08-02T00:00:00Z sort:updated-desc",
      );
      expect(result.issues.map(({ number }) => number)).toEqual([1, 2, 3, 4]);
      expect(result.truncated).toBe(true);
    }),
  );

  it.effect("drops list rows whose URL belongs to another repository", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(
        Effect.succeed(
          output(encodeJson([issue(1), issue(2, "https://github.com/other/repo/issues/2")])),
        ),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listIssues({
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        state: "all",
        limit: 10,
      });

      expect(result.issues.map(({ number }) => number)).toEqual([1]);
    }),
  );

  it.effect("refuses a repository selector before invoking GitHub", () =>
    Effect.gen(function* () {
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const exit = yield* Effect.exit(
        cli.listIssues({
          cwd: "/w",
          host: "github.com",
          repository: "acme/web --state closed",
          state: "open",
          limit: 10,
        }),
      );

      expect(exit._tag).toBe("Failure");
      expect(execute).not.toHaveBeenCalled();
    }),
  );

  it.effect("refuses detail URLs outside the selected repository", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(
        Effect.succeed(output(encodeJson(issue(7, "https://github.com/other/repo/issues/7")))),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const exit = yield* Effect.exit(
        cli.getIssue({
          cwd: "/w",
          host: "github.com",
          repository: "acme/web",
          number: 7,
        }),
      );

      expect(exit._tag).toBe("Failure");
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
      execute
        .mockReturnValueOnce(Effect.succeed(output(encodeJson(firstPage))))
        .mockReturnValueOnce(
          Effect.succeed(
            output(
              encodeJson([
                {
                  id: 101,
                  event: "commented",
                  actor: { login: "octocat" },
                  body: "Finished",
                  created_at: "2026-08-03T00:00:00Z",
                },
              ]),
            ),
          ),
        );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const activity = yield* cli.getIssueActivity({
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        number: 7,
      });

      expect(activity.items).toHaveLength(101);
      expect(activity.items.at(-1)).toMatchObject({ type: "comment", body: "Finished" });
      expect(activity.truncated).toBe(false);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls[0]?.[0].args).toContain(
        "repos/acme/web/issues/7/timeline?per_page=100&page=1",
      );
      expect(execute.mock.calls[1]?.[0].args).toContain(
        "repos/acme/web/issues/7/timeline?per_page=100&page=2",
      );
    }),
  );

  it.effect("marks a timeline truncated when its bounded page walk fills", () =>
    Effect.gen(function* () {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        event: "reopened",
        created_at: "2026-08-02T00:00:00Z",
      }));
      execute.mockReturnValue(Effect.succeed(output(encodeJson(fullPage))));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const activity = yield* cli.getIssueActivity({
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        number: 7,
      });

      expect(activity.items).toHaveLength(500);
      expect(activity.truncated).toBe(true);
      expect(execute).toHaveBeenCalledTimes(5);
    }),
  );

  it.effect("reads assignable people, current assignees, and the viewer in one request", () =>
    Effect.gen(function* () {
      execute.mockReturnValueOnce(
        Effect.succeed(
          output(
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
        ),
      );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;

      const result = yield* cli.listAssigneeCandidates({
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        number: 7,
      });

      expect(
        result.candidates.map(({ login, isAssigned, isViewer }) => [login, isAssigned, isViewer]),
      ).toEqual([
        ["octocat", true, true],
        ["hubot", false, false],
      ]);
      const call = execute.mock.calls[0]?.[0];
      assert.isDefined(call);
      expect(call.args).toEqual(["api", "graphql", "--hostname", "github.com", "--input", "-"]);
      expect(decodeJson(call.stdin ?? "")).toMatchObject({
        variables: { owner: "acme", name: "web", number: 7 },
      });
    }),
  );

  it.effect("adds and removes assignees through GitHub's issue collection", () =>
    Effect.gen(function* () {
      execute.mockReturnValue(Effect.succeed(output("{}")));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const input = {
        cwd: "/w",
        host: "github.com",
        repository: "acme/web",
        number: 7,
        assignees: ["octocat"],
      } as const;

      yield* cli.setAssignees({ ...input, assigned: true });
      yield* cli.setAssignees({ ...input, assigned: false });

      expect(execute.mock.calls[0]?.[0].args).toContain("POST");
      expect(execute.mock.calls[1]?.[0].args).toContain("DELETE");
      expect(execute.mock.calls[0]?.[0].args).toContain("repos/acme/web/issues/7/assignees");
      expect(decodeJson(execute.mock.calls[0]?.[0].stdin ?? "")).toEqual({
        assignees: ["octocat"],
      });
    }),
  );

  it.effect("closes with GitHub's reason wording, reopens, and comments from stdin", () =>
    Effect.gen(function* () {
      execute.mockReturnValue(Effect.succeed(output("")));
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const issue = { cwd: "/w", host: "github.com", repository: "acme/web", number: 7 } as const;

      yield* cli.setState({ ...issue, change: { state: "closed", reason: "not_planned" } });
      yield* cli.setState({ ...issue, change: { state: "open" } });
      yield* cli.addComment({ ...issue, body: "--not-a-flag" });

      expect(execute.mock.calls.map(([call]) => call.args)).toEqual([
        ["issue", "close", "7", "--repo", "github.com/acme/web", "--reason", "not planned"],
        ["issue", "reopen", "7", "--repo", "github.com/acme/web"],
        ["issue", "comment", "7", "--repo", "github.com/acme/web", "--body-file", "-"],
      ]);
      expect(execute.mock.calls[2]?.[0].stdin).toBe("--not-a-flag");
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
      execute.mockReturnValueOnce(
        Effect.succeed(
          output(encodeJson(issue(7, "https://github.acme.com/YasielCabrera/vetra-code/issues/7"))),
        ),
      );
      yield* cli.getIssue(target);
      execute.mockReturnValue(Effect.succeed(output("")));
      yield* cli.setState({ ...target, change: { state: "closed", reason: "completed" } });
      yield* cli.addComment({ ...target, body: "Fixed" });
      for (const [call] of execute.mock.calls) {
        expect(call.cwd).toBe("/fork");
        expect(call.args[call.args.indexOf("--repo") + 1]).toBe(
          "github.acme.com/YasielCabrera/vetra-code",
        );
      }
      yield* cli.setAssignees({ ...target, assigned: true, assignees: ["octocat"] });
      const assignment = execute.mock.calls.at(-1)?.[0];
      expect(assignment?.args).toContain("github.acme.com");
      expect(assignment?.args).toContain("repos/YasielCabrera/vetra-code/issues/7/assignees");
    }),
  );

  it.effect("lists bodies when asked and reads close reasons from the issue detail", () =>
    Effect.gen(function* () {
      execute
        .mockReturnValueOnce(Effect.succeed(output(encodeJson([{ ...issue(1), body: "Why" }]))))
        .mockReturnValueOnce(
          Effect.succeed(
            output(encodeJson({ ...issue(2), state: "CLOSED", stateReason: "NOT_PLANNED" })),
          ),
        );
      const cli = yield* GitHubIssueCli.GitHubIssueCli;
      const repository = { cwd: "/w", host: "github.com", repository: "acme/web" } as const;

      const listed = yield* cli.listIssues({
        ...repository,
        state: "open",
        limit: 50,
        includeBody: true,
      });
      const closed = yield* cli.getIssue({ ...repository, number: 2 });

      const fieldsOf = (index: number) => {
        const args = execute.mock.calls[index]?.[0].args ?? [];
        return args[args.indexOf("--json") + 1];
      };
      expect([fieldsOf(0), fieldsOf(1)]).toEqual([
        "assignees,author,closedAt,createdAt,labels,milestone,number,state,title,updatedAt,url,body",
        "assignees,author,closedAt,createdAt,labels,milestone,number,state,title,updatedAt,url,body,comments,stateReason",
      ]);
      expect([listed.issues[0]?.body, closed.state, closed.stateReason]).toEqual([
        "Why",
        "closed",
        "not_planned",
      ]);
    }),
  );
});
