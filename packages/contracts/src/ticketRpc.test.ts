import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ProjectId, TicketId } from "./baseSchemas.ts";
import { IssueDetail } from "./issue.ts";
import {
  TicketGitHubIssueDetail,
  TicketGitHubIssueRef,
  TicketLinkedIssueRef,
  TicketsRpcGroup,
  TICKET_WS_METHODS,
} from "./ticketRpc.ts";

const ticketId = TicketId.make("owner-ticket");
const decodeIssueRef = Schema.decodeSync(TicketGitHubIssueRef);
const decodeDetail = Schema.decodeSync(TicketGitHubIssueDetail);
const decodeLinkedRef = Schema.decodeSync(TicketLinkedIssueRef);
const decodeUnknownLinkedRef = Schema.decodeUnknownSync(TicketLinkedIssueRef);
const decodeUnknownDetail = Schema.decodeUnknownSync(TicketGitHubIssueDetail);
const refreshRpc = TicketsRpcGroup.requests.get(TICKET_WS_METHODS.ticketsGitHubIssueRefresh);
const decodeRefresh =
  refreshRpc === undefined ? undefined : Schema.decodeUnknownSync(refreshRpc.payloadSchema);

describe("ticket issue RPC contracts", () => {
  it("keeps old ticket issue requests and responses compatible", () => {
    expect(decodeIssueRef({ ticketId })).toEqual({ ticketId });
    const response = { title: "Issue", body: "Description", assignees: [], comments: [] };
    expect(decodeDetail(response)).toEqual(response);
  });

  it("requires a linked identity for read invalidation while synced refresh remains ticket-only", () => {
    const linkedIssue = { host: "github.acme.com", repository: "acme/web", number: 7 };
    expect(decodeLinkedRef({ ticketId, linkedIssue })).toEqual({ ticketId, linkedIssue });
    const incomplete: unknown = { ticketId };
    expect(() => decodeUnknownLinkedRef(incomplete)).toThrow();
    expect(refreshRpc).toBeDefined();
    const suppliedTarget: unknown = { ticketId, linkedIssue };
    expect(decodeRefresh?.(suppliedTarget)).toEqual({ ticketId });
  });

  it("carries complete preview metadata without repeating description or comments", () => {
    const issue: IssueDetail = {
      projectId: ProjectId.make("project"),
      projectTitle: "Web",
      provider: "github",
      host: "github.acme.com",
      repository: "acme/web",
      number: 7,
      title: "Issue",
      body: "Description",
      url: "https://github.acme.com/acme/web/issues/7",
      author: null,
      state: "open",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
      closedAt: null,
      labels: [],
      assignees: [],
      milestone: null,
      comments: [],
      commentCount: 0,
      commentsTruncated: false,
      repositoryUrl: "https://github.acme.com/acme/web",
      newIssueUrl: "https://github.acme.com/acme/web/issues/new",
    };
    const { title, body, assignees, comments, ...preview } = issue;
    const response = decodeDetail({ title, body, assignees, comments, preview });
    expect({
      ...response.preview,
      title: response.title,
      body: response.body,
      assignees: response.assignees,
      comments: response.comments,
    }).toEqual(issue);
    expect(response.preview).not.toHaveProperty("body");
    expect(response.preview).not.toHaveProperty("comments");
    const partial: unknown = {
      title,
      body,
      assignees,
      comments,
      preview: { host: "github.acme.com" },
    };
    expect(() => decodeUnknownDetail(partial)).toThrow();
  });
});
