import { expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  decodeIssueAssigneeCandidatesJson,
  decodeIssueDetailJson,
  decodeIssueListJson,
  decodeIssueTimelineJson,
} from "./githubIssueJson.ts";

const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

function issue(number: number, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/web/issues/${number}`,
    author: { login: " octocat " },
    state: "OPEN",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    labels: [{ name: " bug ", color: "FF0000", description: "A defect" }],
    ...overrides,
  };
}

it("skips malformed list rows while preserving the raw count", () => {
  const decoded = decodeIssueListJson(encodeJson([issue(1), { title: "missing number" }]));

  expect(Result.isSuccess(decoded)).toBe(true);
  if (!Result.isSuccess(decoded)) return;
  expect(decoded.success.rawCount).toBe(2);
  expect(decoded.success.items).toHaveLength(1);
  expect(decoded.success.items[0]?.author?.login).toBe("octocat");
  expect(decoded.success.items[0]?.labels[0]).toEqual({
    name: "bug",
    color: "ff0000",
    description: "A defect",
  });
});

it("drops unsafe label colors rather than placing them in CSS", () => {
  const decoded = decodeIssueListJson(
    encodeJson([issue(1, { labels: [{ name: "bug", color: "red;display:none" }] })]),
  );

  expect(Result.isSuccess(decoded)).toBe(true);
  if (!Result.isSuccess(decoded)) return;
  expect(decoded.success.items[0]?.labels[0]?.color).toBeNull();
});

it("bounds a detail conversation and reports that more comments exist", () => {
  const comments = Array.from({ length: 101 }, (_, index) => ({
    id: `c${index}`,
    author: { login: "hubot" },
    body: `Comment ${index}`,
    createdAt: "2026-08-02T00:00:00Z",
  }));
  const decoded = decodeIssueDetailJson(encodeJson(issue(1, { body: "Body", comments })));

  expect(Result.isSuccess(decoded)).toBe(true);
  if (!Result.isSuccess(decoded)) return;
  expect(decoded.success.comments).toHaveLength(100);
  expect(decoded.success.commentCount).toBe(101);
  expect(decoded.success.commentsTruncated).toBe(true);
});

it("normalizes comments and contextual events from GitHub's issue timeline", () => {
  const decoded = decodeIssueTimelineJson(
    encodeJson([
      {
        id: 1,
        event: "commented",
        actor: {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        },
        body: "Confirmed",
        created_at: "2026-08-02T00:00:00Z",
        updated_at: "2026-08-02T01:00:00Z",
        html_url: "https://github.com/acme/web/issues/7#issuecomment-1",
      },
      {
        id: 2,
        event: "labeled",
        actor: { login: "hubot" },
        label: { name: " bug ", color: "FF0000" },
        created_at: "2026-08-03T00:00:00Z",
      },
      {
        id: 3,
        event: "cross-referenced",
        actor: { login: "monalisa" },
        created_at: "2026-08-04T00:00:00Z",
        source: {
          issue: {
            number: 9,
            title: "Related work",
            html_url: "https://github.com/acme/api/pull/9",
            pull_request: {},
          },
        },
      },
    ]),
    "github.com",
  );

  expect(Result.isSuccess(decoded)).toBe(true);
  if (!Result.isSuccess(decoded)) return;
  expect(decoded.success.rawCount).toBe(3);
  expect(decoded.success.items[0]).toMatchObject({
    type: "comment",
    actor: { login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    body: "Confirmed",
  });
  expect(decoded.success.items[1]).toMatchObject({
    type: "event",
    kind: "labeled",
    label: { name: "bug", color: "ff0000" },
  });
  expect(decoded.success.items[2]).toMatchObject({
    type: "event",
    source: {
      repository: "acme/api",
      number: 9,
      isPullRequest: true,
    },
  });
});

it("keeps a cross-reference from another host out of the timeline context", () => {
  const decoded = decodeIssueTimelineJson(
    encodeJson([
      {
        event: "cross-referenced",
        created_at: "2026-08-04T00:00:00Z",
        source: {
          issue: {
            number: 9,
            title: "Spoofed work",
            html_url: "https://example.com/acme/api/issues/9",
          },
        },
      },
    ]),
    "github.com",
  );

  expect(Result.isSuccess(decoded)).toBe(true);
  if (!Result.isSuccess(decoded)) return;
  expect(decoded.success.items[0]).toMatchObject({ type: "event", source: null });
});

it("marks the viewer and current assignees in the issue candidate list", () => {
  const decoded = decodeIssueAssigneeCandidatesJson(
    encodeJson({
      data: {
        viewer: { login: "octocat" },
        repository: {
          assignableUsers: {
            pageInfo: { hasNextPage: true },
            nodes: [
              { login: "octocat", name: "The Octocat", avatarUrl: "https://avatars.test/o" },
              { login: "hubot" },
            ],
          },
          issue: {
            assignees: { nodes: [{ login: "octocat" }, { login: "outside" }] },
          },
        },
      },
    }),
  );

  expect(Result.isSuccess(decoded)).toBe(true);
  if (!Result.isSuccess(decoded)) return;
  expect(decoded.success.candidates).toEqual([
    {
      id: "octocat",
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.test/o",
      isAssigned: true,
      isViewer: true,
    },
    {
      id: "outside",
      login: "outside",
      name: null,
      avatarUrl: null,
      isAssigned: true,
      isViewer: false,
    },
    {
      id: "hubot",
      login: "hubot",
      name: null,
      avatarUrl: null,
      isAssigned: false,
      isViewer: false,
    },
  ]);
  expect(decoded.success.truncated).toBe(true);
});
