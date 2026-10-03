import * as Effect from "effect/Effect";
import type { IssueActivity, IssueActor, IssueComment } from "@t3tools/contracts";

import { gitHubLoginAvatarUrl } from "@t3tools/shared/githubActor";
import * as GitHubIssueCli from "./GitHubIssueCli.ts";
import type { GitHubIssue } from "./githubIssueJson.ts";
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

function withAvatar(actor: IssueActor | null, host: string): IssueActor | null {
  if (actor === null || actor.avatarUrl !== null) return actor;
  const avatarUrl = gitHubLoginAvatarUrl(actor.login, host);
  return avatarUrl === null ? actor : { ...actor, avatarUrl };
}

/** `gh issue --json` names actors but omits their avatars, so fill them at the adapter edge. */
function withAvatars(issue: GitHubIssue, host: string): GitHubIssue {
  const commentWithAvatar = (comment: IssueComment): IssueComment => ({
    ...comment,
    author: withAvatar(comment.author, host),
  });
  return {
    ...issue,
    author: withAvatar(issue.author, host),
    assignees: issue.assignees.map((assignee) => withAvatar(assignee, host) ?? assignee),
    comments: issue.comments.map(commentWithAvatar),
  };
}

function activityWithAvatars(activity: IssueActivity, host: string): IssueActivity {
  return {
    ...activity,
    items: activity.items.map((item) =>
      item.type === "comment"
        ? { ...item, actor: withAvatar(item.actor, host) }
        : {
            ...item,
            actor: withAvatar(item.actor, host),
            assignee: withAvatar(item.assignee, host),
          },
    ),
  };
}

export const make = Effect.map(GitHubIssueCli.GitHubIssueCli, (github): IssueProviderApi => ({
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
      Effect.map(({ issues, truncated }) => ({
        issues: issues.map((issue) => withAvatars(issue, input.host)),
        truncated,
      })),
      Effect.mapError(providerError("list")),
    ),
  getIssue: (input) =>
    github.getIssue(input).pipe(
      Effect.map((issue) => withAvatars(issue, input.host)),
      Effect.mapError(providerError("detail")),
    ),
  getIssueActivity: (input) =>
    github.getIssueActivity(input).pipe(
      Effect.map((activity) => activityWithAvatars(activity, input.host)),
      Effect.mapError(providerError("activity")),
    ),
  listAssigneeCandidates: (input) =>
    github.listAssigneeCandidates(input).pipe(Effect.mapError(providerError("assigneeCandidates"))),
  setAssignees: (input) =>
    github.setAssignees(input).pipe(Effect.mapError(providerError("setAssignees"))),
  setState: (input) => github.setState(input).pipe(Effect.mapError(providerError("setState"))),
  addComment: (input) =>
    github.addComment(input).pipe(Effect.mapError(providerError("addComment"))),
}));
