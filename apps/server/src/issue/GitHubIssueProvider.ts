import * as Effect from "effect/Effect";

import * as GitHubIssueCli from "./GitHubIssueCli.ts";
import { IssueProviderError, type IssueProviderApi } from "./IssueProvider.ts";

const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

function originOf(host: string): string | null {
  try {
    const url = new URL(`https://${host}`);
    if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function providerError(operation: string) {
  return (error: GitHubIssueCli.GitHubIssueCliError): IssueProviderError => {
    const reason =
      error._tag === "GitHubCliUnavailableError"
        ? "missing-tool"
        : error._tag === "GitHubCliAuthenticationError"
          ? "unauthenticated"
          : error._tag === "GitHubCliRateLimitError"
            ? "rate-limited"
            : "failed";
    const detail =
      reason === "missing-tool"
        ? "GitHub CLI (`gh`) is not available."
        : reason === "unauthenticated"
          ? "GitHub CLI is not authenticated."
          : reason === "rate-limited"
            ? "GitHub's request limit has been reached."
            : error._tag === "GitHubPullRequestNotFoundError"
              ? "The issue was not found."
              : "GitHub could not complete the issue request.";
    return new IssueProviderError({
      provider: "github",
      operation,
      reason,
      detail,
      cause: error,
    });
  };
}

export const make = Effect.map(
  GitHubIssueCli.GitHubIssueCli,
  (github): IssueProviderApi => ({
    kind: "github",
    repositoryLinks: ({ host, repository }) => {
      const origin = originOf(host);
      if (origin === null || !REPOSITORY_PATTERN.test(repository)) return null;
      const path = repository.split("/").map(encodeURIComponent).join("/");
      return {
        repositoryUrl: `${origin}/${path}`,
        newIssueUrl: `${origin}/${path}/issues/new`,
      };
    },
    listIssues: (input) =>
      github.listIssues(input).pipe(
        Effect.map(({ issues, truncated }) => ({ issues, truncated })),
        Effect.mapError(providerError("list")),
      ),
    getIssue: (input) => github.getIssue(input).pipe(Effect.mapError(providerError("detail"))),
  }),
);
