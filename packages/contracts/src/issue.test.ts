import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  IssueActivity,
  IssueAssigneeChangeInput,
  IssueListInput,
  IssueListResult,
  type ProjectId,
} from "./index.ts";

const decodeInput = Schema.decodeUnknownSync(IssueListInput);

describe("IssueListInput", () => {
  it("trims and bounds search text before it reaches a host query", () => {
    expect(decodeInput({ state: "open", query: "  broken login  " }).query).toBe("broken login");
    expect(decodeInput({ state: "open", query: "x".repeat(200) }).query).toHaveLength(200);
    expect(() => decodeInput({ state: "open", query: "x".repeat(201) })).toThrow();
  });

  it("bounds the per-repository page to one GitHub API page", () => {
    expect(decodeInput({ state: "all", limit: 99 }).limit).toBe(99);
    expect(() => decodeInput({ state: "all", limit: 100 })).toThrow();
  });

  it("accepts the assignee sentinels and account names, and nothing that could add a qualifier", () => {
    expect(decodeInput({ state: "open", assignee: "@me" }).assignee).toBe("@me");
    expect(decodeInput({ state: "open", assignee: "@none" }).assignee).toBe("@none");
    expect(decodeInput({ state: "open", assignee: "  gpuente  " }).assignee).toBe("gpuente");
    // Each of these would end the qualifier it is written into and start another.
    for (const assignee of [
      "gpuente sort:created-asc",
      "gpuente state:closed",
      'gpuente"',
      "-gpuente",
      "@someone",
      "x".repeat(65),
    ]) {
      expect(() => decodeInput({ state: "open", assignee })).toThrow();
    }
  });

  it("bounds opaque continuation cursors before they reach the service", () => {
    expect(
      decodeInput({ state: "open", cursors: { "github.com acme/web": "cursor-1" } }).cursors,
    ).toEqual({ "github.com acme/web": "cursor-1" });
    expect(() =>
      decodeInput({ state: "open", cursors: { "github.com acme/web": "x".repeat(4097) } }),
    ).toThrow();
  });
});

describe("IssueListResult", () => {
  it("round-trips through the RPC JSON codec", () => {
    const result: IssueListResult = {
      providers: [
        {
          host: "github.com",
          kind: "github",
          projectCount: 1,
          configured: true,
          detail: null,
        },
      ],
      repositories: [
        {
          provider: "github",
          host: "github.com",
          projectId: "p1" as ProjectId,
          projectTitle: "web",
          repository: "acme/web",
          repositoryUrl: "https://github.com/acme/web",
          newIssueUrl: "https://github.com/acme/web/issues/new",
        },
      ],
      entries: [
        {
          provider: "github",
          host: "github.com",
          projectId: "p1" as ProjectId,
          projectTitle: "web",
          repository: "acme/web",
          number: 7,
          title: "Login fails",
          url: "https://github.com/acme/web/issues/7",
          author: { login: "octocat", name: null, avatarUrl: null },
          state: "open",
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-02T00:00:00Z",
          closedAt: null,
          labels: [{ name: "bug", color: "ff0000", description: null }],
          assignees: [],
          milestone: null,
        },
      ],
      errors: [],
      truncated: true,
      nextCursors: {
        "github.com acme/web": "2026-08-01T00:00:00Z|99|7",
      },
    };
    const codec = Schema.toCodecJson(IssueListResult);

    expect(Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(result))).toStrictEqual(
      result,
    );
  });
});

describe("IssueActivity", () => {
  it("round-trips comments and host events through the RPC JSON codec", () => {
    const activity = {
      items: [
        {
          type: "comment" as const,
          id: "IC_1",
          actor: { login: "octocat", name: null, avatarUrl: null },
          body: "Confirmed",
          createdAt: "2026-08-02T00:00:00Z",
          updatedAt: null,
          url: "https://github.com/acme/web/issues/7#issuecomment-1",
        },
        {
          type: "event" as const,
          id: "LE_1",
          kind: "labeled",
          actor: { login: "hubot", name: null, avatarUrl: null },
          createdAt: "2026-08-03T00:00:00Z",
          label: { name: "bug", color: "ff0000", description: null },
          assignee: null,
          milestoneTitle: null,
          rename: null,
          source: null,
          commitId: null,
          lockReason: null,
          projectColumnName: null,
          previousProjectColumnName: null,
        },
      ],
      truncated: false,
    };
    const codec = Schema.toCodecJson(IssueActivity);

    expect(
      Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(activity)),
    ).toStrictEqual(activity);
  });
});

describe("IssueAssigneeChangeInput", () => {
  const decode = Schema.decodeUnknownSync(IssueAssigneeChangeInput);

  it("accepts a bounded provider identity list", () => {
    expect(
      decode({
        projectId: "p1",
        repository: "acme/web",
        number: 7,
        assignees: [" octocat "],
        assigned: true,
      }).assignees,
    ).toEqual(["octocat"]);
    expect(() =>
      decode({
        projectId: "p1",
        repository: "acme/web",
        number: 7,
        assignees: [],
        assigned: true,
      }),
    ).toThrow();
    expect(() =>
      decode({
        projectId: "p1",
        repository: "acme/web",
        number: 7,
        assignees: Array.from({ length: 11 }, (_, index) => `user-${index}`),
        assigned: true,
      }),
    ).toThrow();
  });
});
