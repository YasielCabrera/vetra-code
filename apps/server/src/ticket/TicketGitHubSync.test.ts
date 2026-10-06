import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationProjectShell,
  ProjectId,
  ThreadId,
  type TicketError,
  TicketStatusId,
  type TicketSummary,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";
import * as TestClock from "effect/testing/TestClock";

import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubIssueCli from "../issue/GitHubIssueCli.ts";
import * as GitHubIssueProvider from "../issue/GitHubIssueProvider.ts";
import * as ServerConfig from "../config.ts";
import {
  IssueProviderError,
  type IssueProviderApi,
  type IssueStateChange,
  type ProviderIssue,
  type ProviderIssueDetail,
} from "../issue/IssueProvider.ts";
import { fromProviders, IssueProviderRegistry } from "../issue/IssueProviderRegistry.ts";
import * as SqlitePersistence from "../persistence/Layers/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlProvider from "../sourceControl/SourceControlProvider.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import * as TicketGitHubSync from "./TicketGitHubSync.ts";
import * as TicketService from "./TicketService.ts";

const PROJECT = ProjectId.make("project-web");
const SOURCE = { projectId: PROJECT, host: "github.com", repository: "acme/web" } as const;
const USER = { type: "user" } as const;
const AGENT = { type: "agent", threadId: ThreadId.make("agent-thread") } as const;
const status = TicketStatusId.make;

const shell: OrchestrationProjectShell = {
  id: PROJECT,
  title: "web",
  workspaceRoot: "/work/web",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

interface FakeIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: "open" | "closed";
  readonly stateReason: string | null;
  readonly labels: ReadonlyArray<string>;
  readonly updatedAt: string;
}

const missingIssueThroughClassifier = (input: {
  readonly cwd: string;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
}) =>
  Effect.gen(function* () {
    const process = yield* VcsProcess.make.pipe(
      Effect.provideService(
        ProcessRunner.ProcessRunner,
        ProcessRunner.ProcessRunner.of({
          run: () =>
            Effect.succeed({
              stdout: "",
              stderr: `GraphQL: Could not resolve to an Issue with the number of ${input.number}. (repository.issue)`,
              code: ChildProcessSpawner.ExitCode(1),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            }),
        }),
      ),
    );
    const read = process
      .run({
        command: "gh",
        cwd: input.cwd,
        operation: "GitHubIssueCli.getIssue",
        args: [
          "issue",
          "view",
          String(input.number),
          "--repo",
          `${input.host}/${input.repository}`,
        ],
      })
      .pipe(
        Effect.mapError((error) =>
          GitHubCli.fromVcsError({ command: "gh", cwd: input.cwd }, error),
        ),
        Effect.andThen(Effect.die("Expected a missing issue")),
      );
    const provider = yield* GitHubIssueProvider.make.pipe(
      Effect.provideService(
        GitHubIssueCli.GitHubIssueCli,
        GitHubIssueCli.GitHubIssueCli.of({
          listIssues: () => Effect.die("unused"),
          getIssue: () => read,
          getIssueActivity: () => Effect.die("unused"),
          listAssigneeCandidates: () => Effect.die("unused"),
          setAssignees: () => Effect.die("unused"),
          setState: () => Effect.die("unused"),
          addComment: () => Effect.die("unused"),
        }),
      ),
    );
    return yield* provider.getIssue(input);
  });

function makeFakeGitHub(initial: ReadonlyArray<FakeIssue>) {
  const issues = new Map(initial.map((issue) => [issue.number, issue]));
  const fake = {
    issues,
    setStateCalls: [] as Array<{ readonly number: number; readonly change: IssueStateChange }>,
    commentCalls: [] as Array<{ readonly number: number; readonly body: string }>,
    listCalls: 0,
    listInputs: [] as Array<Parameters<IssueProviderApi["listIssues"]>[0]>,
    listFailures: new Map<string, IssueProviderError>(),
    assignees: new Map<number, ReadonlyArray<string>>(),
    refinementCalls: [] as Array<string>,
    providerAvailable: true,
    projectReads: 0,
    releaseGate: null as Deferred.Deferred<void> | null,
    releaseStarted: null as Deferred.Deferred<void> | null,
    projects: new Map<ProjectId, OrchestrationProjectShell>([
      [
        PROJECT,
        {
          ...shell,
          repositoryIdentity: {
            canonicalKey: "github.com/pingdotgg/t3code",
            locator: {
              source: "git-remote",
              remoteName: "upstream",
              remoteUrl: "https://github.com/pingdotgg/t3code.git",
            },
          },
        },
      ],
    ]),
    calls: [] as Array<{
      readonly operation: string;
      readonly cwd: string;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
    }>,
    staleList: null as ReadonlyArray<FakeIssue> | null,
    listGate: null as Deferred.Deferred<void> | null,
    listStarted: null as Deferred.Deferred<void> | null,
    listAllGate: null as Deferred.Deferred<void> | null,
    listAllStarted: null as Queue.Queue<void> | null,
    listFailure: null as IssueProviderError | null,
    getFailure: null as IssueProviderError | null,
    setStateFailure: null as IssueProviderError | null,
    /** Runs inside a successful setState, as another writer racing the user's move. */
    duringSetState: Effect.void as Effect.Effect<void, TicketError>,
    /** GitHub's clock for issues setState changes. */
    hostUpdatedAt: "2026-08-20T00:00:00Z",
    duringGet: Effect.void as Effect.Effect<void, TicketError>,
    edit: (number: number, change: Partial<FakeIssue>) =>
      issues.set(number, { ...issues.get(number)!, ...change }),
  };
  const listed = (issue: FakeIssue): ProviderIssue => ({
    number: issue.number,
    title: issue.title,
    url: `https://github.com/acme/web/issues/${issue.number}`,
    author: { login: "octocat", name: null, avatarUrl: null },
    state: issue.state,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: issue.updatedAt,
    closedAt: null,
    labels: issue.labels.map((name) => ({ name, color: null, description: null })),
    assignees: (fake.assignees.get(issue.number) ?? []).map((login) => ({
      login,
      name: null,
      avatarUrl: null,
    })),
    milestone: null,
    body: issue.body,
  });
  const detail = (issue: FakeIssue): ProviderIssueDetail => ({
    ...listed(issue),
    ...(issue.stateReason === null ? {} : { stateReason: issue.stateReason }),
    body: issue.body,
    comments: [],
    commentCount: 0,
    commentsTruncated: false,
  });
  const api: IssueProviderApi = {
    kind: "github",
    repositoryLinks: ({ host, repository }) => ({
      repositoryUrl: `https://${host}/${repository}`,
      newIssueUrl: `https://${host}/${repository}/issues/new`,
    }),
    listIssues: (input) =>
      Effect.gen(function* () {
        fake.listCalls += 1;
        fake.listInputs.push(input);
        if (fake.listAllGate !== null && fake.listAllStarted !== null) {
          yield* Queue.offer(fake.listAllStarted, undefined);
          yield* Deferred.await(fake.listAllGate);
        }
        const gate = fake.listGate;
        fake.listGate = null;
        if (gate !== null) {
          yield* Deferred.succeed(fake.listStarted!, undefined);
          yield* Deferred.await(gate);
        }
        if (fake.listFailure !== null) return yield* fake.listFailure;
        const failure = fake.listFailures.get(input.repository);
        if (failure !== undefined) return yield* failure;
        return {
          issues: (
            fake.staleList ?? [...issues.values()].filter((issue) => issue.state === input.state)
          ).map((issue) => ({
            ...listed(issue),
            url: `https://${input.host}/${input.repository}/issues/${issue.number}`,
          })),
          truncated: false,
        };
      }),
    getIssue: (input) =>
      Effect.suspend(() => {
        fake.calls.push({ operation: "get", ...input });
        if (fake.getFailure !== null) return Effect.fail(fake.getFailure);
        const issue = issues.get(input.number);
        const read =
          issue === undefined
            ? missingIssueThroughClassifier(input)
            : Effect.succeed({
                ...detail(issue),
                url: `https://${input.host}/${input.repository}/issues/${issue.number}`,
              });
        return fake.duringGet.pipe(Effect.orDie, Effect.andThen(read));
      }),
    getIssueActivity: (input) =>
      Effect.sync(() => {
        fake.calls.push({ operation: "activity", ...input });
        return { items: [], truncated: false };
      }),
    listAssigneeCandidates: (input) =>
      Effect.sync(() => {
        fake.calls.push({ operation: "candidates", ...input });
        return { candidates: [], truncated: false };
      }),
    setAssignees: (input) =>
      Effect.sync(() => {
        fake.calls.push({ operation: "assignees", ...input });
        fake.assignees.set(input.number, input.assigned ? input.assignees : []);
      }),
    setState: (input) =>
      Effect.suspend(() => {
        if (fake.setStateFailure !== null) return Effect.fail(fake.setStateFailure);
        fake.calls.push({
          operation: "state",
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
        });
        fake.setStateCalls.push({ number: input.number, change: input.change });
        fake.edit(input.number, {
          state: input.change.state,
          stateReason: input.change.state === "closed" ? input.change.reason : "reopened",
          updatedAt: fake.hostUpdatedAt,
        });
        return fake.duringSetState.pipe(Effect.orDie);
      }),
    addComment: (input) =>
      Effect.sync(() => {
        fake.calls.push({
          operation: "comment",
          cwd: input.cwd,
          host: input.host,
          repository: input.repository,
          number: input.number,
        });
        fake.commentCalls.push({ number: input.number, body: input.body });
      }),
  };
  return { fake, api };
}

const issue = (number: number, change: Partial<FakeIssue> = {}): FakeIssue => ({
  number,
  title: `Issue ${number}`,
  body: `Body ${number}`,
  state: "open",
  stateReason: null,
  labels: [],
  updatedAt: "2026-08-02T00:00:00Z",
  ...change,
});

const withSync = <A, E>(
  initial: ReadonlyArray<FakeIssue>,
  body: (context: {
    readonly tickets: TicketService.TicketService["Service"];
    readonly sync: TicketGitHubSync.TicketGitHubSync["Service"];
    readonly fake: ReturnType<typeof makeFakeGitHub>["fake"];
  }) => Effect.Effect<A, E, never>,
) => {
  const { fake, api } = makeFakeGitHub(initial);
  const registry = fromProviders([api]);
  const layer = TicketGitHubSync.layer.pipe(
    Layer.provideMerge(
      Layer.effect(
        TicketService.TicketService,
        Effect.map(TicketService.TicketService, (tickets) =>
          TicketService.TicketService.of({
            ...tickets,
            releaseGitHubRepository: (input) =>
              Effect.gen(function* () {
                if (fake.releaseGate !== null && fake.releaseStarted !== null) {
                  yield* Deferred.succeed(fake.releaseStarted, undefined);
                  yield* Deferred.await(fake.releaseGate);
                }
                yield* tickets.releaseGitHubRepository(input);
              }),
          }),
        ),
      ).pipe(Layer.provide(TicketService.layer)),
    ),
    Layer.provideMerge(TicketGitHub.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(IssueProviderRegistry, {
          ...registry,
          get: (kind) => (fake.providerAvailable ? registry.get(kind) : null),
        }),
        Layer.effect(
          SourceControlProviderRegistry.SourceControlProviderRegistry,
          Effect.gen(function* () {
            const provider = yield* SourceControlProvider.SourceControlProvider;
            return SourceControlProviderRegistry.SourceControlProviderRegistry.of({
              get: () => Effect.succeed(provider),
              resolveHandle: (input) =>
                Effect.sync(() => {
                  fake.refinementCalls.push(input.cwd);
                  return {
                    provider,
                    context:
                      input.context === undefined
                        ? null
                        : {
                            ...input.context,
                            provider: { ...input.context.provider, kind: "github" },
                          },
                  };
                }),
              resolve: () => Effect.succeed(provider),
              resolveLink: () => undefined,
              discover: Effect.succeed([]),
            });
          }),
        ).pipe(
          Layer.provide(
            Layer.mock(SourceControlProvider.SourceControlProvider)({ kind: "github" }),
          ),
        ),
        Layer.mock(ProjectService.ProjectService)({
          getShell: (projectId) =>
            Effect.sync(() => {
              fake.projectReads += 1;
              return Option.fromNullishOr(fake.projects.get(projectId));
            }),
          listShells: (options) =>
            Effect.sync(() =>
              [...fake.projects.values()].filter(
                (project) =>
                  options?.projectIds === undefined || options.projectIds.includes(project.id),
              ),
            ),
        }),
        SourceControlRateLimit.layer,
      ),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ticket-github-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-09-01T00:00:00Z"));
    const tickets = yield* TicketService.TicketService;
    const sync = yield* TicketGitHubSync.TicketGitHubSync;
    yield* sync.upsertSource({ ...SOURCE, enabled: true });
    return yield* body({ tickets, sync, fake });
  }).pipe(Effect.provide(layer));
};

const githubOf = (ticket: TicketSummary) => (ticket.kind === "github" ? ticket : null);

describe("TicketGitHubSync", () => {
  it.effect(
    "reads a local ticket's recorded Enterprise issue through a secondary source and refreshes without changing its owner",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          const linkedIssue = { host: "github.acme.com", repository: "acme/fork", number: 7 };
          yield* sync.upsertSource({
            projectId: PROJECT,
            host: linkedIssue.host,
            repository: linkedIssue.repository,
            enabled: true,
          });
          const owner = (yield* tickets.create({ title: "Owner title", body: "Owner body" }, USER))
            .ticket;
          yield* tickets.link(
            {
              ticketId: owner.id,
              target: {
                kind: "issue",
                ref: linkedIssue,
                snapshot: {
                  title: "Linked issue",
                  state: "open",
                  url: "https://github.acme.com/acme/fork/issues/7",
                },
              },
            },
            USER,
          );
          const before = yield* tickets.get(owner.id);
          const ref = { ticketId: owner.id, linkedIssue };
          const detail = yield* tickets.githubIssueDetail(ref);
          assert.strictEqual(detail.title, "Issue 7");
          assert.strictEqual(detail.preview?.projectId, PROJECT);
          assert.strictEqual(detail.preview?.projectTitle, "web");
          assert.strictEqual(detail.preview?.host, linkedIssue.host);
          assert.strictEqual(detail.preview?.repository, linkedIssue.repository);
          assert.strictEqual(detail.preview?.repositoryUrl, "https://github.acme.com/acme/fork");
          assert.strictEqual(
            detail.preview?.newIssueUrl,
            "https://github.acme.com/acme/fork/issues/new",
          );
          assert.strictEqual(detail.preview?.commentCount, 0);
          assert.strictEqual(detail.preview?.commentsTruncated, false);
          yield* tickets.githubIssueActivity(ref);
          yield* tickets.githubIssueDetail(ref);
          yield* tickets.githubIssueActivity(ref);
          assert.deepStrictEqual(
            fake.calls.map((call) => call.operation),
            ["get", "activity"],
          );
          fake.edit(7, { title: "Updated issue", body: "Fresh body" });
          yield* tickets.invalidateGitHubIssue(ref);
          assert.strictEqual((yield* tickets.githubIssueDetail(ref)).body, "Fresh body");
          yield* tickets.githubIssueActivity(ref);
          yield* tickets.githubIssueSetAssignees({
            ...ref,
            assignees: ["octocat"],
            assigned: true,
          });
          assert.deepStrictEqual(
            (yield* tickets.githubIssueDetail(ref)).assignees.map((actor) => actor.login),
            ["octocat"],
          );
          yield* tickets.githubIssueActivity(ref);
          assert.deepStrictEqual(yield* tickets.get(owner.id), before);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 3);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "activity").length, 3);
          assert.strictEqual(fake.listCalls, 0);
          for (const call of fake.calls)
            assert.deepStrictEqual(
              [call.cwd, call.host, call.repository, call.number],
              ["/work/web", linkedIssue.host, linkedIssue.repository, 7],
            );
          yield* TestClock.adjust("16 seconds");
          yield* tickets.githubIssueDetail(ref);
          yield* tickets.githubIssueActivity(ref);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 4);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "activity").length, 4);
        }),
      ),
  );

  it.effect(
    "shares concurrent linked detail requests and leaves synced ticket reads uncached",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const synced = yield* tickets.resolveRef("acme/web#7");
          yield* tickets.githubIssueDetail({ ticketId: synced.id });
          yield* tickets.githubIssueDetail({ ticketId: synced.id });
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 2);
          const owner = (yield* tickets.create({ title: "Local" }, USER)).ticket;
          const linkedIssue = { host: SOURCE.host, repository: SOURCE.repository, number: 7 };
          yield* tickets.link(
            {
              ticketId: owner.id,
              target: {
                kind: "issue",
                ref: linkedIssue,
                snapshot: {
                  title: "Linked",
                  state: "open",
                  url: "https://github.com/acme/web/issues/7",
                },
              },
            },
            USER,
          );
          const started = yield* Deferred.make<void>();
          const gate = yield* Deferred.make<void>();
          fake.duringGet = Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
          );
          const ref = { ticketId: owner.id, linkedIssue };
          const secondOwner = (yield* tickets.create({ title: "Another local owner" }, USER))
            .ticket;
          yield* tickets.link(
            {
              ticketId: secondOwner.id,
              target: {
                kind: "issue",
                ref: linkedIssue,
                snapshot: {
                  title: "Linked",
                  state: "open",
                  url: "https://github.com/acme/web/issues/7",
                },
              },
            },
            USER,
          );
          const first = yield* tickets.githubIssueDetail(ref).pipe(Effect.forkScoped);
          yield* Deferred.await(started);
          const second = yield* tickets
            .githubIssueDetail({ ticketId: secondOwner.id, linkedIssue })
            .pipe(Effect.forkScoped);
          yield* Deferred.succeed(gate, undefined);
          const [left, right] = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
          assert.deepStrictEqual(left, right);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 3);
        }).pipe(Effect.scoped),
      ),
  );

  it.effect(
    "shares linked reads between owners and invalidates them after linked and synced writes",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const synced = yield* tickets.resolveRef("acme/web#7");
          const linkedIssue = { host: SOURCE.host, repository: SOURCE.repository, number: 7 };
          const createOwner = Effect.fnUntraced(function* (title: string) {
            const owner = (yield* tickets.create({ title, body: `${title} description` }, USER))
              .ticket;
            yield* tickets.link(
              {
                ticketId: owner.id,
                target: {
                  kind: "issue",
                  ref: linkedIssue,
                  snapshot: {
                    title: "Linked",
                    state: "open",
                    url: "https://github.com/acme/web/issues/7",
                  },
                },
              },
              USER,
            );
            return { ticketId: owner.id, linkedIssue };
          });
          const first = yield* createOwner("First owner");
          const second = yield* createOwner("Second owner");
          const refs = [first, second];
          for (const ref of refs) {
            yield* tickets.githubIssueDetail(ref);
            yield* tickets.githubIssueActivity(ref);
          }
          assert.deepStrictEqual(
            fake.calls.map((call) => call.operation),
            ["get", "activity"],
          );
          yield* tickets.githubIssueSetAssignees({
            ...first,
            assignees: ["octocat"],
            assigned: true,
          });
          assert.deepStrictEqual(
            (yield* tickets.githubIssueDetail(second)).assignees.map((actor) => actor.login),
            ["octocat"],
          );
          yield* tickets.githubIssueActivity(second);
          yield* tickets.githubIssueSetAssignees({
            ticketId: synced.id,
            assignees: ["octocat"],
            assigned: false,
          });
          assert.deepStrictEqual((yield* tickets.githubIssueDetail(first)).assignees, []);
          yield* tickets.githubIssueActivity(first);
          fake.edit(7, {
            title: "Fresh after synced refresh",
            body: "Updated description",
            updatedAt: "2026-08-05T00:00:00Z",
          });
          yield* tickets.refreshGitHubIssue({ ticketId: synced.id });
          assert.strictEqual(
            (yield* tickets.githubIssueDetail(second)).body,
            "Updated description",
          );
          yield* tickets.githubIssueActivity(second);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 5);
          assert.strictEqual(fake.calls.filter((call) => call.operation === "activity").length, 4);
          yield* tickets.unlink(
            { ticketId: first.ticketId, kind: "issue", targetKey: "github.com/acme/web#7" },
            USER,
          );
          const rejected = yield* tickets.githubIssueDetail(first).pipe(Effect.flip);
          assert.strictEqual(rejected.message, "This issue is not linked to the ticket.");
          assert.strictEqual(
            (yield* tickets.githubIssueDetail(second)).title,
            "Fresh after synced refresh",
          );
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 5);
          for (const [index, ref] of refs.entries()) {
            const owner = yield* tickets.get(ref.ticketId);
            assert.strictEqual(owner.summary.kind, "local");
            assert.strictEqual(owner.body, `${index === 0 ? "First" : "Second"} owner description`);
          }
          yield* sync.upsertSource({ ...SOURCE, enabled: false });
          const missingSource = yield* tickets.githubIssueDetail(second).pipe(Effect.flip);
          assert.include(missingSource.message, "No project here can read");
          assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 5);
        }),
      ),
  );

  it.effect("bounds repository discovery concurrency while retaining every repository result", () =>
    withSync([issue(7)], ({ tickets, fake }) =>
      Effect.gen(function* () {
        const projectIds = Array.from({ length: 15 }, (_, index) =>
          ProjectId.make(`repo-${index}`),
        );
        for (const projectId of projectIds)
          fake.projects.set(projectId, {
            ...shell,
            id: projectId,
            repositoryIdentity: {
              canonicalKey: `github.com/acme/${projectId}`,
              provider: "github",
              displayName: `acme/${projectId}`,
              locator: {
                source: "git-remote",
                remoteName: "origin",
                remoteUrl: `https://github.com/acme/${projectId}.git`,
              },
            },
          });
        const owner = (yield* tickets.create(
          {
            title: "Many repos",
            links: projectIds.map((projectId) => ({ kind: "project", projectId })),
          },
          USER,
        )).ticket;
        fake.listAllGate = yield* Deferred.make<void>();
        fake.listAllStarted = yield* Queue.unbounded<void>();
        const candidates = yield* tickets
          .issueLinkCandidates({ ticketId: owner.id })
          .pipe(Effect.forkScoped);
        for (let index = 0; index < 12; index += 1) yield* Queue.take(fake.listAllStarted);
        assert.strictEqual(fake.listCalls, 12);
        yield* Deferred.succeed(fake.listAllGate, undefined);
        const result = yield* Fiber.join(candidates);
        assert.strictEqual(fake.listCalls, 15);
        assert.strictEqual(result.entries.length, 15);
        assert.deepStrictEqual(result.errors, []);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect(
    "rejects unrecorded linked identities and stops serving cached reads after unlinking",
    () =>
      withSync([issue(7)], ({ tickets, fake }) =>
        Effect.gen(function* () {
          const linkedIssue = { host: SOURCE.host, repository: SOURCE.repository, number: 7 };
          const owner = (yield* tickets.create({ title: "Owner" }, USER)).ticket;
          yield* tickets.link(
            {
              ticketId: owner.id,
              target: {
                kind: "issue",
                ref: linkedIssue,
                snapshot: {
                  title: "Linked",
                  state: "open",
                  url: "https://github.com/acme/web/issues/7",
                },
              },
            },
            USER,
          );
          for (const wrong of [
            { ...linkedIssue, host: "github.acme.com" },
            { ...linkedIssue, repository: "acme/other" },
            { ...linkedIssue, number: 8 },
          ]) {
            const error = yield* tickets
              .githubIssueDetail({ ticketId: owner.id, linkedIssue: wrong })
              .pipe(Effect.flip);
            assert.strictEqual(error.message, "This issue is not linked to the ticket.");
          }
          assert.strictEqual(fake.calls.length, 0);
          const ref = {
            ticketId: owner.id,
            linkedIssue: { ...linkedIssue, host: "GitHub.com", repository: "ACME/Web" },
          };
          yield* tickets.githubIssueDetail(ref);
          yield* tickets.unlink(
            { ticketId: owner.id, kind: "issue", targetKey: "github.com/acme/web#7" },
            USER,
          );
          const error = yield* tickets.githubIssueDetail(ref).pipe(Effect.flip);
          assert.strictEqual(error.message, "This issue is not linked to the ticket.");
          assert.strictEqual(fake.calls.length, 1);
        }),
      ),
  );

  it.effect(
    "bounds and shares candidate reads, deduplicates repositories and keeps partial failures",
    () =>
      withSync(
        Array.from({ length: 35 }, (_, index) => issue(index + 1)),
        ({ tickets, fake }) =>
          Effect.gen(function* () {
            const duplicate = ProjectId.make("duplicate-project");
            const failing = ProjectId.make("failing-project");
            const identity = {
              canonicalKey: "github.com/acme/web",
              provider: "github",
              displayName: "acme/web",
              locator: {
                source: "git-remote" as const,
                remoteName: "origin",
                remoteUrl: "https://github.com/acme/web.git",
              },
            };
            fake.projects.set(PROJECT, { ...shell, repositoryIdentity: identity });
            fake.projects.set(duplicate, {
              ...shell,
              id: duplicate,
              repositoryIdentity: {
                ...identity,
                canonicalKey: "GitHub.com/ACME/Web",
                displayName: "ACME/Web",
              },
            });
            fake.projects.set(failing, {
              ...shell,
              id: failing,
              title: "private",
              repositoryIdentity: {
                ...identity,
                canonicalKey: "github.com/acme/private",
                displayName: "acme/private",
              },
            });
            fake.listFailures.set(
              "acme/private",
              new IssueProviderError({
                provider: "github",
                operation: "list",
                reason: "unauthenticated",
                detail: "sign in",
              }),
            );
            const owner = (yield* tickets.create(
              {
                title: "Owner",
                links: [PROJECT, duplicate, failing].map((projectId) => ({
                  kind: "project",
                  projectId,
                })),
              },
              USER,
            )).ticket;
            const candidates = yield* tickets.issueLinkCandidates({ ticketId: owner.id });
            assert.strictEqual(candidates.entries.length, 30);
            assert.strictEqual(candidates.errors.length, 1);
            assert.strictEqual(candidates.errors[0]?.projectId, failing);
            assert.include(candidates.errors[0]?.message ?? "", "acme/private");
            assert.include(candidates.errors[0]?.message ?? "", "not signed in");
            assert.deepStrictEqual(
              fake.listInputs.map((input) => [
                input.host,
                input.repository,
                input.state,
                input.limit,
              ]),
              [
                ["github.com", "acme/web", "open", 30],
                ["github.com", "acme/private", "open", 30],
              ],
            );
            yield* tickets.issueLinkCandidates({ ticketId: owner.id });
            assert.strictEqual(fake.listCalls, 3);
            yield* TestClock.adjust("31 seconds");
            yield* tickets.issueLinkCandidates({ ticketId: owner.id });
            assert.strictEqual(fake.listCalls, 5);
          }),
      ),
  );

  it.effect(
    "refines legacy unknown repositories on Enterprise hosts and reports unavailable providers",
    () =>
      withSync([issue(7)], ({ tickets, fake }) =>
        Effect.gen(function* () {
          fake.projects.set(PROJECT, {
            ...shell,
            repositoryIdentity: {
              canonicalKey: "github.acme.com/acme/web",
              provider: "unknown",
              displayName: "acme/web",
              locator: {
                source: "git-remote",
                remoteName: "origin",
                remoteUrl: "https://github.acme.com/acme/web.git",
              },
            },
          });
          const owner = (yield* tickets.create(
            { title: "Owner", links: [{ kind: "project", projectId: PROJECT }] },
            USER,
          )).ticket;
          const candidates = yield* tickets.issueLinkCandidates({ ticketId: owner.id });
          assert.strictEqual(candidates.entries[0]?.host, "github.acme.com");
          assert.deepStrictEqual(fake.refinementCalls, ["/work/web"]);
          fake.providerAvailable = false;
          const unavailable = yield* tickets.issueLinkCandidates({ ticketId: owner.id });
          assert.strictEqual(unavailable.entries.length, 0);
          assert.include(unavailable.errors[0]?.message ?? "", "not available");
          assert.deepStrictEqual(fake.refinementCalls, ["/work/web"]);
        }),
      ),
  );

  it.effect(
    "reports a recorded issue whose repository has no environment-local source or matching project",
    () =>
      withSync([issue(7)], ({ tickets, fake }) =>
        Effect.gen(function* () {
          const owner = (yield* tickets.create({ title: "Owner" }, USER)).ticket;
          const linkedIssue = { host: "github.acme.com", repository: "acme/absent", number: 7 };
          yield* tickets.link(
            {
              ticketId: owner.id,
              target: {
                kind: "issue",
                ref: linkedIssue,
                snapshot: {
                  title: "Absent",
                  state: "open",
                  url: "https://github.acme.com/acme/absent/issues/7",
                },
              },
            },
            USER,
          );
          const error = yield* tickets
            .githubIssueDetail({ ticketId: owner.id, linkedIssue })
            .pipe(Effect.flip);
          assert.include(error.message, "No project here can read github.acme.com/acme/absent");
          assert.strictEqual(fake.calls.length, 0);
        }),
      ),
  );

  it.effect(
    "routes ticket reads and writes through the stored Enterprise host and fork source",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          const enterprise = {
            ...SOURCE,
            host: "github.acme.com",
            repository: "YasielCabrera/vetra-code",
          };
          yield* sync.upsertSource({ ...enterprise, enabled: true });
          yield* sync.syncNow(enterprise);
          const ticket = yield* tickets.resolveRef("YasielCabrera/vetra-code#7");
          const ref = { ticketId: ticket.id };
          yield* tickets.githubIssueDetail(ref);
          yield* tickets.githubIssueActivity(ref);
          yield* tickets.githubIssueAssigneeCandidates(ref);
          yield* tickets.githubIssueSetAssignees({
            ...ref,
            assignees: ["octocat"],
            assigned: true,
          });
          yield* tickets.postUserComment({ ...ref, body: "Shipped" });
          yield* tickets.move(
            { ...ref, expectedRevision: ticket.revision, statusId: status("done"), sortKey: "a0" },
            USER,
          );
          yield* tickets.refreshGitHubIssue(ref);
          assert.deepStrictEqual(
            new Set(fake.calls.map((call) => call.operation)),
            new Set(["get", "activity", "candidates", "assignees", "comment", "state"]),
          );
          for (const call of fake.calls)
            assert.deepStrictEqual(
              [call.cwd, call.host, call.repository, call.number],
              ["/work/web", enterprise.host, enterprise.repository, 7],
            );
        }),
      ),
  );

  it.effect("refreshes a closed ticket directly, including its body and labels", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        fake.edit(7, {
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-08-04T00:00:00Z",
        });
        yield* sync.syncNow(SOURCE);
        fake.edit(7, {
          title: "Closed rename",
          body: "Updated after closure",
          labels: ["fixed"],
          updatedAt: "2026-08-05T00:00:00Z",
        });
        yield* tickets.refreshGitHubIssue({ ticketId: ticket.id });
        const detail = yield* tickets.get(ticket.id);
        assert.deepStrictEqual(
          [detail.summary.title, detail.body, detail.summary.labels, detail.summary.statusId],
          ["Closed rename", "Updated after closure", ["fixed"], "done"],
        );
      }),
    ),
  );

  it.effect("a refresh cannot recreate a ticket deleted while GitHub was being read", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        fake.duringGet = tickets.releaseGitHubRepository({ ...SOURCE, deleteCache: true });
        const result = yield* tickets.refreshGitHubIssue({ ticketId: ticket.id }).pipe(Effect.flip);
        assert.strictEqual(result._tag, "TicketNotFoundError");
        const missing = yield* tickets.resolveRef("acme/web#7").pipe(Effect.flip);
        assert.strictEqual(missing._tag, "TicketNotFoundError");
      }),
    ),
  );

  it.effect.each(["close", "reopen"] as const)(
    "confirms a contradictory list after a failed post-write read: %s",
    (action) =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const ticket = yield* tickets.resolveRef("acme/web#7");
          if (action === "reopen") {
            yield* tickets.move(
              { ticketId: ticket.id, expectedRevision: 1, statusId: status("done"), sortKey: "a0" },
              USER,
            );
          }
          const current = yield* tickets.resolveRef("acme/web#7");
          fake.staleList = [fake.issues.get(7)!];
          fake.getFailure = new IssueProviderError({
            provider: "github",
            operation: "detail",
            reason: "failed",
            detail: "Network unavailable",
          });
          yield* tickets.move(
            {
              ticketId: ticket.id,
              expectedRevision: current.revision,
              statusId: status(action === "close" ? "done" : "todo"),
              sortKey: "a0",
            },
            USER,
          );
          const failed = yield* sync.syncNow(SOURCE);
          assert.strictEqual(failed.lastError, "Network unavailable");
          assert.strictEqual(
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            action === "close" ? "done" : "todo",
          );
          fake.getFailure = null;
          const recovered = yield* sync.syncNow(SOURCE);
          assert.strictEqual(recovered.lastError, null);
          assert.strictEqual(
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            action === "close" ? "done" : "todo",
          );
        }),
      ),
  );

  it.effect("uses an unlisted direct read as confirmation without fetching the issue twice", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        yield* tickets.move(
          { ticketId: ticket.id, expectedRevision: 1, statusId: status("done"), sortKey: "a0" },
          USER,
        );
        fake.getFailure = new IssueProviderError({
          provider: "github",
          operation: "detail",
          reason: "failed",
          detail: "Network unavailable",
        });
        yield* tickets.move(
          { ticketId: ticket.id, expectedRevision: 2, statusId: status("todo"), sortKey: "a0" },
          USER,
        );
        fake.getFailure = null;
        fake.edit(7, { state: "closed", stateReason: "completed" });
        fake.calls.length = 0;
        yield* sync.syncNow(SOURCE);
        assert.strictEqual(fake.calls.filter((call) => call.operation === "get").length, 1);
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).statusId, "done");
      }),
    ),
  );

  it.effect("caps unlisted reads and continues beyond the previous batch next time", () =>
    withSync(
      Array.from({ length: TicketGitHubSync.MAX_UNLISTED_REFRESHES + 3 }, (_, index) =>
        issue(index + 1),
      ),
      ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          for (const [number] of fake.issues)
            fake.edit(number, {
              state: "closed",
              stateReason: "completed",
              updatedAt: "2026-08-05T00:00:00Z",
            });
          fake.calls.length = 0;
          yield* sync.syncNow(SOURCE);
          assert.strictEqual(
            fake.calls.filter((call) => call.operation === "get").length,
            TicketGitHubSync.MAX_UNLISTED_REFRESHES,
          );
          assert.strictEqual(
            (yield* tickets.resolveRef(`acme/web#${TicketGitHubSync.MAX_UNLISTED_REFRESHES + 1}`))
              .statusId,
            "todo",
          );
          fake.calls.length = 0;
          yield* sync.syncNow(SOURCE);
          assert.deepStrictEqual(
            fake.calls.map((call) => call.number),
            [51, 52, 53],
          );
          assert.strictEqual((yield* tickets.resolveRef("acme/web#53")).statusId, "done");
        }),
    ),
  );

  it.effect("serializes source upsert and restore behind cache removal", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        fake.releaseStarted = yield* Deferred.make<void>();
        fake.releaseGate = yield* Deferred.make<void>();
        const removal = yield* sync
          .removeSource({ ...SOURCE, deleteCache: false })
          .pipe(Effect.forkChild);
        yield* Deferred.await(fake.releaseStarted);
        const readsBefore = fake.projectReads;
        const added = yield* sync.upsertSource({ ...SOURCE, enabled: true }).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.strictEqual(fake.projectReads, readsBefore);
        yield* Deferred.succeed(fake.releaseGate, undefined);
        yield* Fiber.join(removal);
        yield* Fiber.join(added);
        const restored = yield* tickets.get(ticket.id);
        assert.strictEqual(githubOf(restored.summary)?.hiddenAt, null);
      }),
    ),
  );

  it.effect("atomically refuses concurrent unlinks that would leave no repository reader", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        const other = ProjectId.make("other-reader");
        const identity = {
          canonicalKey: "github.com/acme/web",
          locator: {
            source: "git-remote" as const,
            remoteName: "origin",
            remoteUrl: "https://github.com/acme/web.git",
          },
        };
        fake.projects.set(PROJECT, { ...shell, repositoryIdentity: identity });
        fake.projects.set(other, { ...shell, id: other, repositoryIdentity: identity });
        yield* tickets.link(
          { ticketId: ticket.id, target: { kind: "project", projectId: other } },
          USER,
        );
        yield* sync.upsertSource({ ...SOURCE, enabled: false });
        const results = yield* Effect.all(
          [PROJECT, other].map((projectId) =>
            tickets
              .unlink({ ticketId: ticket.id, kind: "project", targetKey: projectId }, USER)
              .pipe(Effect.exit),
          ),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(results.filter(Exit.isSuccess).length, 1);
        const remaining = yield* tickets.get(ticket.id);
        assert.strictEqual(
          remaining.links.filter((link) => link.target.kind === "project").length,
          1,
        );
        yield* sync.upsertSource({ ...SOURCE, enabled: true });
        const last = remaining.summary.linkRefs.find((ref) => ref.kind === "project")!;
        yield* tickets.unlink(
          { ticketId: ticket.id, kind: "project", targetKey: last.targetKey },
          USER,
        );
        assert.strictEqual((yield* tickets.get(ticket.id)).links.length, 0);
      }),
    ),
  );

  it.effect("imports open issues as T- numbered tickets linked to the source's project", () =>
    withSync(
      [
        issue(7, { title: "Login fails", labels: ["bug"] }),
        issue(9, { state: "closed", stateReason: "completed" }),
      ],
      ({ tickets, sync }) =>
        Effect.gen(function* () {
          const source = yield* sync.syncNow(SOURCE);
          const ticket = yield* tickets.resolveRef("acme/web#7");

          assert.deepStrictEqual(
            [source.issueCount, source.lastError, source.lastSyncedAt],
            [1, null, "2026-09-01T00:00:00.000Z"],
          );
          assert.deepStrictEqual(
            [ticket.number, ticket.title, ticket.labels, ticket.statusId, ticket.linkRefs],
            [1, "Login fails", ["bug"], "todo", [{ kind: "project", targetKey: "project-web" }]],
          );
          assert.strictEqual((yield* tickets.get(ticket.id)).body, "Body 7");
          const missing = yield* tickets.resolveRef("acme/web#9").pipe(Effect.flip);
          assert.strictEqual(missing._tag, "TicketNotFoundError");
        }),
    ),
  );

  it.effect("re-syncs the snapshot and records synced activity only when the issue changed", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* TestClock.adjust("1 hour");
        yield* sync.syncNow(SOURCE);
        const unchanged = yield* tickets.resolveRef("acme/web#7");
        fake.edit(7, { title: "Renamed", labels: ["p1"], updatedAt: "2026-08-03T00:00:00Z" });
        yield* sync.syncNow(SOURCE);
        const changed = yield* tickets.get(unchanged.id);

        assert.deepStrictEqual(
          [unchanged.revision, unchanged.updatedAt],
          [1, "2026-09-01T00:00:00.000Z"],
        );
        assert.deepStrictEqual(
          [changed.summary.title, changed.summary.labels, changed.summary.revision],
          ["Renamed", ["p1"], 2],
        );
        assert.deepStrictEqual(
          changed.activity.map((activity) => activity.entry),
          [{ type: "created" }, { type: "synced", changes: ["title", "labels"] }],
        );
      }),
    ),
  );

  it.effect(
    "moves an issue closed on GitHub to the status with its reason, and a reopen back",
    () =>
      withSync([issue(7), issue(8)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const later = "2026-08-05T00:00:00Z";
          fake.edit(7, { state: "closed", stateReason: "completed", updatedAt: later });
          fake.edit(8, { state: "closed", stateReason: "not_planned", updatedAt: later });
          yield* sync.syncNow(SOURCE);
          const closed = [
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            (yield* tickets.resolveRef("acme/web#8")).statusId,
          ];
          fake.edit(7, {
            state: "open",
            stateReason: "reopened",
            updatedAt: "2026-08-06T00:00:00Z",
          });
          yield* sync.syncNow(SOURCE);

          assert.deepStrictEqual(closed, ["done", "canceled"]);
          assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).statusId, "todo");
        }),
      ),
  );

  it.effect("skips hidden tickets until they are tracked again", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        yield* tickets.setHidden({ ticketId: ticket.id, hidden: true });
        fake.edit(7, { title: "Renamed", updatedAt: "2026-08-03T00:00:00Z" });
        yield* sync.syncNow(SOURCE);
        const hidden = yield* tickets.resolveRef("acme/web#7");
        yield* tickets.setHidden({ ticketId: ticket.id, hidden: false });
        yield* sync.syncNow(SOURCE);

        assert.strictEqual(hidden.title, "Issue 7");
        assert.strictEqual(githubOf(hidden)?.hiddenAt, "2026-09-01T00:00:00.000Z");
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).title, "Renamed");
      }),
    ),
  );

  it.effect("keeps a GitHub sign-in failure on the source instead of failing", () =>
    withSync([issue(7)], ({ sync, fake }) =>
      Effect.gen(function* () {
        fake.listFailure = new IssueProviderError({
          provider: "github",
          operation: "list",
          reason: "unauthenticated",
          detail: "GitHub CLI is not authenticated.",
        });
        const source = yield* sync.syncNow(SOURCE);

        assert.deepStrictEqual(
          [source.lastError, source.lastSyncedAt],
          ["GitHub CLI is not signed in on this environment. Run `gh auth login` there.", null],
        );
      }),
    ),
  );

  it.effect(
    "closes the issue for a user's move to a closed status, and a failed reopen changes nothing",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const ticket = yield* tickets.resolveRef("acme/web#7");
          const moved = yield* tickets.move(
            {
              ticketId: ticket.id,
              expectedRevision: 1,
              statusId: status("canceled"),
              sortKey: "a0",
            },
            USER,
          );
          yield* sync.syncNow(SOURCE);
          fake.setStateFailure = new IssueProviderError({
            provider: "github",
            operation: "setState",
            reason: "failed",
            detail: "GitHub could not complete the issue request.",
          });
          const failed = yield* tickets
            .move(
              { ticketId: ticket.id, expectedRevision: 2, statusId: status("todo"), sortKey: "a0" },
              USER,
            )
            .pipe(Effect.flip);
          const after = yield* tickets.resolveRef("acme/web#7");

          assert.deepStrictEqual(fake.setStateCalls, [
            { number: 7, change: { state: "closed", reason: "not_planned" } },
          ]);
          assert.deepStrictEqual(
            [moved.statusId, githubOf(moved)?.github.state, after.statusId, after.revision],
            ["canceled", "closed", "canceled", 2],
          );
          assert.strictEqual(
            failed.message,
            "Could not reopen acme/web#7 on GitHub. GitHub could not complete the issue request.",
          );
        }),
      ),
  );

  it.effect("keeps agents off GitHub while the user's comment box posts to the issue", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        const refused = yield* tickets
          .update({ ticketId: ticket.id, expectedRevision: 1, statusId: status("done") }, AGENT)
          .pipe(Effect.flip);
        yield* tickets.addComment({ ticketId: ticket.id, body: "Agent note" }, AGENT);
        yield* tickets.postUserComment({ ticketId: ticket.id, body: "Shipped in 1.2" });
        const detail = yield* tickets.get(ticket.id);

        assert.strictEqual(refused._tag, "TicketError");
        assert.deepStrictEqual(fake.setStateCalls, []);
        assert.deepStrictEqual(fake.commentCalls, [{ number: 7, body: "Shipped in 1.2" }]);
        assert.deepStrictEqual(
          detail.activity.map((activity) => activity.entry),
          [{ type: "created" }, { type: "comment", body: "Agent note" }],
        );
      }),
    ),
  );

  it.effect("hides a removed source's tickets, or deletes them when asked", () =>
    withSync([issue(7)], ({ tickets, sync }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const kept = yield* sync.removeSource({ ...SOURCE, deleteCache: false });
        const hidden = yield* tickets.resolveRef("acme/web#7");
        yield* sync.upsertSource({ ...SOURCE, enabled: true });
        yield* sync.removeSource({ ...SOURCE, deleteCache: true });
        const deleted = yield* tickets.resolveRef("acme/web#7").pipe(Effect.flip);

        assert.deepStrictEqual(kept.sources, []);
        assert.strictEqual(githubOf(hidden)?.hiddenAt, "2026-09-01T00:00:00.000Z");
        assert.strictEqual(deleted._tag, "TicketNotFoundError");
      }),
    ),
  );

  it.effect(
    "a user's close stores GitHub's own updatedAt, and the old one if the re-read fails",
    () =>
      withSync([issue(7), issue(8)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const move = (reference: string) =>
            Effect.gen(function* () {
              const ticket = yield* tickets.resolveRef(reference);
              return yield* tickets.move(
                {
                  ticketId: ticket.id,
                  expectedRevision: 1,
                  statusId: status("done"),
                  sortKey: "a0",
                },
                USER,
              );
            });
          const closed = yield* move("acme/web#7");
          fake.getFailure = new IssueProviderError({
            provider: "github",
            operation: "detail",
            reason: "failed",
            detail: "GitHub could not complete the issue request.",
          });
          const unread = yield* move("acme/web#8");

          assert.deepStrictEqual(
            [closed, unread].map((ticket) => {
              const snapshot = githubOf(ticket)?.github;
              return [snapshot?.state, snapshot?.stateReason, snapshot?.updatedAt];
            }),
            [
              ["closed", "completed", "2026-08-20T00:00:00Z"],
              ["closed", "completed", "2026-08-02T00:00:00Z"],
            ],
          );
        }),
      ),
  );

  it.effect("a move that loses a race after closing the issue says so, and sync catches up", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        fake.duringSetState = tickets.upsertGitHubIssue({
          ...SOURCE,
          issue: {
            number: 7,
            title: "Renamed meanwhile",
            url: "https://github.com/acme/web/issues/7",
            author: null,
            state: "open",
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-03T00:00:00Z",
            closedAt: null,
            labels: [],
            assignees: [],
            milestone: null,
            body: "Body 7",
          },
        });
        const lost = yield* tickets
          .move(
            { ticketId: ticket.id, expectedRevision: 1, statusId: status("done"), sortKey: "a0" },
            USER,
          )
          .pipe(Effect.flip);
        const raced = yield* tickets.get(ticket.id);
        fake.duringSetState = Effect.void;
        yield* sync.syncNow(SOURCE);
        const caughtUp = yield* tickets.resolveRef("acme/web#7");

        assert.strictEqual(lost._tag, "TicketRevisionConflictError");
        assert.deepStrictEqual(
          raced.activity.map((activity) => [activity.actor.type, activity.entry]),
          [
            ["sync", { type: "created" }],
            ["sync", { type: "synced", changes: ["title"] }],
            ["sync", { type: "synced", changes: ["state"] }],
          ],
        );
        assert.deepStrictEqual(
          [raced.summary.statusId, caughtUp.statusId, githubOf(caughtUp)?.github.state],
          ["todo", "done", "closed"],
        );
      }),
    ),
  );

  it.effect("refuses status changes that would close or reopen GitHub issues", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        yield* tickets.setHidden({ ticketId: ticket.id, hidden: true });
        const recategorized = yield* tickets
          .upsertStatus({
            statusId: status("todo"),
            name: "Todo",
            color: "blue",
            category: "closed",
            closeReason: "completed",
          })
          .pipe(Effect.flip);
        const reassigned = yield* tickets
          .deleteStatus({ statusId: status("todo"), reassignTo: status("done") }, USER)
          .pipe(Effect.flip);
        const renamed = yield* tickets.upsertStatus({
          statusId: status("todo"),
          name: "Up next",
          color: "blue",
          category: "open",
        });
        const deleted = yield* tickets.deleteStatus(
          { statusId: status("todo"), reassignTo: status("backlog") },
          USER,
        );

        assert.deepStrictEqual(
          [recategorized.message, reassigned.message],
          [
            "Todo holds 1 GitHub ticket. Move it to another status first: making Todo closed would close its issue.",
            "Move Todo's tickets to another open status.",
          ],
        );
        assert.strictEqual(renamed.statuses.find((entry) => entry.id === "todo")?.name, "Up next");
        assert.strictEqual(
          deleted.statuses.some((entry) => entry.id === "todo"),
          false,
        );
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).statusId, "backlog");
        assert.deepStrictEqual(fake.setStateCalls, []);
      }),
    ),
  );

  it.effect(
    "re-adding a source shows what its removal hid, not what the user stopped tracking",
    () =>
      withSync([issue(7), issue(8)], ({ tickets, sync }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const stopped = yield* tickets.resolveRef("acme/web#8");
          yield* tickets.setHidden({ ticketId: stopped.id, hidden: true });
          yield* sync.removeSource({ ...SOURCE, deleteCache: false });
          const whileRemoved = yield* Effect.forEach(
            ["acme/web#7", "acme/web#8"],
            tickets.resolveRef,
          );
          yield* sync.upsertSource({ ...SOURCE, enabled: true });
          const readded = yield* Effect.forEach(["acme/web#7", "acme/web#8"], tickets.resolveRef);

          assert.deepStrictEqual(
            [whileRemoved, readded].map((list) => list.map((ticket) => githubOf(ticket)?.hiddenAt)),
            [
              ["2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
              [null, "2026-09-01T00:00:00.000Z"],
            ],
          );
        }),
      ),
  );

  it.effect("syncs a source again only once its last attempt is older than the interval", () =>
    withSync([issue(7)], ({ sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncDue;
        yield* sync.syncDue;
        const afterFirst = fake.listCalls;
        yield* TestClock.adjust("10 minutes");
        fake.listFailure = new IssueProviderError({
          provider: "github",
          operation: "list",
          reason: "rate-limited",
          detail: "GitHub's request limit has been reached.",
        });
        yield* sync.syncDue;
        yield* TestClock.adjust("9 minutes");
        yield* sync.syncDue;

        const [source] = (yield* sync.subscribeSources().pipe(Stream.runHead)).pipe(
          Option.getOrThrow,
        ).sources;
        assert.deepStrictEqual(
          [afterFirst, fake.listCalls, source?.lastSyncedAt, source?.lastError],
          [
            1,
            2,
            "2026-09-01T00:00:00.000Z",
            "GitHub's request limit was reached. Try again after it resets.",
          ],
        );
      }),
    ),
  );

  it.effect("a sync queued behind a source's removal does not bring its tickets back", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        fake.listGate = yield* Deferred.make<void>();
        fake.listStarted = yield* Deferred.make<void>();
        const gate = fake.listGate;
        const inFlight = yield* sync.syncNow(SOURCE).pipe(Effect.forkChild);
        yield* Deferred.await(fake.listStarted);
        const removal = yield* sync
          .removeSource({ ...SOURCE, deleteCache: true })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const due = yield* sync.syncDue.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(inFlight);
        const remaining = yield* Fiber.join(removal);
        yield* Fiber.join(due);

        const reimported = yield* tickets.resolveRef("acme/web#7").pipe(Effect.flip);
        assert.deepStrictEqual(
          [remaining.sources, fake.listCalls, reimported._tag],
          [[], 1, "TicketNotFoundError"],
        );
      }),
    ),
  );

  it.effect("a failed issue read lands on the source instead of reading as deleted", () =>
    withSync([issue(7), issue(8)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        fake.edit(7, {
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-08-05T00:00:00Z",
        });
        fake.issues.delete(8);
        fake.getFailure = new IssueProviderError({
          provider: "github",
          operation: "detail",
          reason: "failed",
          detail: "GitHub could not complete the issue request.",
        });
        const failed = yield* sync.syncNow(SOURCE);
        fake.getFailure = null;
        const recovered = yield* sync.syncNow(SOURCE);

        assert.deepStrictEqual(
          [failed.lastError, recovered.lastError],
          ["GitHub could not complete the issue request.", null],
        );
        assert.deepStrictEqual(
          [
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            githubOf(yield* tickets.resolveRef("acme/web#8"))?.github.state,
          ],
          ["done", "open"],
        );
      }),
    ),
  );
});
