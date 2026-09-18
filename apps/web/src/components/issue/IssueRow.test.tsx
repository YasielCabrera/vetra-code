import type { EnvironmentId, IssueActor, ProjectId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentIssueEntry } from "~/state/issues";

import { IssueRow } from "./IssueRow";

const ENTRY: EnvironmentIssueEntry = {
  environmentId: "environment-1" as EnvironmentId,
  provider: "github",
  host: "github.com",
  projectId: "project-1" as ProjectId,
  projectTitle: "Web",
  repository: "acme/web",
  number: 42,
  title: "Login loops after refresh",
  url: "https://github.com/acme/web/issues/42",
  author: { login: "octocat", name: null, avatarUrl: null },
  state: "open",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-02T00:00:00Z",
  closedAt: null,
  labels: [],
  assignees: [],
  milestone: null,
};

function render(assignees: ReadonlyArray<IssueActor>): string {
  return renderToStaticMarkup(
    <IssueRow
      entry={{ ...ENTRY, assignees }}
      selected={false}
      showEnvironment={false}
      onSelect={() => {}}
    />,
  );
}

describe("IssueRow", () => {
  it("shows every assignee on an assigned issue", () => {
    const markup = render([
      {
        login: "maintainer",
        name: "Main Tainer",
        avatarUrl: "https://github.com/maintainer.png?size=80",
      },
      { login: "release-manager", name: null, avatarUrl: null },
    ]);

    expect(markup).toContain("assigned to");
    expect(markup).toContain("maintainer, release-manager");
    expect(markup).toContain('src="https://github.com/maintainer.png?size=80"');
  });

  it("does not add empty assignment metadata to an unassigned issue", () => {
    const markup = render([]);

    expect(markup).not.toContain("assigned to");
    expect(markup).not.toContain("Assigned to");
  });
});
