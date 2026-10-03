import {
  EnvironmentId,
  ProjectId,
  TicketId,
  TicketStatusId,
  type TicketGitHubSource,
  type TicketStatusSet,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type GitHubTicket,
  eligibleTicketGitHubProjects,
  issueStateTargetStatus,
  projectGitHubRemotes,
  summarizeGitHubSync,
  ticketGitHubSource,
  ticketIssueRef,
  ticketRepositoryProjectId,
} from "./ticketGitHub.logic";

const LOCAL = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-remote");

const TICKET: GitHubTicket = {
  kind: "github",
  environmentId: LOCAL,
  id: TicketId.make("ticket-1"),
  number: 4,
  title: "Crash on save",
  labels: [],
  statusId: TicketStatusId.make("todo"),
  sortKey: "a0",
  revision: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdBy: { type: "sync" },
  linkRefs: [{ kind: "project", targetKey: "linked-project" }],
  attachmentCount: 0,
  github: {
    host: "github.com",
    repository: "acme/web",
    number: 7,
    state: "open",
    stateReason: null,
    author: "octocat",
    assignees: [],
    updatedAt: "2026-10-01T00:00:00.000Z",
    syncedAt: "2026-10-01T00:00:00.000Z",
    url: "https://github.com/acme/web/issues/7",
  },
  hiddenAt: null,
};

function source(
  overrides: Partial<TicketGitHubSource> & { readonly environmentId?: EnvironmentId },
): TicketGitHubSource & { readonly environmentId: EnvironmentId } {
  return {
    environmentId: LOCAL,
    projectId: ProjectId.make("source-project"),
    host: "github.com",
    repository: "acme/web",
    enabled: true,
    lastSyncedAt: "2026-10-02T10:00:00.000Z",
    lastError: null,
    issueCount: 3,
    ...overrides,
  };
}

function project(id: string, canonicalKey: string | null, environmentId = LOCAL) {
  return {
    environmentId,
    id: ProjectId.make(id),
    repositoryIdentity:
      canonicalKey === null
        ? null
        : {
            canonicalKey,
            locator: {
              source: "git-remote" as const,
              remoteName: "origin",
              remoteUrl: `https://${canonicalKey}.git`,
            },
          },
  };
}

describe("projectGitHubRemotes", () => {
  it("offers a fork's origin before upstream regardless of its repository identity", () => {
    expect(
      projectGitHubRemotes([
        { name: "upstream", url: "https://github.com/pingdotgg/t3code.git" },
        { name: "origin", url: "git@github.com:YasielCabrera/vetra-code.git" },
      ]),
    ).toEqual([
      { remoteName: "origin", host: "github.com", repository: "YasielCabrera/vetra-code" },
      { remoteName: "upstream", host: "github.com", repository: "pingdotgg/t3code" },
    ]);
  });

  it("reads HTTPS, SSH and git URLs, including GitHub enterprise", () => {
    for (const url of [
      "https://github.com/acme/web.git/",
      "ssh://git@github.com/acme/web.git",
      "git://github.com/acme/web",
    ]) {
      expect(projectGitHubRemotes([{ name: "origin", url }])).toEqual([
        { remoteName: "origin", host: "github.com", repository: "acme/web" },
      ]);
    }
    expect(
      projectGitHubRemotes([
        { name: "enterprise", url: "ssh://git@github.acme.com:2222/acme/web.git" },
      ]),
    ).toEqual([{ remoteName: "enterprise", host: "github.acme.com", repository: "acme/web" }]);
  });

  it("skips other hosts, local paths, malformed and nested repository paths", () => {
    expect(
      projectGitHubRemotes([
        { name: "gitlab", url: "https://gitlab.com/acme/web.git" },
        { name: "local", url: "/tmp/repo" },
        { name: "bad", url: "https://github.com/acme" },
        { name: "nested", url: "https://github.com/acme/web/other.git" },
      ]),
    ).toEqual([]);
  });
});

describe("eligibleTicketGitHubProjects", () => {
  const githubProject = (id: string, environmentId = LOCAL) => ({
    ...project(id, "github.com/upstream/web", environmentId),
    title: id,
    remotes: [
      { name: "upstream", url: "https://github.com/upstream/web.git" },
      { name: "origin", url: "https://github.com/acme/web.git" },
    ],
  });

  it("excludes connected project/repository pairs, including aliases and disabled sources", () => {
    const candidates = eligibleTicketGitHubProjects({
      projects: [
        githubProject("added"),
        githubProject("paused"),
        githubProject("other"),
        githubProject("added", REMOTE),
      ],
      sources: [
        source({ projectId: ProjectId.make("added"), host: "GitHub.com", repository: "ACME/Web" }),
        source({ projectId: ProjectId.make("paused"), enabled: false }),
      ],
    });
    expect(
      candidates.map(({ project, remoteName }) => [project.environmentId, project.id, remoteName]),
    ).toEqual([
      [LOCAL, "added", "upstream"],
      [LOCAL, "paused", "upstream"],
      [LOCAL, "other", "origin"],
      [LOCAL, "other", "upstream"],
      [REMOTE, "added", "origin"],
      [REMOTE, "added", "upstream"],
    ]);
  });

  it("deduplicates identical rows while preserving distinct projects and remote names", () => {
    const first = githubProject("first");
    const alias = {
      ...first,
      remotes: [
        ...first.remotes,
        { name: "origin", url: "https://github.com/acme/web.git" },
        { name: "fork", url: "https://github.com/acme/web.git" },
      ],
    };
    const candidates = eligibleTicketGitHubProjects({
      projects: [alias, first, githubProject("second")],
      sources: [],
    });
    expect(candidates.map(({ project, remoteName }) => [project.id, remoteName])).toEqual([
      ["first", "origin"],
      ["first", "fork"],
      ["first", "upstream"],
      ["second", "origin"],
      ["second", "upstream"],
    ]);
    expect(
      eligibleTicketGitHubProjects({
        projects: [alias],
        sources: [source({ projectId: first.id })],
      }).map(({ remoteName }) => remoteName),
    ).toEqual(["upstream"]);
  });

  it("keeps another host or changed repository eligible and tolerates no remotes", () => {
    expect(
      eligibleTicketGitHubProjects({
        projects: [githubProject("web")],
        sources: [
          source({ projectId: ProjectId.make("web"), repository: "acme/old" }),
          source({ projectId: ProjectId.make("web"), host: "github.acme.com" }),
        ],
      }),
    ).toHaveLength(2);
    expect(
      eligibleTicketGitHubProjects({
        projects: [{ ...githubProject("empty"), remotes: [] }],
        sources: [],
      }),
    ).toEqual([]);
  });
});

describe("ticketGitHubSource and ticketIssueRef", () => {
  it("reads the issue through the enabled source of the ticket's own environment", () => {
    const sources = [
      source({ environmentId: REMOTE, projectId: ProjectId.make("remote-project") }),
      source({ projectId: ProjectId.make("paused-project"), enabled: false }),
      source({ projectId: ProjectId.make("syncing-project"), repository: "Acme/Web" }),
      source({ repository: "acme/api", projectId: ProjectId.make("other-repo") }),
    ];
    const found = ticketGitHubSource(LOCAL, TICKET.github, sources);
    expect(found?.projectId).toBe("syncing-project");
    expect(
      ticketIssueRef(TICKET, { sources, linkedProjectIds: ["linked-project"], projects: [] }),
    ).toEqual({ ticketId: TICKET.id });
  });

  it("falls back to a linked project of the same repository once the source is gone", () => {
    const projects = [
      project("linked-project", "github.com/acme/api"),
      project("web-checkout", "github.com/acme/web"),
      project("unlinked-web", "github.com/acme/web"),
    ];
    expect(
      ticketIssueRef(TICKET, {
        sources: [],
        linkedProjectIds: ["linked-project", "web-checkout"],
        projects,
      }),
    ).toEqual({ ticketId: TICKET.id });
    expect(
      ticketRepositoryProjectId(LOCAL, TICKET.github, {
        sources: [],
        linkedProjectIds: ["linked-project"],
        projects,
      }),
    ).toBeNull();
  });
});

describe("ticketRepositoryProjectId", () => {
  const projects = [
    project("frontend", "github.com/acme/web"),
    project("backend", "github.com/acme/api"),
    project("remote-api", "github.com/acme/api", REMOTE),
    project("no-remote", null),
    project("azure", "dev.azure.com/acme/core/_git/api"),
    project("legacy-azure", "acme.visualstudio.com/core/_git/web"),
    project("docs", "github.com/Acme/Docs"),
  ];
  const resolve = (host: string, repository: string, linkedProjectIds: ReadonlyArray<string>) =>
    ticketRepositoryProjectId(
      LOCAL,
      { host, repository },
      {
        sources: [],
        linkedProjectIds,
        projects,
      },
    );

  it("picks the first linked project whose remote is the link's repository", () => {
    expect(resolve("github.com", "acme/api", ["no-remote", "frontend", "backend"])).toBe("backend");
    expect(resolve("GitHub.com", "ACME/Web", ["backend", "frontend"])).toBe("frontend");
    expect(resolve("dev.azure.com", "acme/core/_git/api", ["azure"])).toBe("azure");
    expect(resolve("dev.azure.com", "acme/core/_git/web", ["legacy-azure"])).toBe("legacy-azure");
    expect(resolve("github.com", "acme/docs", ["docs"])).toBe("docs");
  });

  it("finds none for another repository, another host, or a project in another environment", () => {
    expect(resolve("github.com", "acme/docs", ["frontend", "backend"])).toBeNull();
    expect(resolve("gitlab.com", "acme/api", ["backend"])).toBeNull();
    expect(resolve("github.com", "acme/api", ["remote-api", "frontend"])).toBeNull();
  });
});

describe("ticket-owned GitHub routing", () => {
  it("never reuses project issue APIs for a source with a different primary identity or host", () => {
    const context = {
      sources: [source({})],
      linkedProjectIds: ["source-project"],
      projects: [project("source-project", "github.com/pingdotgg/t3code")],
    };
    expect(ticketRepositoryProjectId(LOCAL, TICKET.github, context)).toBeNull();
    expect(ticketIssueRef(TICKET, context)).toEqual({ ticketId: TICKET.id });
    const enterprise = { ...TICKET, github: { ...TICKET.github, host: "github.acme.com" } };
    const enterpriseContext = {
      ...context,
      sources: [source({ host: "github.acme.com" })],
      projects: [project("source-project", "github.com/acme/web")],
    };
    expect(ticketRepositoryProjectId(LOCAL, enterprise.github, enterpriseContext)).toBeNull();
    expect(ticketIssueRef(enterprise, enterpriseContext)).toEqual({ ticketId: TICKET.id });
  });
});

describe("summarizeGitHubSync", () => {
  const report = (sources: ReadonlyArray<ReturnType<typeof source>>) => {
    const summary = summarizeGitHubSync(sources);
    return summary === null
      ? null
      : {
          repositories: summary.sources.map((entry) => entry.repository),
          lastSyncedAt: summary.lastSyncedAt,
          lastError: summary.lastError,
        };
  };

  it("syncs and dates the board by its enabled sources, surfacing an error", () => {
    expect(report([])).toBeNull();
    expect(
      report([
        source({ lastSyncedAt: "2026-10-02T10:00:00.000Z" }),
        source({
          repository: "acme/api",
          lastSyncedAt: "2026-10-02T09:00:00.000Z",
          lastError: "gh is signed out",
        }),
        source({ repository: "acme/old", lastSyncedAt: null, enabled: false }),
      ]),
    ).toEqual({
      repositories: ["acme/web", "acme/api"],
      lastSyncedAt: "2026-10-02T09:00:00.000Z",
      lastError: "gh is signed out",
    });
    expect(report([source({}), source({ lastSyncedAt: null, repository: "acme/api" })])).toEqual({
      repositories: ["acme/web", "acme/api"],
      lastSyncedAt: null,
      lastError: null,
    });
  });

  it("falls back to every source when all are paused", () => {
    expect(report([source({ enabled: false })])).toEqual({
      repositories: ["acme/web"],
      lastSyncedAt: "2026-10-02T10:00:00.000Z",
      lastError: null,
    });
  });
});

describe("issueStateTargetStatus", () => {
  const set: TicketStatusSet = {
    statuses: [
      {
        id: TicketStatusId.make("todo"),
        name: "Todo",
        color: "gray",
        category: "open",
        position: 0,
        collapsedByDefault: false,
        isDefault: true,
      },
      {
        id: TicketStatusId.make("canceled"),
        name: "Canceled",
        color: "gray",
        category: "closed",
        closeReason: "not_planned",
        position: 1,
        collapsedByDefault: true,
        isDefault: true,
      },
      {
        id: TicketStatusId.make("done"),
        name: "Done",
        color: "green",
        category: "closed",
        closeReason: "completed",
        position: 2,
        collapsedByDefault: false,
        isDefault: false,
      },
    ],
  };

  it("closes as completed and reopens into the open default", () => {
    expect(issueStateTargetStatus(set, "close")?.id).toBe("done");
    expect(issueStateTargetStatus(set, "reopen")?.id).toBe("todo");
    expect(issueStateTargetStatus({ statuses: set.statuses.slice(0, 2) }, "close")?.id).toBe(
      "canceled",
    );
    expect(issueStateTargetStatus(null, "close")).toBeUndefined();
  });
});
