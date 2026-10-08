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

import * as GitHubApi from "../sourceControl/GitHubApi.ts";
import type { IssueStateChange, ProviderIssueListCursor } from "./IssueProvider.ts";
import {
  decodeIssueAssigneeCandidatesJson,
  decodeIssueDetailJson,
  decodeIssueListJson,
  decodeIssueTimelineJson,
  ISSUE_ASSIGNEE_CANDIDATES_GRAPHQL_QUERY,
  ISSUE_DETAIL_GRAPHQL_QUERY,
  ISSUE_SEARCH_GRAPHQL_QUERY,
  type GitHubIssue,
} from "./githubIssueJson.ts";

// A REST page cut at its cap is refused here as a `GitHubIssueReadError`; `GitHubApi` refuses a
// cut GraphQL body itself, which arrives as a `GitHubApiResponseError`.
const MAX_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DETAIL_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TIMELINE_PAGE_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ASSIGNEE_CANDIDATES_RESPONSE_BYTES = 2 * 1024 * 1024;
/** GraphQL `search` hands back at most this many rows per page. */
const SEARCH_PAGE_SIZE = 100;
const TIMELINE_PAGE_SIZE = 100;
const MAX_TIMELINE_PAGES = 5;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

export class GitHubIssueReadError extends Schema.TaggedError<GitHubIssueReadError>()(
  "GitHubIssueReadError",
  {
    cwd: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type GitHubIssueCliError = GitHubApi.GitHubApiError | GitHubIssueReadError;

export interface GitHubIssueBatch {
  readonly issues: ReadonlyArray<GitHubIssue>;
  readonly truncated: boolean;
}

/** GitHub issue reads and writes, made through the GitHub API with the server's credential. */
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

/** `owner/name`, with no `.` or `..` part that would climb out of a REST path. */
function validRepository(repository: string): boolean {
  return (
    REPOSITORY_PATTERN.test(repository) &&
    repository.split("/").every((part) => part !== "." && part !== "..")
  );
}

/** User text is one escaped phrase, never a GitHub search qualifier. */
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

/** The whole search: the repository's issues in one state, then the caller's narrowing. */
function searchQuery(input: {
  readonly repository: string;
  readonly state: "all" | "open" | "closed";
  readonly query?: string;
  readonly assignee?: string;
  readonly cursor?: ProviderIssueListCursor;
}): string {
  const query = input.query?.trim() ?? "";
  return [
    `repo:${input.repository}`,
    "is:issue",
    ...(input.state === "all" ? [] : [`is:${input.state}`]),
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
  const api = yield* GitHubApi.GitHubApi;

  const unaddressable = (cwd: string, operation: string) =>
    new GitHubIssueReadError({
      cwd,
      operation,
      detail: "A repository was named that GitHub cannot address.",
    });

  /** `repos/<owner>/<name>/issues/<number>`, for an already validated repository. */
  const issuePath = (input: { readonly repository: string; readonly number: number }) =>
    `repos/${input.repository}/issues/${input.number}`;

  // The background sync and a user's view share `listIssues` and `getIssue`, so those, like the
  // writes, follow the caller's `AllowGitHubReserve`. Activity and assignee candidates are only
  // read for a user's open view, so they may always spend the reserve.

  const listIssues: GitHubIssueCli["Service"]["listIssues"] = Effect.fn(
    "GitHubIssueCli.listIssues",
  )(function* (input) {
    if (!validRepository(input.repository)) {
      return yield* unaddressable(input.cwd, "listIssues");
    }
    // A continued query includes the already-delivered boundary rows. Ask past them, plus one
    // probe row, so a large group sharing one update instant cannot strand older issues.
    const usableRows = input.limit + (input.cursor?.seenAt.length ?? 0);
    // That can pass GraphQL's 100-row page, so the search is read page by page.
    const wanted = usableRows + 1;
    const query = searchQuery(input);
    const issues: GitHubIssue[] = [];
    let rawCount = 0;
    let after: string | null = null;
    do {
      const raw: string = yield* api.graphql({
        host: input.host,
        operation: "listIssues",
        query: ISSUE_SEARCH_GRAPHQL_QUERY,
        variables: {
          query,
          first: Math.min(SEARCH_PAGE_SIZE, wanted - rawCount),
          after,
          withBody: input.includeBody === true,
        },
        maxResponseBytes:
          input.includeBody === true ? MAX_DETAIL_RESPONSE_BYTES : MAX_LIST_RESPONSE_BYTES,
      });
      const decoded = decodeIssueListJson(raw);
      if (!Result.isSuccess(decoded)) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "listIssues",
          detail: "GitHub returned an unreadable issue list.",
          cause: decoded.failure,
        });
      }
      issues.push(...decoded.success.items);
      rawCount += decoded.success.rawCount;
      after = decoded.success.rawCount === 0 ? null : decoded.success.endCursor;
    } while (after !== null && rawCount < wanted);
    const valid = issues.flatMap((issue) => {
      const url = expectedIssueUrl(issue.url, input.host, input.repository, issue.number);
      return url === null ? [] : [{ ...issue, url }];
    });
    return { issues: valid.slice(0, usableRows), truncated: rawCount > usableRows };
  });

  const getIssue: GitHubIssueCli["Service"]["getIssue"] = Effect.fn("GitHubIssueCli.getIssue")(
    function* (input) {
      if (!validRepository(input.repository)) {
        return yield* unaddressable(input.cwd, "getIssue");
      }
      const [owner, name] = input.repository.split("/");
      // A missing issue or repository is a NOT_FOUND answer, which the API fails as not found.
      const raw = yield* api.graphql({
        host: input.host,
        operation: "getIssue",
        query: ISSUE_DETAIL_GRAPHQL_QUERY,
        variables: { owner, name, number: input.number },
        maxResponseBytes: MAX_DETAIL_RESPONSE_BYTES,
      });
      const decoded = decodeIssueDetailJson(raw);
      if (!Result.isSuccess(decoded)) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "getIssue",
          detail: "GitHub returned unreadable issue details.",
          cause: decoded.failure,
        });
      }
      if (decoded.success === null) {
        return yield* new GitHubApi.GitHubApiNotFoundError({
          host: input.host,
          operation: "getIssue",
        });
      }
      const url = expectedIssueUrl(decoded.success.url, input.host, input.repository, input.number);
      if (url === null) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "getIssue",
          detail: "GitHub returned an issue URL outside the selected repository.",
        });
      }
      return { ...decoded.success, url };
    },
  );

  const getIssueActivity: GitHubIssueCli["Service"]["getIssueActivity"] = Effect.fn(
    "GitHubIssueCli.getIssueActivity",
  )(function* (input) {
    if (!validRepository(input.repository)) {
      return yield* unaddressable(input.cwd, "getIssueActivity");
    }
    const items: IssueActivity["items"][number][] = [];
    for (let page = 1; page <= MAX_TIMELINE_PAGES; page += 1) {
      const response = yield* api.rest({
        host: input.host,
        operation: "getIssueActivity",
        path: `${issuePath(input)}/timeline?per_page=${TIMELINE_PAGE_SIZE}&page=${page}`,
        maxResponseBytes: MAX_TIMELINE_PAGE_RESPONSE_BYTES,
        allowReserve: true,
      });
      if (response.truncated) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "getIssueActivity",
          detail: `GitHub returned timeline page ${page} larger than the safe response limit.`,
        });
      }
      const decoded = decodeIssueTimelineJson(response.body.trim() || "[]", input.host);
      if (!Result.isSuccess(decoded)) {
        return yield* new GitHubIssueReadError({
          cwd: input.cwd,
          operation: "getIssueActivity",
          detail: "GitHub returned an unreadable issue timeline.",
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

  const listAssigneeCandidates: GitHubIssueCli["Service"]["listAssigneeCandidates"] = Effect.fn(
    "GitHubIssueCli.listAssigneeCandidates",
  )(function* (input) {
    if (!validRepository(input.repository)) {
      return yield* unaddressable(input.cwd, "listAssigneeCandidates");
    }
    const [owner, name] = input.repository.split("/");
    const raw = yield* api.graphql({
      host: input.host,
      operation: "listAssigneeCandidates",
      query: ISSUE_ASSIGNEE_CANDIDATES_GRAPHQL_QUERY,
      variables: { owner, name, number: input.number },
      maxResponseBytes: MAX_ASSIGNEE_CANDIDATES_RESPONSE_BYTES,
      allowReserve: true,
    });
    const decoded = decodeIssueAssigneeCandidatesJson(raw);
    if (!Result.isSuccess(decoded)) {
      return yield* new GitHubIssueReadError({
        cwd: input.cwd,
        operation: "listAssigneeCandidates",
        detail: "GitHub returned an unreadable assignee list.",
        cause: decoded.failure,
      });
    }
    return decoded.success;
  });

  const setAssignees: GitHubIssueCli["Service"]["setAssignees"] = Effect.fn(
    "GitHubIssueCli.setAssignees",
  )(function* (input) {
    if (!validRepository(input.repository)) {
      return yield* unaddressable(input.cwd, "setAssignees");
    }
    yield* api.rest({
      host: input.host,
      operation: "setAssignees",
      method: input.assigned ? "POST" : "DELETE",
      path: `${issuePath(input)}/assignees`,
      body: { assignees: input.assignees },
    });
  });

  const setState: GitHubIssueCli["Service"]["setState"] = Effect.fn("GitHubIssueCli.setState")(
    function* (input) {
      if (!validRepository(input.repository)) {
        return yield* unaddressable(input.cwd, "setState");
      }
      yield* api.rest({
        host: input.host,
        operation: "setState",
        method: "PATCH",
        path: issuePath(input),
        body:
          input.change.state === "open"
            ? { state: "open" }
            : { state: "closed", state_reason: input.change.reason },
      });
    },
  );

  const addComment: GitHubIssueCli["Service"]["addComment"] = Effect.fn(
    "GitHubIssueCli.addComment",
  )(function* (input) {
    if (!validRepository(input.repository)) {
      return yield* unaddressable(input.cwd, "addComment");
    }
    yield* api.rest({
      host: input.host,
      operation: "addComment",
      method: "POST",
      path: `${issuePath(input)}/comments`,
      body: { body: input.body },
    });
  });

  return GitHubIssueCli.of({
    listIssues,
    getIssue,
    getIssueActivity,
    listAssigneeCandidates,
    setAssignees,
    setState,
    addComment,
  });
});

export const layer = Layer.effect(GitHubIssueCli, make);
