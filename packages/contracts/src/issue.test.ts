import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { IssueActivity } from "./issue.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

describe("issue RPC registration", () => {
  it("serves ticket workflows without the standalone Issues API", () => {
    for (const method of [
      "issues.list",
      "issues.detail",
      "issues.activity",
      "issues.assigneeCandidates",
      "issues.setAssignees",
      "issues.invalidate",
    ]) {
      expect(WsRpcGroup.requests.has(method)).toBe(false);
    }
    for (const method of [
      WS_METHODS.ticketsIssueLinkCandidates,
      WS_METHODS.ticketsGitHubIssueDetail,
      WS_METHODS.ticketsGitHubIssueActivity,
      WS_METHODS.ticketsGitHubIssueAssigneeCandidates,
      WS_METHODS.ticketsGitHubIssueSetAssignees,
      WS_METHODS.ticketsGitHubIssueInvalidate,
      WS_METHODS.ticketsGitHubIssueRefresh,
    ]) {
      expect(WsRpcGroup.requests.has(method)).toBe(true);
    }
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
