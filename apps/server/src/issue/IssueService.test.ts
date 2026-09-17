import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { OrchestrationProjectShell, ProjectId } from "@vetra-code/contracts";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import { IssueProviderError, type IssueProviderApi } from "./IssueProvider.ts";
import { fromProviders, IssueProviderRegistry } from "./IssueProviderRegistry.ts";
import * as IssueService from "./IssueService.ts";

function project(id: string, provider: string, repository: string): OrchestrationProjectShell {
  const host = provider === "gitlab" ? "gitlab.com" : "github.com";
  return {
    id: id as ProjectId,
    title: repository,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: {
      canonicalKey: `${host}/${repository}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: `https://${host}/${repository}.git`,
      },
      provider,
      displayName: repository,
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

function listedIssue(number: number, updatedAt = "2026-08-02T00:00:00Z") {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/acme/web/issues/${number}`,
    author: null,
    state: "open" as const,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt,
    closedAt: null,
    labels: [],
    assignees: [],
    milestone: null,
  };
}

function githubProvider(overrides: Partial<IssueProviderApi> = {}): IssueProviderApi {
  return {
    kind: "github",
    repositoryLinks: ({ host, repository }) => ({
      repositoryUrl: `https://${host}/${repository}`,
      newIssueUrl: `https://${host}/${repository}/issues/new`,
    }),
    listIssues: () =>
      Effect.succeed({
        issues: [{ ...listedIssue(7), title: "Login fails" }],
        truncated: false,
      }),
    getIssue: () => Effect.die("unused"),
    getIssueActivity: () => Effect.die("unused"),
    listAssigneeCandidates: () => Effect.die("unused"),
    setAssignees: () => Effect.die("unused"),
    ...overrides,
  };
}

function makeService(
  projects: ReadonlyArray<OrchestrationProjectShell>,
  providers: ReadonlyArray<IssueProviderApi>,
  resolveHandle: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"]["resolveHandle"] = () =>
    Effect.die("Unexpected provider refinement"),
) {
  return IssueService.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(IssueProviderRegistry, fromProviders(providers)),
        Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
          resolveHandle,
          resolveLink: () => undefined,
        }),
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getShellSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 1,
              projects,
              threads: [],
              automations: [],
              updatedAt: "2026-08-01T00:00:00Z",
            }),
        }),
        SourceControlRateLimit.layer,
      ),
    ),
  );
}

it.effect("lists GitHub issues and reports unsupported hosts instead of dropping them", () =>
  Effect.gen(function* () {
    const service = yield* makeService(
      [project("p1", "github", "acme/web"), project("p2", "gitlab", "acme/api")],
      [githubProvider()],
    );

    const result = yield* service.list({ state: "open" });

    expect(result.entries.map(({ number }) => number)).toEqual([7]);
    expect(result.repositories).toHaveLength(1);
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: "github.com", configured: true }),
        expect.objectContaining({ host: "gitlab.com", configured: false }),
      ]),
    );
  }),
);

it.effect("refines an older unknown GitHub identity through the source-control registry", () =>
  Effect.gen(function* () {
    const legacy = project("p1", "unknown", "acme/web");
    const service = yield* makeService([legacy], [githubProvider()], ({ context }) =>
      Effect.succeed({
        context: { ...context!, provider: { ...context!.provider, kind: "github" } },
        provider: undefined as never,
      }),
    );

    const result = yield* service.list({ state: "open" });

    expect(result.entries).toHaveLength(1);
    expect(result.providers[0]).toMatchObject({ kind: "github", configured: true });
  }),
);

it.effect("continues only named repositories and removes inclusive-boundary duplicates", () =>
  Effect.gen(function* () {
    const listed: string[] = [];
    const cursors: Array<unknown> = [];
    const service = yield* makeService(
      [project("p1", "github", "acme/web"), project("p2", "github", "acme/api")],
      [
        githubProvider({
          listIssues: (input) => {
            listed.push(input.repository);
            cursors.push(input.cursor);
            return Effect.succeed({
              issues: [listedIssue(7), listedIssue(8), listedIssue(9, "2026-08-01T00:00:00Z")],
              truncated: true,
            });
          },
        }),
      ],
    );

    const result = yield* service.list({
      state: "open",
      limit: 2,
      cursors: { "github.com acme/web": "2026-08-02T00:00:00Z|1|7" },
    });

    expect(listed).toEqual(["acme/web"]);
    expect(cursors).toEqual([{ updatedBefore: "2026-08-02T00:00:00Z", seenAt: [7] }]);
    expect(result.entries.map(({ number }) => number)).toEqual([8, 9]);
    expect(result.nextCursors).toEqual({
      "github.com acme/web": "2026-08-01T00:00:00Z|3|9",
    });
    expect(result.truncated).toBe(true);
  }),
);

it.effect("refuses a continuation it did not issue before calling a provider", () =>
  Effect.gen(function* () {
    let calls = 0;
    const service = yield* makeService(
      [project("p1", "github", "acme/web")],
      [
        githubProvider({
          listIssues: () => {
            calls += 1;
            return Effect.die("must not be called");
          },
        }),
      ],
    );

    const exit = yield* Effect.exit(
      service.list({ state: "open", cursors: { "github.com acme/web": "yesterday" } }),
    );

    expect(exit._tag).toBe("Failure");
    expect(calls).toBe(0);
  }),
);

it.effect("marks a repository read failure as retryable before pagination advances", () =>
  Effect.gen(function* () {
    const service = yield* makeService(
      [project("p1", "github", "acme/web")],
      [
        githubProvider({
          listIssues: () =>
            Effect.fail(
              new IssueProviderError({
                provider: "github",
                operation: "list",
                reason: "failed",
                detail: "Temporary failure",
              }),
            ),
        }),
      ],
    );

    const result = yield* service.list({ state: "open" });

    expect(result.errors).toEqual([expect.objectContaining({ projectId: "p1", retryable: true })]);
    expect(result.nextCursors).toEqual({});
  }),
);

it.effect("revalidates a client-supplied repository before calling the provider", () =>
  Effect.gen(function* () {
    let calls = 0;
    const service = yield* makeService(
      [project("p1", "github", "acme/web")],
      [
        githubProvider({
          getIssue: () => {
            calls += 1;
            return Effect.die("must not be called");
          },
        }),
      ],
    );

    const exit = yield* Effect.exit(
      service.detail({
        projectId: "p1" as ProjectId,
        repository: "other/repository",
        number: 7,
      }),
    );

    assert.strictEqual(exit._tag, "Failure");
    assert.strictEqual(calls, 0);
  }),
);

it.effect("caches issue details until their exact reference is invalidated", () =>
  Effect.gen(function* () {
    let calls = 0;
    const reference = {
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 7,
    } as const;
    const service = yield* makeService(
      [project("p1", "github", "acme/web")],
      [
        githubProvider({
          getIssue: () =>
            Effect.sync(() => {
              calls += 1;
              return {
                number: 7,
                title: "Login fails",
                url: "https://github.com/acme/web/issues/7",
                author: null,
                state: "open" as const,
                createdAt: "2026-08-01T00:00:00Z",
                updatedAt: "2026-08-02T00:00:00Z",
                closedAt: null,
                labels: [],
                assignees: [],
                milestone: null,
                body: "Steps to reproduce",
                comments: [],
                commentCount: 0,
                commentsTruncated: false,
              };
            }),
        }),
      ],
    );

    const first = yield* service.detail(reference);
    const cached = yield* service.detail(reference);
    yield* service.invalidate({ reference });
    const refreshed = yield* service.detail(reference);

    expect(first).toMatchObject({
      projectId: "p1",
      repositoryUrl: "https://github.com/acme/web",
      body: "Steps to reproduce",
    });
    expect(cached).toStrictEqual(first);
    expect(refreshed).toStrictEqual(first);
    expect(calls).toBe(2);
  }),
);

it.effect("caches issue activity until its exact reference is invalidated", () =>
  Effect.gen(function* () {
    let calls = 0;
    const reference = {
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 7,
    } as const;
    const service = yield* makeService(
      [project("p1", "github", "acme/web")],
      [
        githubProvider({
          getIssueActivity: () =>
            Effect.sync(() => {
              calls += 1;
              return { items: [], truncated: false };
            }),
        }),
      ],
    );

    const first = yield* service.activity(reference);
    const cached = yield* service.activity(reference);
    yield* service.invalidate({ reference });
    const refreshed = yield* service.activity(reference);

    expect(first).toStrictEqual({ items: [], truncated: false });
    expect(cached).toStrictEqual(first);
    expect(refreshed).toStrictEqual(first);
    expect(calls).toBe(2);
  }),
);

it.effect("reads assignee candidates only for the selected repository", () =>
  Effect.gen(function* () {
    const seen: Array<unknown> = [];
    const service = yield* makeService(
      [project("p1", "github", "acme/web")],
      [
        githubProvider({
          listAssigneeCandidates: (input) => {
            seen.push(input);
            return Effect.succeed({
              candidates: [
                {
                  id: "octocat",
                  login: "octocat",
                  name: null,
                  avatarUrl: null,
                  isAssigned: false,
                  isViewer: true,
                },
              ],
              truncated: false,
            });
          },
        }),
      ],
    );

    const result = yield* service.assigneeCandidates({
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 7,
    });

    expect(result.candidates[0]).toMatchObject({ login: "octocat", isViewer: true });
    expect(seen).toEqual([
      {
        cwd: "/work/p1",
        host: "github.com",
        repository: "acme/web",
        number: 7,
      },
    ]);
  }),
);

it.effect("updates assignees and invalidates both detail and list caches", () =>
  Effect.gen(function* () {
    let assigned = false;
    let detailCalls = 0;
    let listCalls = 0;
    const provider = githubProvider({
      listIssues: () =>
        Effect.sync(() => {
          listCalls += 1;
          return {
            issues: [
              {
                ...listedIssue(7),
                assignees: assigned ? [{ login: "octocat", name: null, avatarUrl: null }] : [],
              },
            ],
            truncated: false,
          };
        }),
      getIssue: () =>
        Effect.sync(() => {
          detailCalls += 1;
          return {
            ...listedIssue(7),
            assignees: assigned ? [{ login: "octocat", name: null, avatarUrl: null }] : [],
            body: "Steps to reproduce",
            comments: [],
            commentCount: 0,
            commentsTruncated: false,
          };
        }),
      setAssignees: (input) =>
        Effect.sync(() => {
          expect(input.assignees).toEqual(["octocat"]);
          assigned = input.assigned;
        }),
    });
    const service = yield* makeService([project("p1", "github", "acme/web")], [provider]);
    const reference = {
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 7,
    } as const;

    expect((yield* service.detail(reference)).assignees).toEqual([]);
    expect((yield* service.list({ state: "open" })).entries[0]?.assignees).toEqual([]);
    yield* service.setAssignees({ ...reference, assignees: ["octocat"], assigned: true });
    expect((yield* service.detail(reference)).assignees[0]?.login).toBe("octocat");
    expect((yield* service.list({ state: "open" })).entries[0]?.assignees[0]?.login).toBe(
      "octocat",
    );
    expect(detailCalls).toBe(2);
    expect(listCalls).toBe(2);
  }),
);
