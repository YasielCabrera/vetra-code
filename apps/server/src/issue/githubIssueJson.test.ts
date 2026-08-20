import { expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { decodeIssueDetailJson, decodeIssueListJson } from "./githubIssueJson.ts";

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
