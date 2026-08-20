import { afterEach, assert, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubIssueCli from "./GitHubIssueCli.ts";

const execute = vi.fn<GitHubCli.GitHubCli["Service"]["execute"]>();
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
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
});
