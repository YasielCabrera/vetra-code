import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type { ProviderIssueListCursor } from "./IssueProvider.ts";
import { decodeIssueDetailJson, decodeIssueListJson, type GitHubIssue } from "./githubIssueJson.ts";

const LIST_FIELDS =
  "assignees,author,closedAt,createdAt,labels,milestone,number,state,title,updatedAt,url";
const DETAIL_FIELDS = `${LIST_FIELDS},body,comments`;
const MAX_LIST_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL_OUTPUT_BYTES = 4 * 1024 * 1024;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

export class GitHubIssueReadError extends Schema.TaggedErrorClass<GitHubIssueReadError>()(
  "GitHubIssueReadError",
  {
    cwd: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type GitHubIssueCliError = GitHubCli.GitHubCliError | GitHubIssueReadError;

export interface GitHubIssueBatch {
  readonly issues: ReadonlyArray<GitHubIssue>;
  readonly truncated: boolean;
}

export class GitHubIssueCli extends Context.Service<
  GitHubIssueCli,
  {
    readonly listIssues: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly state: "all" | "open" | "closed";
      readonly limit: number;
      readonly query?: string;
      readonly cursor?: ProviderIssueListCursor;
    }) => Effect.Effect<GitHubIssueBatch, GitHubIssueCliError>;
    readonly getIssue: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<GitHubIssue, GitHubIssueCliError>;
  }
>()("@vetra-code/server/issue/GitHubIssueCli") {}

function validRepository(repository: string): boolean {
  return REPOSITORY_PATTERN.test(repository);
}

function repositoryArgs(host: string, repository: string): ReadonlyArray<string> {
  return ["--repo", `${host}/${repository}`];
}

/** User text is one escaped phrase, never a GitHub search qualifier or a CLI flag. */
function searchPhrase(query: string): string {
  return `"${query.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function searchQuery(input: {
  readonly query?: string;
  readonly cursor?: ProviderIssueListCursor;
}): string {
  const query = input.query?.trim() ?? "";
  return [
    ...(query.length === 0 ? [] : [searchPhrase(query)]),
    // Inclusive so issues sharing the boundary instant remain reachable; the service drops the
    // numbers it has already delivered at that instant.
    ...(input.cursor === undefined ? [] : [`updated:<=${input.cursor.updatedBefore}`]),
    // A continuation only has meaning in the same deterministic order on every page.
    "sort:updated-desc",
  ].join(" ");
}

function expectedIssueUrl(
  raw: string,
  host: string,
  repository: string,
  number: number,
): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.host !== host) {
      return null;
    }
    const expectedPath = `/${repository}/issues/${number}`.toLowerCase();
    if (decodeURIComponent(url.pathname).toLowerCase() !== expectedPath) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const make = Effect.gen(function* () {
  const github = yield* GitHubCli.GitHubCli;

  const rejectRepository = (cwd: string, operation: string) =>
    Effect.fail(
      new GitHubIssueReadError({
        cwd,
        operation,
        detail: "A repository was named that GitHub cannot address.",
      }),
    );

  return GitHubIssueCli.of({
    listIssues: (input) => {
      if (!validRepository(input.repository)) return rejectRepository(input.cwd, "listIssues");
      // A continued query includes the already-delivered boundary rows. Ask past them, plus one
      // probe row, so a large group sharing one update instant cannot strand older issues.
      const usableRows = input.limit + (input.cursor?.seenAt.length ?? 0);
      return github
        .execute({
          cwd: input.cwd,
          args: [
            "issue",
            "list",
            ...repositoryArgs(input.host, input.repository),
            "--state",
            input.state,
            "--limit",
            String(usableRows + 1),
            "--json",
            LIST_FIELDS,
            "--search",
            searchQuery(input),
          ],
          maxOutputBytes: MAX_LIST_OUTPUT_BYTES,
        })
        .pipe(
          Effect.flatMap((output) => {
            if (output.stdoutTruncated) {
              return Effect.fail(
                new GitHubIssueReadError({
                  cwd: input.cwd,
                  operation: "listIssues",
                  detail: "GitHub returned an issue list larger than the safe response limit.",
                }),
              );
            }
            const decoded = decodeIssueListJson(output.stdout.trim() || "[]");
            if (!Result.isSuccess(decoded)) {
              return Effect.fail(
                new GitHubIssueReadError({
                  cwd: input.cwd,
                  operation: "listIssues",
                  detail: "GitHub CLI returned an unreadable issue list.",
                  cause: decoded.failure,
                }),
              );
            }
            const valid = decoded.success.items.flatMap((issue) => {
              const url = expectedIssueUrl(issue.url, input.host, input.repository, issue.number);
              return url === null ? [] : [{ ...issue, url }];
            });
            return Effect.succeed({
              issues: valid.slice(0, usableRows),
              truncated: decoded.success.rawCount > usableRows,
            });
          }),
        );
    },
    getIssue: (input) => {
      if (!validRepository(input.repository)) return rejectRepository(input.cwd, "getIssue");
      return github
        .execute({
          cwd: input.cwd,
          args: [
            "issue",
            "view",
            String(input.number),
            ...repositoryArgs(input.host, input.repository),
            "--comments",
            "--json",
            DETAIL_FIELDS,
          ],
          maxOutputBytes: MAX_DETAIL_OUTPUT_BYTES,
        })
        .pipe(
          Effect.flatMap((output) => {
            if (output.stdoutTruncated) {
              return Effect.fail(
                new GitHubIssueReadError({
                  cwd: input.cwd,
                  operation: "getIssue",
                  detail: "GitHub returned issue details larger than the safe response limit.",
                }),
              );
            }
            const decoded = decodeIssueDetailJson(output.stdout.trim());
            if (!Result.isSuccess(decoded)) {
              return Effect.fail(
                new GitHubIssueReadError({
                  cwd: input.cwd,
                  operation: "getIssue",
                  detail: "GitHub CLI returned unreadable issue details.",
                  cause: decoded.failure,
                }),
              );
            }
            const url = expectedIssueUrl(
              decoded.success.url,
              input.host,
              input.repository,
              input.number,
            );
            return url === null
              ? Effect.fail(
                  new GitHubIssueReadError({
                    cwd: input.cwd,
                    operation: "getIssue",
                    detail: "GitHub returned an issue URL outside the selected repository.",
                  }),
                )
              : Effect.succeed({ ...decoded.success, url });
          }),
        );
    },
  });
});

export const layer = Layer.effect(GitHubIssueCli, make);
