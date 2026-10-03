import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  ISSUE_ASSIGNEE_NOBODY,
  ISSUE_ASSIGNEE_VIEWER,
  type IssueActivity,
  type IssueAssigneeCandidateList,
} from "@t3tools/contracts";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type { IssueStateChange, ProviderIssueListCursor } from "./IssueProvider.ts";
import {
  decodeIssueAssigneeCandidatesJson,
  decodeIssueDetailJson,
  decodeIssueListJson,
  decodeIssueTimelineJson,
  ISSUE_ASSIGNEE_CANDIDATES_GRAPHQL_QUERY,
  type GitHubIssue,
} from "./githubIssueJson.ts";

const LIST_FIELDS =
  "assignees,author,closedAt,createdAt,labels,milestone,number,state,title,updatedAt,url";
const DETAIL_FIELDS = `${LIST_FIELDS},body,comments,stateReason`;
const MAX_LIST_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TIMELINE_PAGE_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ASSIGNEE_CANDIDATES_OUTPUT_BYTES = 2 * 1024 * 1024;
const TIMELINE_PAGE_SIZE = 100;
const MAX_TIMELINE_PAGES = 5;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export class GitHubIssueReadError extends Schema.TaggedError<GitHubIssueReadError>()(
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
      readonly assignee?: string;
      readonly cursor?: ProviderIssueListCursor;
      readonly includeBody?: boolean;
    }) => Effect.Effect<GitHubIssueBatch, GitHubIssueCliError>;
    readonly getIssue: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<GitHubIssue, GitHubIssueCliError>;
    readonly getIssueActivity: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<IssueActivity, GitHubIssueCliError>;
    readonly listAssigneeCandidates: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<IssueAssigneeCandidateList, GitHubIssueCliError>;
    readonly setAssignees: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly assignees: ReadonlyArray<string>;
      readonly assigned: boolean;
    }) => Effect.Effect<void, GitHubIssueCliError>;
    readonly setState: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly change: IssueStateChange;
    }) => Effect.Effect<void, GitHubIssueCliError>;
    readonly addComment: (input: {
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly body: string;
    }) => Effect.Effect<void, GitHubIssueCliError>;
  }
>()("t3/issue/GitHubIssueCli") {}

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

/**
 * The assignee narrowing as GitHub spells it. The two sentinels are written literally because
 * that is the only way GitHub reads them: quoted, `@me` is an account nobody has, and there is
 * no `assignee:` value at all for "nobody" — that one is its own `no:` qualifier. An account
 * name is quoted, which the contract's pattern has already made redundant.
 */
function assigneeQualifier(assignee: string): string {
  if (assignee === ISSUE_ASSIGNEE_VIEWER) return "assignee:@me";
  if (assignee === ISSUE_ASSIGNEE_NOBODY) return "no:assignee";
  return `assignee:"${assignee.replaceAll('"', "").trim()}"`;
}

function searchQuery(input: {
  readonly query?: string;
  readonly assignee?: string;
  readonly cursor?: ProviderIssueListCursor;
}): string {
  const query = input.query?.trim() ?? "";
  return [
    ...(query.length === 0 ? [] : [searchPhrase(query)]),
    ...(input.assignee === undefined ? [] : [assigneeQualifier(input.assignee)]),
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

  const getIssueActivity: GitHubIssueCli["Service"]["getIssueActivity"] = Effect.fn(
    "GitHubIssueCli.getIssueActivity",
  )(function* (input) {
    if (!validRepository(input.repository)) {
      return yield* rejectRepository(input.cwd, "getIssueActivity");
    }
    const items: IssueActivity["items"][number][] = [];
    for (let page = 1; page <= MAX_TIMELINE_PAGES; page += 1) {
      const output = yield* github.execute({
        cwd: input.cwd,
        args: [
          "api",
          "--hostname",
          input.host,
          "-H",
          "Accept: application/vnd.github+json",
          `repos/${input.repository}/issues/${input.number}/timeline?per_page=${TIMELINE_PAGE_SIZE}&page=${page}`,
        ],
        maxOutputBytes: MAX_TIMELINE_PAGE_OUTPUT_BYTES,
      });
      if (output.stdoutTruncated) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "getIssueActivity",
          detail: `GitHub returned timeline page ${page} larger than the safe response limit.`,
        });
      }
      const decoded = decodeIssueTimelineJson(output.stdout.trim() || "[]", input.host);
      if (!Result.isSuccess(decoded)) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "getIssueActivity",
          detail: "GitHub CLI returned an unreadable issue timeline.",
          cause: decoded.failure,
        });
      }
      items.push(...decoded.success.items);
      if (decoded.success.rawCount < TIMELINE_PAGE_SIZE) {
        return { items, truncated: false };
      }
    }
    return { items, truncated: true };
  });

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
            input.includeBody === true ? `${LIST_FIELDS},body` : LIST_FIELDS,
            "--search",
            searchQuery(input),
          ],
          maxOutputBytes:
            input.includeBody === true ? MAX_DETAIL_OUTPUT_BYTES : MAX_LIST_OUTPUT_BYTES,
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
    listAssigneeCandidates: (input) => {
      if (!validRepository(input.repository)) {
        return rejectRepository(input.cwd, "listAssigneeCandidates");
      }
      const [owner, name] = input.repository.split("/");
      return github
        .execute({
          cwd: input.cwd,
          args: ["api", "graphql", "--hostname", input.host, "--input", "-"],
          stdin: encodeJson({
            query: ISSUE_ASSIGNEE_CANDIDATES_GRAPHQL_QUERY,
            variables: { owner, name, number: input.number },
          }),
          maxOutputBytes: MAX_ASSIGNEE_CANDIDATES_OUTPUT_BYTES,
        })
        .pipe(
          Effect.flatMap((output) => {
            if (output.stdoutTruncated) {
              return Effect.fail(
                new GitHubIssueReadError({
                  cwd: input.cwd,
                  operation: "listAssigneeCandidates",
                  detail: "GitHub returned an assignee list larger than the safe response limit.",
                }),
              );
            }
            const decoded = decodeIssueAssigneeCandidatesJson(output.stdout.trim());
            return Result.isSuccess(decoded)
              ? Effect.succeed(decoded.success)
              : Effect.fail(
                  new GitHubIssueReadError({
                    cwd: input.cwd,
                    operation: "listAssigneeCandidates",
                    detail: "GitHub CLI returned an unreadable assignee list.",
                    cause: decoded.failure,
                  }),
                );
          }),
        );
    },
    setAssignees: (input) => {
      if (!validRepository(input.repository)) return rejectRepository(input.cwd, "setAssignees");
      return github
        .execute({
          cwd: input.cwd,
          args: [
            "api",
            "--method",
            input.assigned ? "POST" : "DELETE",
            "--hostname",
            input.host,
            `repos/${input.repository}/issues/${input.number}/assignees`,
            "--input",
            "-",
          ],
          stdin: encodeJson({ assignees: input.assignees }),
        })
        .pipe(Effect.asVoid);
    },
    setState: (input) => {
      if (!validRepository(input.repository)) return rejectRepository(input.cwd, "setState");
      return github
        .execute({
          cwd: input.cwd,
          args:
            input.change.state === "open"
              ? [
                  "issue",
                  "reopen",
                  String(input.number),
                  ...repositoryArgs(input.host, input.repository),
                ]
              : [
                  "issue",
                  "close",
                  String(input.number),
                  ...repositoryArgs(input.host, input.repository),
                  "--reason",
                  input.change.reason === "not_planned" ? "not planned" : "completed",
                ],
        })
        .pipe(Effect.asVoid);
    },
    addComment: (input) => {
      if (!validRepository(input.repository)) return rejectRepository(input.cwd, "addComment");
      return github
        .execute({
          cwd: input.cwd,
          args: [
            "issue",
            "comment",
            String(input.number),
            ...repositoryArgs(input.host, input.repository),
            "--body-file",
            "-",
          ],
          stdin: input.body,
        })
        .pipe(Effect.asVoid);
    },
    getIssueActivity,
  });
});

export const layer = Layer.effect(GitHubIssueCli, make);
