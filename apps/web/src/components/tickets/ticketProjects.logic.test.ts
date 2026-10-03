import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { availableTicketProjects, projectChangeWouldLoseIssueAccess } from "./ticketProjects.logic";

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const WEB = ProjectId.make("web");
const API = ProjectId.make("api");
const SECOND_WEB = ProjectId.make("second-web");

function project(id: ProjectId, repository: string, environmentId = LOCAL) {
  return {
    id,
    environmentId,
    title: repository,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: {
      canonicalKey: `github.com/acme/${repository}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://github.com/acme/${repository}.git`,
      },
    },
  } satisfies Pick<
    EnvironmentProject,
    "id" | "environmentId" | "title" | "workspaceRoot" | "repositoryIdentity"
  >;
}

const projects = [
  project(WEB, "web"),
  project(API, "api"),
  project(SECOND_WEB, "web"),
  project(WEB, "web", REMOTE),
];

describe("availableTicketProjects", () => {
  it("offers only unlinked projects of the ticket's environment, even with reused IDs", () => {
    expect(
      availableTicketProjects({
        environmentId: LOCAL,
        projects,
        linkedProjectIds: [WEB],
        query: "",
      }).map((entry) => entry.id),
    ).toEqual([API, SECOND_WEB]);
    expect(
      availableTicketProjects({ environmentId: REMOTE, projects, linkedProjectIds: [], query: "" }),
    ).toEqual([projects[3]]);
  });

  it("searches titles and checkout paths without case or surrounding whitespace", () => {
    expect(
      availableTicketProjects({
        environmentId: LOCAL,
        projects,
        linkedProjectIds: [],
        query: " API ",
      }).map((entry) => entry.id),
    ).toEqual([API]);
    expect(
      availableTicketProjects({
        environmentId: LOCAL,
        projects,
        linkedProjectIds: [],
        query: "/WORK/SECOND-",
      }).map((entry) => entry.id),
    ).toEqual([SECOND_WEB]);
    expect(
      availableTicketProjects({
        environmentId: LOCAL,
        projects,
        linkedProjectIds: [],
        query: "missing",
      }),
    ).toEqual([]);
  });
});

describe("projectChangeWouldLoseIssueAccess", () => {
  const base = {
    environmentId: LOCAL,
    repository: { host: "github.com", repository: "acme/web", number: 1 },
    context: { sources: [], projects, linkedProjectIds: [WEB, API] },
    removeProjectId: WEB,
    replacementProjectId: null,
  };

  it("blocks removing the last matching checkout, including replacement with another repository", () => {
    expect(projectChangeWouldLoseIssueAccess(base)).toBe(true);
    expect(projectChangeWouldLoseIssueAccess({ ...base, replacementProjectId: API })).toBe(true);
  });

  it("allows removal when another linked matching checkout remains, or is selected as replacement", () => {
    expect(
      projectChangeWouldLoseIssueAccess({
        ...base,
        context: { ...base.context, linkedProjectIds: [WEB, SECOND_WEB] },
      }),
    ).toBe(false);
    expect(projectChangeWouldLoseIssueAccess({ ...base, replacementProjectId: SECOND_WEB })).toBe(
      false,
    );
    expect(projectChangeWouldLoseIssueAccess({ ...base, removeProjectId: API })).toBe(false);
  });

  it("allows removal while a configured source still supplies the project's issue reads", () => {
    const source = {
      environmentId: LOCAL,
      projectId: WEB,
      host: "github.com",
      repository: "acme/web",
      enabled: true,
      lastSyncedAt: null,
      lastError: null,
      issueCount: 0,
    };
    expect(
      projectChangeWouldLoseIssueAccess({
        ...base,
        context: { ...base.context, sources: [source] },
      }),
    ).toBe(false);
    expect(
      projectChangeWouldLoseIssueAccess({
        ...base,
        context: { ...base.context, sources: [{ ...source, environmentId: REMOTE }] },
      }),
    ).toBe(true);
  });

  it("allows local-ticket changes and does not trap links on an already unreadable issue", () => {
    expect(projectChangeWouldLoseIssueAccess({ ...base, repository: null })).toBe(false);
    expect(
      projectChangeWouldLoseIssueAccess({
        ...base,
        context: { ...base.context, linkedProjectIds: [API] },
        removeProjectId: API,
      }),
    ).toBe(false);
  });
});
