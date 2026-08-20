import type { IssueActivity, IssueTimelineEvent } from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildIssueTimeline, issueTimelineEventLabel } from "./issueTimeline.logic";

function event(overrides: Partial<IssueTimelineEvent> = {}): IssueTimelineEvent {
  return {
    type: "event",
    id: "event-1",
    kind: "labeled",
    actor: { login: "octocat", name: null, avatarUrl: null },
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
    ...overrides,
  };
}

describe("issue timeline", () => {
  it("sorts only host activity in chronological order", () => {
    const activity: IssueActivity = {
      items: [
        event(),
        {
          type: "comment",
          id: "comment-1",
          actor: null,
          body: "First reply",
          createdAt: "2026-08-02T00:00:00Z",
          updatedAt: null,
          url: null,
        },
      ],
      truncated: false,
    };

    expect(buildIssueTimeline(activity).map(({ type }) => type)).toEqual(["comment", "event"]);
  });

  it("describes contextual and unknown GitHub events without hiding either", () => {
    expect(issueTimelineEventLabel(event())).toBe("added the “bug” label");
    expect(
      issueTimelineEventLabel(
        event({
          kind: "cross-referenced",
          source: {
            repository: "acme/api",
            number: 9,
            title: "Related work",
            url: "https://github.com/acme/api/issues/9",
            isPullRequest: false,
          },
        }),
      ),
    ).toBe("mentioned this in acme/api#9");
    expect(issueTimelineEventLabel(event({ kind: "future_event" }))).toBe("recorded future event");
  });
});
