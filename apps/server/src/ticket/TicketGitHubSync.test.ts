import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  SourceControlProviderKind,
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
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

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
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitHubApi from "@t3tools/source-control-github/server/GitHubApi";
import * as GitHubCredentials from "@t3tools/source-control-github/server/GitHubCredentials";
import * as GitHubQuota from "@t3tools/source-control-github/server/GitHubQuota";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
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
    const provider = yield* GitHubIssueProvider.make.pipe(
      Effect.provideServiceEffect(GitHubIssueCli.GitHubIssueCli, GitHubIssueCli.make),
      Effect.provideService(
        GitHubApi.GitHubApi,
        GitHubApi.GitHubApi.of({
          // GitHub answers a missing issue with a NOT_FOUND error, which the API fails as such.
          graphql: (request) =>
            Effect.fail(
              new GitHubApi.GitHubApiNotFoundError({
                host: request.host,
                operation: request.operation,
              }),
            ),
          rest: () => Effect.die("unused"),
          credential: () => Effect.die("unused"),
        }),
      ),
    );
    return yield* provider.getIssue(input);
  });

function makeFakeGitHub(initial: ReadonlyArray<FakeIssue>) {
  const issues = new Map(initial.map((issue) => [issue.number, issue]));
  const fake = {
    issues,
    selectedCredential: "initial",
    deniedCredentials: new Set<string>(),
    issueCredentialFingerprints: [] as string[],
    probeCredentialFingerprints: [] as string[],
    setStateCalls: [] as Array<{ readonly number: number; readonly change: IssueStateChange }>,
    commentCalls: [] as Array<{ readonly number: number; readonly body: string }>,
    listCalls: 0,
    listedNumbers: [] as number[],
    listOmissions: new Set<number>(),
    beforeRead: Effect.void as Effect.Effect<void, IssueProviderError>,
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
    probeFailure: null as IssueProviderError | null,
    probeWithoutCount: false,
    closedListFailure: null as IssueProviderError | null,
    listTruncated: false,
    listSkippedCount: 0,
    duringList: Effect.void as Effect.Effect<void, TicketError>,
    getFailure: null as IssueProviderError | null,
    getFailures: new Map<number, IssueProviderError>(),
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
    ...(issue.stateReason === null ? {} : { stateReason: issue.stateReason }),
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
    kind: SourceControlProviderKind.make("github"),
    repositoryLinks: ({ host, repository }) => ({
      repositoryUrl: `https://${host}/${repository}`,
      newIssueUrl: `https://${host}/${repository}/issues/new`,
    }),
    listIssues: (input) =>
      Effect.gen(function* () {
        yield* fake.beforeRead;
        fake.listCalls += 1;
        fake.listInputs.push(input);
        const probe =
          input.limit === 1 && input.includeOpenCount === true && input.includeBody !== true;
        if (probe) {
          const pinned = yield* GitHubApi.PinnedGitHubCredential;
          const fingerprint = pinned?.credentialFingerprint ?? fake.selectedCredential;
          fake.probeCredentialFingerprints.push(fingerprint);
          if (fake.deniedCredentials.has(fingerprint))
            return yield* new IssueProviderError({
              provider: SourceControlProviderKind.make("github"),
              operation: "list",
              reason: "failed",
              detail: "The repository is not accessible.",
              cause: new GitHubApi.GitHubApiNotFoundError({
                host: input.host,
                operation: "listIssues",
              }),
            });
        }
        if (probe && fake.probeFailure !== null) return yield* fake.probeFailure;
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
        if (input.state === "closed" && fake.closedListFailure !== null)
          return yield* fake.closedListFailure;
        const failure = fake.listFailures.get(input.repository);
        if (failure !== undefined) return yield* failure;
        const found = (fake.staleList ?? [...issues.values()])
          .filter((issue) => issue.state === input.state)
          .filter(
            (issue) =>
              !fake.listOmissions.has(issue.number) &&
              (input.updatedSince === undefined ||
                Date.parse(issue.updatedAt) >= Date.parse(input.updatedSince)),
          )
          .filter(
            (issue) =>
              input.cursor === undefined ||
              Date.parse(issue.updatedAt) <= Date.parse(input.cursor.updatedBefore),
          )
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.number - b.number);
        const limit = input.limit + (input.cursor?.seenAt.length ?? 0);
        const page = found.slice(0, limit);
        fake.listedNumbers.push(...page.map((issue) => issue.number));
        yield* fake.duringList.pipe(Effect.orDie);
        return {
          issues: page.map((issue) => {
            const { body: _body, ...metadata } = listed(issue);
            return {
              ...metadata,
              ...(input.includeBody ? { body: issue.body } : {}),
              url: `https://${input.host}/${input.repository}/issues/${issue.number}`,
            };
          }),
          truncated: fake.listTruncated || found.length > limit,
          skippedCount: fake.listSkippedCount,
          ...(input.includeOpenCount && !(probe && fake.probeWithoutCount)
            ? {
                totalOpenCount: [...issues.values()].filter((issue) => issue.state === "open")
                  .length,
              }
            : {}),
        };
      }),
    getIssueMetadata: (input) =>
      Effect.gen(function* () {
        const pinned = yield* GitHubApi.PinnedGitHubCredential;
        const fingerprint = pinned?.credentialFingerprint ?? fake.selectedCredential;
        fake.issueCredentialFingerprints.push(fingerprint);
        fake.calls.push({ operation: "get", ...input });
        if (fake.getFailure !== null) return yield* fake.getFailure;
        const failure = fake.getFailures.get(input.number);
        if (failure !== undefined) return yield* failure;
        const issue = issues.get(input.number);
        const read =
          issue === undefined || fake.deniedCredentials.has(fingerprint)
            ? missingIssueThroughClassifier(input)
            : Effect.succeed({
                ...listed(issue),
                ...(issue.stateReason === null ? {} : { stateReason: issue.stateReason }),
                body: issue.body,
                url: `https://${input.host}/${input.repository}/issues/${issue.number}`,
              });
        return yield* fake.beforeRead.pipe(
          Effect.andThen(fake.duringGet.pipe(Effect.orDie)),
          Effect.andThen(read),
        );
      }),
    getIssue: (input) =>
      Effect.gen(function* () {
        const pinned = yield* GitHubApi.PinnedGitHubCredential;
        const fingerprint = pinned?.credentialFingerprint ?? fake.selectedCredential;
        fake.issueCredentialFingerprints.push(fingerprint);
        fake.calls.push({ operation: "get", ...input });
        if (fake.getFailure !== null) return yield* fake.getFailure;
        const failure = fake.getFailures.get(input.number);
        if (failure !== undefined) return yield* failure;
        const issue = issues.get(input.number);
        const read =
          issue === undefined || fake.deniedCredentials.has(fingerprint)
            ? missingIssueThroughClassifier(input)
            : Effect.succeed({
                ...detail(issue),
                url: `https://${input.host}/${input.repository}/issues/${issue.number}`,
              });
        return yield* fake.beforeRead.pipe(
          Effect.andThen(fake.duringGet.pipe(Effect.orDie)),
          Effect.andThen(read),
        );
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
    readonly quota: GitHubQuota.GitHubQuota["Service"];
    readonly rateLimits: SourceControlRateLimit.SourceControlRateLimit["Service"];
    readonly fake: ReturnType<typeof makeFakeGitHub>["fake"];
    readonly sql: SqlClient.SqlClient;
    readonly bootstrapAgain: Effect.Effect<void>;
    readonly restartSync: Effect.Effect<TicketGitHubSync.TicketGitHubSync["Service"]>;
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
                            provider: {
                              ...input.context.provider,
                              kind: SourceControlProviderKind.make("github"),
                            },
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
            Layer.mock(SourceControlProvider.SourceControlProvider)({
              kind: SourceControlProviderKind.make("github"),
            }),
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
        GitHubQuota.layer,
        Layer.succeed(
          GitHubApi.GitHubApi,
          GitHubApi.GitHubApi.of({
            credential: () =>
              Effect.sync(() => ({
                token: Redacted.make("fake-ticket-token"),
                fingerprint: fake.selectedCredential,
              })),
            graphql: () => Effect.die("unused"),
            rest: () => Effect.die("unused"),
          }),
        ),
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
    const sql = yield* SqlClient.SqlClient;
    const restartLayer = TicketGitHubSync.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, sql),
          Layer.succeed(TicketService.TicketService, tickets),
          Layer.succeed(TicketGitHub.TicketGitHub, yield* TicketGitHub.TicketGitHub),
          Layer.succeed(IssueProviderRegistry, yield* IssueProviderRegistry),
          Layer.succeed(ProjectService.ProjectService, yield* ProjectService.ProjectService),
        ),
      ),
    );
    yield* sync.upsertSource({ ...SOURCE, enabled: true });
    return yield* body({
      tickets,
      sync,
      fake,
      sql,
      bootstrapAgain: sql`UPDATE ticket_github_sources SET sync_watermark_at = NULL`.pipe(
        Effect.asVoid,
        Effect.orDie,
      ),
      restartSync: TicketGitHubSync.TicketGitHubSync.pipe(Effect.provide(restartLayer)),
      quota: yield* GitHubQuota.GitHubQuota,
      rateLimits: yield* SourceControlRateLimit.SourceControlRateLimit,
    });
  }).pipe(Effect.provideService(TicketService.GitHubWriteAccess, true), Effect.provide(layer));
};

const githubOf = (ticket: TicketSummary) => (ticket.kind === "github" ? ticket : null);

describe("TicketGitHubSync", () => {
  it.effect("does not reread unchanged issues after the first repository sync", () =>
    withSync([issue(7), issue(8)], ({ sync, fake, tickets }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        fake.listedNumbers.length = 0;
        yield* TestClock.adjust("10 minutes");
        const second = yield* sync.syncNow(SOURCE);
        assert.deepStrictEqual(fake.listedNumbers, []);
        assert.strictEqual(second.issueCount, 2);
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).revision, 1);
      }),
    ),
  );

  it.effect("an unchanged large repository uses two empty delta searches", () =>
    withSync(
      Array.from({ length: 120 }, (_, index) => issue(index + 1)),
      ({ sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          assert.strictEqual(fake.listCalls, 3);
          fake.listInputs.length = 0;
          fake.listedNumbers.length = 0;
          const second = yield* sync.syncNow(SOURCE);
          assert.deepStrictEqual(
            fake.listInputs.map(({ state }) => state),
            ["open", "closed"],
          );
          assert.deepStrictEqual(fake.listedNumbers, []);
          assert.deepStrictEqual(fake.calls, []);
          assert.strictEqual(second.issueCount, 120);
        }),
    ),
  );

  it.effect("shares a repository read cycle across projects", () =>
    withSync([issue(7)], ({ sync, fake, tickets }) =>
      Effect.gen(function* () {
        const projectId = ProjectId.make("second-project");
        fake.projects.set(projectId, { ...shell, id: projectId, workspaceRoot: "/work/second" });
        yield* sync.upsertSource({ ...SOURCE, projectId, enabled: true });
        yield* sync.syncDue;
        assert.strictEqual(fake.listCalls, 1);
        assert.deepStrictEqual((yield* tickets.resolveRef("acme/web#7")).linkRefs, [
          { kind: "project", targetKey: "project-web" },
          { kind: "project", targetKey: "second-project" },
        ]);
      }),
    ),
  );

  it.effect("bootstraps a new source without replacing a newer cached issue", () =>
    withSync([issue(7)], ({ sync, fake, tickets }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        fake.edit(7, { title: "New detail", body: "New body", updatedAt: "2026-09-01T00:00:00Z" });
        yield* tickets.refreshGitHubIssue({ ticketId: ticket.id });
        fake.edit(7, {
          title: "Old search row",
          body: "Old body",
          updatedAt: "2026-08-02T00:00:00Z",
        });
        const projectId = ProjectId.make("second-project");
        fake.projects.set(projectId, { ...shell, id: projectId });
        yield* sync.upsertSource({ ...SOURCE, projectId, enabled: true });
        yield* sync.syncNow({ ...SOURCE, projectId });
        const linked = yield* tickets.get(ticket.id);
        assert.deepStrictEqual(
          [linked.summary.title, linked.body, linked.summary.linkRefs],
          [
            "New detail",
            "New body",
            [
              { kind: "project", targetKey: "project-web" },
              { kind: "project", targetKey: "second-project" },
            ],
          ],
        );
      }),
    ),
  );

  it.effect("a valid incremental result clears a pending unreadable metadata retry", () =>
    withSync([issue(7)], ({ sync, fake, tickets, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* bootstrapAgain;
        fake.listOmissions.add(7);
        fake.getFailures.set(
          7,
          new IssueProviderError({
            provider: SourceControlProviderKind.make("github"),
            operation: "metadata",
            reason: "failed",
            detail: "Unreadable issue",
            cause: new GitHubIssueCli.GitHubIssueReadError({
              cwd: shell.workspaceRoot,
              operation: "getIssueMetadata",
              detail: "Bad body",
            }),
          }),
        );
        const partial = yield* sync.syncNow(SOURCE);
        assert.strictEqual(partial.lastError, "acme/web#7: Unreadable issue");
        fake.listOmissions.clear();
        fake.edit(7, {
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-09-01T00:00:00Z",
        });
        fake.calls.length = 0;
        const recovered = yield* sync.syncNow(SOURCE);
        assert.strictEqual(recovered.lastError, null);
        assert.deepStrictEqual(fake.calls, []);
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).statusId, "done");
      }),
    ),
  );

  it.effect("shares concurrent manual syncs and keeps repository hosts independent", () =>
    withSync([issue(7)], ({ sync, fake }) =>
      Effect.gen(function* () {
        const projectId = ProjectId.make("second-project");
        fake.projects.set(projectId, { ...shell, id: projectId });
        yield* sync.upsertSource({ ...SOURCE, projectId, repository: "ACME/WEB", enabled: true });
        fake.listGate = yield* Deferred.make<void>();
        fake.listStarted = yield* Deferred.make<void>();
        const gate = fake.listGate;
        const first = yield* sync.syncNow(SOURCE).pipe(Effect.forkChild);
        yield* Deferred.await(fake.listStarted);
        const second = yield* sync
          .syncNow({ ...SOURCE, projectId, repository: "ACME/WEB" })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        const sources = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
        assert.strictEqual(fake.listCalls, 1);
        assert.deepStrictEqual(
          sources.map((source) => source.lastError),
          [null, null],
        );
        yield* sync.upsertSource({ ...SOURCE, host: "github.acme.com", enabled: true });
        yield* sync.syncDue;
        assert.strictEqual(fake.listCalls, 2);
      }),
    ),
  );

  it.effect("a disabled source joining a running sync gets its bootstrap before returning", () =>
    withSync([issue(7)], ({ sync, fake, tickets }) =>
      Effect.gen(function* () {
        const projectId = ProjectId.make("disabled-project");
        fake.projects.set(projectId, { ...shell, id: projectId });
        yield* sync.upsertSource({ ...SOURCE, projectId, enabled: false });
        fake.listGate = yield* Deferred.make<void>();
        fake.listStarted = yield* Deferred.make<void>();
        const gate = fake.listGate;
        const first = yield* sync.syncNow(SOURCE).pipe(Effect.forkChild);
        yield* Deferred.await(fake.listStarted);
        const joined = yield* sync.syncNow({ ...SOURCE, projectId }).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(first);
        const disabled = yield* Fiber.join(joined);
        assert.deepStrictEqual(
          [disabled.enabled, disabled.lastError, fake.listCalls],
          [false, null, 2],
        );
        assert.deepStrictEqual((yield* tickets.resolveRef("acme/web#7")).linkRefs, [
          { kind: "project", targetKey: "disabled-project" },
          { kind: "project", targetKey: "project-web" },
        ]);
      }),
    ),
  );

  it.effect("a repository failure does not stop another repository's due sync", () =>
    withSync([issue(7)], ({ sync, fake, tickets }) =>
      Effect.gen(function* () {
        yield* TestClock.adjust("1 minute");
        yield* sync.upsertSource({ ...SOURCE, repository: "acme/other", enabled: true });
        fake.listFailures.set(
          SOURCE.repository,
          new IssueProviderError({
            provider: SourceControlProviderKind.make("github"),
            operation: "list",
            reason: "failed",
            detail: "Repository unavailable",
          }),
        );
        yield* sync.syncDue;
        assert.strictEqual((yield* tickets.resolveRef("acme/other#7")).title, "Issue 7");
        const sources = (yield* sync.subscribeSources().pipe(Stream.runHead)).pipe(
          Option.getOrThrow,
        );
        assert.deepStrictEqual(
          sources.sources.map(({ repository, lastError }) => [repository, lastError]),
          [
            ["acme/web", "Repository unavailable"],
            ["acme/other", null],
          ],
        );
      }),
    ),
  );

  it.effect("uses the scan start watermark so an update during a long read is replayed", () =>
    withSync([issue(7)], ({ sync, fake, tickets, sql }) =>
      Effect.gen(function* () {
        fake.duringList = Effect.sync(() =>
          fake.edit(7, {
            title: "Changed during scan",
            updatedAt: "2026-09-01T00:02:00Z",
          }),
        ).pipe(Effect.andThen(TestClock.adjust("20 minutes")));
        yield* sync.syncNow(SOURCE);
        const [coverage] = yield* sql<{
          readonly sync_watermark_at: string;
        }>`SELECT sync_watermark_at FROM ticket_github_sources`;
        assert.strictEqual(coverage?.sync_watermark_at, "2026-09-01T00:00:00.000Z");
        fake.duringList = Effect.void;
        yield* sync.syncNow(SOURCE);
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).title, "Changed during scan");
      }),
    ),
  );

  it.effect("replays a failed closed search after restarting the sync service", () =>
    withSync([issue(7), issue(8)], ({ sync, fake, tickets, sql, restartSync }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* TestClock.adjust("20 minutes");
        fake.edit(7, { title: "Changed", updatedAt: "2026-09-01T00:15:00Z" });
        fake.edit(8, {
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-09-01T00:12:00Z",
        });
        fake.closedListFailure = new IssueProviderError({
          provider: SourceControlProviderKind.make("github"),
          operation: "list",
          reason: "failed",
          detail: "Offline",
        });
        const failed = yield* sync.syncNow(SOURCE);
        assert.strictEqual(failed.lastError, "Offline");
        const [coverage] = yield* sql<{
          readonly sync_watermark_at: string;
        }>`SELECT sync_watermark_at FROM ticket_github_sources`;
        assert.strictEqual(coverage?.sync_watermark_at, "2026-09-01T00:00:00.000Z");
        fake.closedListFailure = null;
        yield* TestClock.adjust("20 minutes");
        const restarted = yield* restartSync;
        yield* restarted.syncNow(SOURCE);
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).title, "Changed");
        assert.strictEqual((yield* tickets.resolveRef("acme/web#8")).statusId, "done");
      }),
    ),
  );

  it.effect("queries both states inclusively across the overlap and updates their bodies", () =>
    withSync([issue(7), issue(8)], ({ sync, fake, tickets }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* TestClock.adjust("20 minutes");
        yield* sync.syncNow(SOURCE);
        fake.listInputs.length = 0;
        fake.edit(7, {
          state: "closed",
          stateReason: "not_planned",
          body: "Closed body",
          updatedAt: "2026-09-01T00:10:00Z",
        });
        fake.edit(8, { body: "Updated body", updatedAt: "2026-09-01T00:10:00Z" });
        yield* TestClock.adjust("10 minutes");
        const source = yield* sync.syncNow(SOURCE);
        assert.deepStrictEqual(
          fake.listInputs.map(({ state, updatedSince }) => [state, updatedSince]),
          [
            ["open", "2026-09-01T00:10:00.000Z"],
            ["closed", "2026-09-01T00:10:00.000Z"],
          ],
        );
        const closed = yield* tickets.get((yield* tickets.resolveRef("acme/web#7")).id);
        const open = yield* tickets.get((yield* tickets.resolveRef("acme/web#8")).id);
        assert.deepStrictEqual(
          [closed.summary.statusId, closed.body, open.body, source.issueCount, fake.calls.length],
          ["canceled", "Closed body", "Updated body", 1, 0],
        );
      }),
    ),
  );

  it.effect("keeps incomplete and malformed searches retryable while applying valid updates", () =>
    withSync([issue(7), issue(8)], ({ sync, fake, tickets, sql }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* TestClock.adjust("20 minutes");
        fake.edit(7, { title: "Valid change", updatedAt: "2026-09-01T00:15:00Z" });
        fake.edit(8, {
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-09-01T00:15:00Z",
        });
        for (const kind of ["truncated", "skipped"] as const) {
          fake.listTruncated = kind === "truncated";
          fake.listSkippedCount = kind === "skipped" ? 1 : 0;
          const source = yield* sync.syncNow(SOURCE);
          assert.isNotNull(source.lastError);
          const [coverage] = yield* sql<{
            readonly sync_watermark_at: string;
          }>`SELECT sync_watermark_at FROM ticket_github_sources`;
          assert.strictEqual(coverage?.sync_watermark_at, "2026-09-01T00:00:00.000Z");
          assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).title, "Valid change");
          assert.strictEqual((yield* tickets.resolveRef("acme/web#8")).statusId, "done");
        }
        fake.listSkippedCount = 0;
        const recovered = yield* sync.syncNow(SOURCE);
        assert.strictEqual(recovered.lastError, null);
      }),
    ),
  );

  it.effect("requires a source-control grant only when a ticket operation writes to GitHub", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const ticket = yield* tickets.resolveRef("acme/web#7");
        const denied = <A, E>(effect: Effect.Effect<A, E>) =>
          effect.pipe(Effect.provideService(TicketService.GitHubWriteAccess, false), Effect.flip);
        const close = yield* denied(
          tickets.move(
            { ticketId: ticket.id, expectedRevision: 1, statusId: status("done"), sortKey: "a0" },
            USER,
          ),
        );
        const comment = yield* denied(
          tickets.postUserComment({ ticketId: ticket.id, body: "Denied" }),
        );
        const assign = yield* denied(
          tickets.githubIssueSetAssignees({
            ticketId: ticket.id,
            assignees: ["alice"],
            assigned: true,
          }),
        );
        assert.deepStrictEqual(
          [close, comment, assign].map((error) => error._tag),
          Array(3).fill("EnvironmentAuthorizationError"),
        );
        assert.deepStrictEqual(
          [fake.setStateCalls, fake.commentCalls, [...fake.assignees]],
          [[], [], []],
        );
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).revision, 1);
        const local = (yield* tickets.create({ title: "Local" }, USER)).ticket;
        yield* tickets
          .move(
            { ticketId: local.id, expectedRevision: 1, statusId: status("done"), sortKey: "a1" },
            USER,
          )
          .pipe(Effect.provideService(TicketService.GitHubWriteAccess, false));
        yield* tickets
          .postUserComment({ ticketId: local.id, body: "Local comment" })
          .pipe(Effect.provideService(TicketService.GitHubWriteAccess, false));
        yield* tickets
          .move(
            {
              ticketId: ticket.id,
              expectedRevision: 1,
              statusId: status("in_progress"),
              sortKey: "a0",
            },
            USER,
          )
          .pipe(Effect.provideService(TicketService.GitHubWriteAccess, false));
        const closed = yield* tickets.move(
          { ticketId: ticket.id, expectedRevision: 2, statusId: status("done"), sortKey: "a0" },
          USER,
        );
        const reopen = yield* denied(
          tickets.move(
            {
              ticketId: ticket.id,
              expectedRevision: closed.revision,
              statusId: status("todo"),
              sortKey: "a0",
            },
            USER,
          ),
        );
        assert.strictEqual(reopen._tag, "EnvironmentAuthorizationError");
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).statusId, "done");
        yield* tickets.setHidden({ ticketId: ticket.id, hidden: true });
        yield* tickets
          .move(
            {
              ticketId: ticket.id,
              expectedRevision: closed.revision,
              statusId: status("todo"),
              sortKey: "a0",
            },
            USER,
          )
          .pipe(Effect.provideService(TicketService.GitHubWriteAccess, false));
        assert.deepStrictEqual(fake.setStateCalls, [
          { number: 7, change: { state: "closed", reason: "completed" } },
        ]);
      }),
    ),
  );

  it.effect(
    "bulk sync preserves reserve while individual ticket reads bypass a background pause",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake, quota, rateLimits }) =>
        Effect.gen(function* () {
          const key = {
            provider: SourceControlProviderKind.make("github"),
            host: SOURCE.host,
          } as const;
          yield* sync.syncNow(SOURCE);
          fake.listCalls = 0;
          yield* TestClock.adjust("10 minutes");
          yield* quota.observe(SOURCE.host, {
            "x-ratelimit-resource": "graphql",
            "x-ratelimit-limit": "1000",
            "x-ratelimit-remaining": "99",
            "x-ratelimit-reset": String(Date.parse("2026-09-01T01:00:00.000Z") / 1_000),
          });
          fake.beforeRead = Effect.gen(function* () {
            const allowReserve = yield* SourceControlRateLimit.Interactive;
            yield* quota.admit(SOURCE.host, "graphql", { allowReserve });
          }).pipe(
            Effect.mapError(
              (cause) =>
                new IssueProviderError({
                  provider: SourceControlProviderKind.make("github"),
                  operation: "read",
                  reason: "rate-limited",
                  detail: cause.detail,
                  cause,
                }),
            ),
          );
          yield* sync.syncDue;
          assert.strictEqual(fake.listCalls, 0);
          assert.strictEqual(
            (yield* rateLimits.check(key).pipe(Effect.flip))._tag,
            "SourceControlRateLimitPausedError",
          );
          const synced = yield* sync.syncNow(SOURCE);
          assert.strictEqual(
            synced.lastError,
            "GitHub's request limit was reached. Try again after it resets.",
          );
          assert.strictEqual(fake.listCalls, 0);
          const ticket = yield* tickets.resolveRef("acme/web#7");
          yield* tickets.refreshGitHubIssue({ ticketId: ticket.id });
          yield* tickets.githubIssueDetail({ ticketId: ticket.id });
          const candidates = yield* tickets.issueLinkCandidates({ ticketId: ticket.id });
          assert.strictEqual(candidates.entries[0]?.number, 7);
          assert.deepStrictEqual(candidates.errors, []);
          yield* tickets.githubIssueSetAssignees({
            ticketId: ticket.id,
            assignees: ["alice"],
            assigned: true,
          });
          yield* tickets.postUserComment({ ticketId: ticket.id, body: "Interactive comment" });
          yield* tickets.move(
            {
              ticketId: ticket.id,
              expectedRevision: ticket.revision,
              statusId: status("done"),
              sortKey: "a0",
            },
            USER,
          );
          assert.deepStrictEqual(fake.commentCalls, [{ number: 7, body: "Interactive comment" }]);
          assert.deepStrictEqual(fake.assignees.get(7), ["alice"]);
          assert.deepStrictEqual(fake.setStateCalls, [
            { number: 7, change: { state: "closed", reason: "completed" } },
          ]);
          assert.strictEqual(
            (yield* rateLimits.check(key).pipe(Effect.flip))._tag,
            "SourceControlRateLimitPausedError",
          );
        }),
      ),
  );
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
              provider: SourceControlProviderKind.make("github"),
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
              provider: SourceControlProviderKind.make("github"),
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
                provider: SourceControlProviderKind.make("github"),
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
              provider: SourceControlProviderKind.make("unknown"),
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
          fake.edit(7, { updatedAt: "2026-09-01T00:00:00Z" });
          fake.hostUpdatedAt = "2026-09-01T00:01:00Z";
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
            provider: SourceControlProviderKind.make("github"),
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
    withSync([issue(7)], ({ tickets, sync, fake, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* bootstrapAgain;
        const ticket = yield* tickets.resolveRef("acme/web#7");
        yield* tickets.move(
          { ticketId: ticket.id, expectedRevision: 1, statusId: status("done"), sortKey: "a0" },
          USER,
        );
        fake.getFailure = new IssueProviderError({
          provider: SourceControlProviderKind.make("github"),
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
      ({ tickets, sync, fake, bootstrapAgain }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          yield* bootstrapAgain;
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
          assert.strictEqual((yield* tickets.resolveRef("T-1", PROJECT)).id, ticket.id);
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
        fake.edit(7, { title: "Renamed", labels: ["p1"], updatedAt: "2026-09-01T01:00:00Z" });
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
          const later = "2026-09-01T00:00:00Z";
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
            updatedAt: "2026-09-01T00:01:00Z",
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
        fake.edit(7, { title: "Renamed", updatedAt: "2026-09-01T00:00:00Z" });
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
          provider: SourceControlProviderKind.make("github"),
          operation: "list",
          reason: "unauthenticated",
          detail: "GitHub CLI is not authenticated.",
        });
        const source = yield* sync.syncNow(SOURCE);

        assert.deepStrictEqual(
          [source.lastError, source.lastSyncedAt],
          [
            "GitHub is not signed in on this environment. Connect an account or save a token in Settings → Source Control.",
            null,
          ],
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
            provider: SourceControlProviderKind.make("github"),
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
            provider: SourceControlProviderKind.make("github"),
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
        fake.hostUpdatedAt = "2026-09-01T00:01:00Z";
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
          const whileRemoved = yield* Effect.forEach(["acme/web#7", "acme/web#8"], (ref) =>
            tickets.resolveRef(ref),
          );
          yield* sync.upsertSource({ ...SOURCE, enabled: true });
          const readded = yield* Effect.forEach(["acme/web#7", "acme/web#8"], (ref) =>
            tickets.resolveRef(ref),
          );

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
          provider: SourceControlProviderKind.make("github"),
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

  it.effect("an unreadable unlisted issue does not block the next closure", () =>
    withSync([issue(7), issue(8), issue(9)], ({ tickets, sync, fake, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* bootstrapAgain;
        for (const number of [7, 8])
          fake.edit(number, {
            state: "closed",
            stateReason: "completed",
            updatedAt: "2026-08-05T00:00:00Z",
          });
        fake.edit(8, { title: "Closed issue", body: "Closure body", labels: ["fixed"] });
        fake.assignees.set(8, ["hubot"]);
        fake.getFailures.set(
          7,
          new IssueProviderError({
            provider: SourceControlProviderKind.make("github"),
            operation: "detail",
            reason: "failed",
            detail: "GitHub could not complete the issue request.",
            cause: new GitHubIssueCli.GitHubIssueReadError({
              cwd: shell.workspaceRoot,
              operation: "getIssue",
              detail: "GitHub returned an issue URL outside the selected repository.",
            }),
          }),
        );
        yield* TestClock.adjust("1 minute");
        const partial = yield* sync.syncNow(SOURCE);
        assert.deepStrictEqual(
          [
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            (yield* tickets.resolveRef("acme/web#8")).statusId,
          ],
          ["todo", "done"],
        );
        const closed = yield* tickets.get((yield* tickets.resolveRef("acme/web#8")).id);
        assert.deepStrictEqual(
          [
            partial.issueCount,
            closed.summary.title,
            closed.body,
            closed.summary.labels,
            githubOf(closed.summary)?.github.assignees,
          ],
          [1, "Closed issue", "Closure body", ["fixed"], ["hubot"]],
        );
        assert.strictEqual(partial.lastSyncedAt, "2026-09-01T00:01:00.000Z");
        assert.strictEqual(
          partial.lastError,
          "acme/web#7: GitHub could not complete the issue request.",
        );
        fake.getFailures.clear();
        const recovered = yield* sync.syncNow(SOURCE);
        assert.strictEqual((yield* tickets.resolveRef("acme/web#7")).statusId, "done");
        assert.strictEqual(recovered.lastError, null);
      }),
    ),
  );

  it.effect("skipped reads advance the capped rotation to later closures", () =>
    withSync(
      Array.from({ length: 51 }, (_, index) => issue(index + 1)),
      ({ tickets, sync, fake, bootstrapAgain, restartSync }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          yield* bootstrapAgain;
          for (const number of fake.issues.keys()) {
            fake.edit(number, { state: "closed", stateReason: "completed" });
            fake.getFailures.set(
              number,
              new IssueProviderError({
                provider: SourceControlProviderKind.make("github"),
                operation: "metadata",
                reason: "failed",
                detail: "GitHub could not complete the issue request.",
                cause: new GitHubIssueCli.GitHubIssueReadError({
                  cwd: shell.workspaceRoot,
                  operation: "getIssueMetadata",
                  detail: "GitHub returned unreadable issue details.",
                }),
              }),
            );
          }
          fake.calls.length = 0;
          const first = yield* sync.syncNow(SOURCE);
          assert.deepStrictEqual(
            fake.calls.map(({ number }) => number),
            Array.from({ length: 50 }, (_, index) => index + 1),
          );
          assert.strictEqual(
            first.lastError,
            "acme/web#1: GitHub could not complete the issue request. (49 more issue reads failed.)",
          );
          assert.strictEqual((yield* tickets.resolveRef("acme/web#51")).statusId, "todo");
          fake.getFailures.delete(51);
          fake.calls.length = 0;
          const restarted = yield* restartSync;
          yield* restarted.syncNow(SOURCE);
          assert.deepStrictEqual(
            fake.calls.map(({ number }) => number),
            [51, ...Array.from({ length: 49 }, (_, index) => index + 1)],
          );
          assert.strictEqual((yield* tickets.resolveRef("acme/web#51")).statusId, "done");
        }),
    ),
  );

  it.effect("an oversized GraphQL issue response skips only that issue", () =>
    withSync([issue(7), issue(8)], ({ tickets, sync, fake, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* bootstrapAgain;
        for (const number of [7, 8])
          fake.edit(number, { state: "closed", stateReason: "completed" });
        fake.getFailures.set(
          7,
          new IssueProviderError({
            provider: SourceControlProviderKind.make("github"),
            operation: "metadata",
            reason: "failed",
            detail: "GitHub could not complete the issue request.",
            cause: new GitHubApi.GitHubApiResponseError({
              host: SOURCE.host,
              operation: "getIssueMetadata",
              status: 200,
            }),
          }),
        );
        const partial = yield* sync.syncNow(SOURCE);
        assert.deepStrictEqual(
          [
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            (yield* tickets.resolveRef("acme/web#8")).statusId,
            partial.issueCount,
            partial.lastError,
          ],
          ["todo", "done", 0, "acme/web#7: GitHub could not complete the issue request."],
        );
      }),
    ),
  );

  it.effect("source-wide failures stop closure reads and keep the previous sync timestamp", () =>
    withSync([issue(7), issue(8)], ({ tickets, sync, fake, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* bootstrapAgain;
        for (const number of [7, 8])
          fake.edit(number, { state: "closed", stateReason: "completed" });
        const failures = [
          new IssueProviderError({
            provider: SourceControlProviderKind.make("github"),
            operation: "metadata",
            reason: "unauthenticated",
            detail: "Authentication failed.",
            cause: new GitHubApi.GitHubApiAuthenticationError({
              host: SOURCE.host,
              operation: "getIssueMetadata",
            }),
          }),
          new IssueProviderError({
            provider: SourceControlProviderKind.make("github"),
            operation: "metadata",
            reason: "rate-limited",
            detail: "Rate limit exceeded.",
            cause: new GitHubApi.GitHubApiRateLimitError({
              host: SOURCE.host,
              operation: "getIssueMetadata",
            }),
          }),
          ...[
            new GitHubCredentials.GitHubCliFailedError({
              host: SOURCE.host,
              cause: new Error("credential unavailable"),
            }),
            new GitHubApi.GitHubApiRequestError({
              host: SOURCE.host,
              operation: "getIssueMetadata",
              cause: new Error("offline"),
            }),
            new GitHubApi.GitHubApiResponseError({
              host: SOURCE.host,
              operation: "getIssueMetadata",
              status: 503,
            }),
            new GitHubApi.GitHubApiResponseError({
              host: SOURCE.host,
              operation: "getIssueMetadata",
              status: 200,
              githubErrors: ["Unavailable"],
            }),
            new Error("Unknown provider failure"),
          ].map(
            (cause) =>
              new IssueProviderError({
                provider: SourceControlProviderKind.make("github"),
                operation: "metadata",
                reason: "failed",
                detail: "GitHub could not complete the issue request.",
                cause,
              }),
          ),
        ];
        for (const failure of failures) {
          fake.getFailures.set(7, failure);
          fake.calls.length = 0;
          yield* TestClock.adjust("1 minute");
          const failed = yield* sync.syncNow(SOURCE);
          assert.deepStrictEqual(
            fake.calls.map(({ number }) => number),
            [7],
          );
          assert.deepStrictEqual(
            [
              failed.lastSyncedAt,
              failed.issueCount,
              (yield* tickets.resolveRef("acme/web#7")).statusId,
              (yield* tickets.resolveRef("acme/web#8")).statusId,
            ],
            ["2026-09-01T00:00:00.000Z", 2, "todo", "todo"],
          );
          assert.strictEqual(failed.lastError, TicketGitHub.describeGitHubFailure(failure));
        }
      }),
    ),
  );

  it.effect("a failed issue read retries, while a confirmed missing issue stops being polled", () =>
    withSync([issue(7), issue(8)], ({ tickets, sync, fake, sql, bootstrapAgain, restartSync }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        yield* bootstrapAgain;
        fake.edit(7, {
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-08-05T00:00:00Z",
        });
        fake.issues.delete(8);
        fake.getFailure = new IssueProviderError({
          provider: SourceControlProviderKind.make("github"),
          operation: "detail",
          reason: "failed",
          detail: "GitHub could not complete the issue request.",
        });
        const failed = yield* sync.syncNow(SOURCE);
        assert.strictEqual(githubOf(yield* tickets.resolveRef("acme/web#8"))?.github.state, "open");
        fake.getFailure = null;
        const recovered = yield* sync.syncNow(SOURCE);

        assert.deepStrictEqual(
          [failed.lastError, recovered.lastError],
          ["GitHub could not complete the issue request.", null],
        );
        const missing = yield* tickets.resolveRef("acme/web#8");
        assert.strictEqual(missing.statusId, "canceled");
        assert.deepStrictEqual(
          [
            (yield* tickets.resolveRef("acme/web#7")).statusId,
            githubOf(missing)?.github.state,
            githubOf(missing)?.github.stateReason,
            githubOf(missing)?.hiddenAt,
          ],
          ["done", "closed", "missing", null],
        );
        assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), []);
        assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
        fake.calls.length = 0;
        yield* sync.syncNow(SOURCE);
        assert.deepStrictEqual(fake.calls, []);
        const restarted = yield* restartSync;
        yield* bootstrapAgain;
        yield* restarted.syncNow(SOURCE);
        assert.deepStrictEqual(fake.calls, []);
      }),
    ),
  );

  it.effect(
    "manual refresh records missing without losing cached content and recovers at the same host timestamp",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const before = yield* tickets.get((yield* tickets.resolveRef("acme/web#7")).id);
          fake.issues.delete(7);
          const missing = yield* tickets.refreshGitHubIssue({ ticketId: before.summary.id });
          const stored = yield* tickets.get(missing.id);
          assert.deepStrictEqual(
            [
              missing.statusId,
              githubOf(missing)?.github.state,
              githubOf(missing)?.github.stateReason,
              githubOf(missing)?.hiddenAt,
              missing.title,
              stored.body,
              missing.labels,
              missing.linkRefs,
              githubOf(missing)?.github.updatedAt,
            ],
            [
              "canceled",
              "closed",
              "missing",
              null,
              before.summary.title,
              before.body,
              before.summary.labels,
              before.summary.linkRefs,
              githubOf(before.summary)?.github.updatedAt,
            ],
          );
          assert.strictEqual(githubOf(missing)?.github.stateNeedsConfirmation, false);
          assert.deepStrictEqual(fake.listInputs.at(-1), {
            cwd: "/work/web",
            host: "github.com",
            repository: "acme/web",
            state: "open",
            limit: 1,
            includeOpenCount: true,
          });
          fake.issues.set(7, issue(7));
          const recovered = yield* tickets.refreshGitHubIssue({ ticketId: missing.id });
          assert.deepStrictEqual(
            [
              recovered.statusId,
              githubOf(recovered)?.github.state,
              githubOf(recovered)?.github.stateReason,
              githubOf(recovered)?.github.updatedAt,
            ],
            ["todo", "open", null, githubOf(before.summary)?.github.updatedAt],
          );
          assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), [7]);
        }),
      ),
  );

  it.effect("stale search cannot reopen a missing issue but still links a new source project", () =>
    withSync([{ ...issue(7), updatedAt: "2026-09-01T00:00:00Z" }], ({ tickets, sync, fake, sql }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const before = yield* tickets.resolveRef("acme/web#7");
        fake.staleList = [...fake.issues.values()];
        fake.issues.delete(7);
        yield* tickets.refreshGitHubIssue({ ticketId: before.id });
        fake.calls.length = 0;
        yield* sync.syncNow(SOURCE);
        const afterStaleSearch = yield* tickets.resolveRef("acme/web#7");
        assert.deepStrictEqual(
          [afterStaleSearch.statusId, githubOf(afterStaleSearch)?.github.stateReason],
          ["canceled", "missing"],
        );
        assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), []);
        assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
        assert.deepStrictEqual(fake.calls, []);
        const projectId = ProjectId.make("second-project");
        fake.projects.set(projectId, { ...shell, id: projectId });
        yield* sync.upsertSource({ ...SOURCE, projectId, enabled: true });
        yield* sync.syncNow({ ...SOURCE, projectId });
        const missing = yield* tickets.resolveRef("acme/web#7");
        assert.strictEqual(githubOf(missing)?.github.stateReason, "missing");
        assert.deepStrictEqual(missing.linkRefs, [
          { kind: "project", targetKey: "project-web" },
          { kind: "project", targetKey: "second-project" },
        ]);
        fake.issues.set(7, { ...issue(7), updatedAt: "2026-09-01T00:00:00Z" });
        const recovered = yield* tickets.refreshGitHubIssue({ ticketId: missing.id });
        assert.deepStrictEqual(
          [recovered.statusId, githubOf(recovered)?.github.stateReason],
          ["todo", null],
        );
        assert.deepStrictEqual(recovered.linkRefs, missing.linkRefs);
        assert.strictEqual(githubOf(recovered)?.github.updatedAt, "2026-09-01T00:00:00Z");
      }),
    ),
  );

  it.effect(
    "an issue read and its access proof keep the same credential through an account change",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake, sql, bootstrapAgain }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          yield* bootstrapAgain;
          fake.listOmissions.add(7);
          fake.deniedCredentials.add("initial");
          fake.duringGet = Effect.sync(() => {
            fake.selectedCredential = "replacement";
          });
          const failed = yield* sync.syncNow(SOURCE);
          assert.isNotNull(failed.lastError);
          assert.deepStrictEqual(fake.issueCredentialFingerprints, ["initial"]);
          assert.deepStrictEqual(fake.probeCredentialFingerprints, ["initial"]);
          const healthy = yield* tickets.resolveRef("acme/web#7");
          assert.deepStrictEqual(
            [healthy.statusId, githubOf(healthy)?.github.stateReason],
            ["todo", null],
          );
          assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), [7]);
          assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, [
            { number: 7 },
          ]);
          fake.duringGet = Effect.void;
          const recovered = yield* sync.syncNow(SOURCE);
          assert.strictEqual(recovered.lastError, null);
          assert.deepStrictEqual(fake.issueCredentialFingerprints, ["initial", "replacement"]);
          assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
        }),
      ),
  );

  it.effect.each(["denied", "no-count"] as const)(
    "a fresh issue-access proof that is %s keeps tickets open and pending",
    (failure) =>
      withSync([issue(7), issue(8)], ({ tickets, sync, fake, sql, bootstrapAgain }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          yield* bootstrapAgain;
          fake.issues.clear();
          if (failure === "denied")
            fake.probeFailure = new IssueProviderError({
              provider: SourceControlProviderKind.make("github"),
              operation: "list",
              reason: "unauthenticated",
              detail: "GitHub issues access was lost.",
            });
          else fake.probeWithoutCount = true;
          const failed = yield* sync.syncNow(SOURCE);
          assert.isNotNull(failed.lastError);
          assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), [7, 8]);
          assert.deepStrictEqual(
            yield* sql`SELECT number FROM ticket_github_sync_pending ORDER BY number`,
            [{ number: 7 }, { number: 8 }],
          );
          assert.deepStrictEqual(fake.listInputs.at(-1), {
            cwd: "/work/web",
            host: "github.com",
            repository: "acme/web",
            state: "open",
            limit: 1,
            includeOpenCount: true,
          });
          fake.probeFailure = null;
          fake.probeWithoutCount = false;
          const recovered = yield* sync.syncNow(SOURCE);
          assert.strictEqual(recovered.lastError, null);
          assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), []);
          assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
        }),
      ),
  );

  it.effect("confirmed missing issues use at most fifty metadata reads per cycle", () =>
    withSync(
      Array.from({ length: 51 }, (_, index) => issue(index + 1)),
      ({ tickets, sync, fake, sql, bootstrapAgain }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          yield* bootstrapAgain;
          fake.issues.clear();
          fake.calls.length = 0;
          yield* sync.syncNow(SOURCE);
          assert.strictEqual(fake.calls.length, 50);
          assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), [51]);
          assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, [
            { number: 51 },
          ]);
          fake.calls.length = 0;
          yield* sync.syncNow(SOURCE);
          assert.deepStrictEqual(
            fake.calls.map(({ number }) => number),
            [51],
          );
          assert.deepStrictEqual(yield* tickets.openGitHubIssueNumbers(SOURCE), []);
        }),
    ),
  );

  it.effect.each(["hidden", "deleted"] as const)(
    "a missing read cannot overwrite a ticket that was %s during the request",
    (change) =>
      withSync([issue(7)], ({ tickets, sync, fake, sql, bootstrapAgain }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const before = yield* tickets.resolveRef("acme/web#7");
          yield* bootstrapAgain;
          fake.issues.delete(7);
          fake.duringGet =
            change === "hidden"
              ? tickets
                  .setHidden({ ticketId: before.id, hidden: true })
                  .pipe(Effect.asVoid, Effect.orDie)
              : tickets.releaseGitHubRepository({ ...SOURCE, deleteCache: true });
          yield* sync.syncNow(SOURCE);
          if (change === "hidden") {
            const hidden = yield* tickets.resolveRef("acme/web#7");
            assert.isNotNull(githubOf(hidden)?.hiddenAt);
            assert.deepStrictEqual(
              [githubOf(hidden)?.github.state, githubOf(hidden)?.github.stateReason],
              ["open", null],
            );
          } else
            assert.strictEqual(
              (yield* tickets.resolveRef("acme/web#7").pipe(Effect.flip))._tag,
              "TicketNotFoundError",
            );
          assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
        }),
      ),
  );

  it.effect("an identical successful refresh supersedes an in-flight missing read", () =>
    withSync([issue(7)], ({ tickets, sync, fake, sql, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const before = yield* tickets.get((yield* tickets.resolveRef("acme/web#7")).id);
        yield* bootstrapAgain;
        fake.issues.delete(7);
        fake.duringGet = Effect.suspend(() => {
          fake.duringGet = Effect.void;
          fake.issues.set(7, issue(7));
          return tickets
            .refreshGitHubIssue({ ticketId: before.summary.id })
            .pipe(Effect.asVoid, Effect.orDie);
        });
        yield* sync.syncNow(SOURCE);
        const fresh = yield* tickets.get(before.summary.id);
        assert.deepStrictEqual(
          [fresh.summary.statusId, githubOf(fresh.summary)?.github.stateReason],
          ["todo", null],
        );
        assert.strictEqual(fresh.summary.revision, before.summary.revision);
        assert.deepStrictEqual(fresh.activity, before.activity);
        assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, [
          { number: 7 },
        ]);
        yield* sync.syncNow(SOURCE);
        assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
      }),
    ),
  );

  it.effect("a user move supersedes a missing read and retries without discarding it", () =>
    withSync([issue(7)], ({ tickets, sync, fake, sql, bootstrapAgain }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const before = yield* tickets.resolveRef("acme/web#7");
        yield* bootstrapAgain;
        fake.issues.delete(7);
        fake.duringGet = tickets
          .move(
            {
              ticketId: before.id,
              expectedRevision: before.revision,
              statusId: status("in_progress"),
              sortKey: "a0",
            },
            USER,
          )
          .pipe(Effect.asVoid, Effect.orDie);
        yield* sync.syncNow(SOURCE);
        const moved = yield* tickets.resolveRef("acme/web#7");
        assert.deepStrictEqual(
          [moved.statusId, githubOf(moved)?.github.stateReason],
          ["in_progress", null],
        );
        assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, [
          { number: 7 },
        ]);
        fake.duringGet = Effect.void;
        yield* sync.syncNow(SOURCE);
        const missing = yield* tickets.resolveRef("acme/web#7");
        assert.deepStrictEqual(
          [missing.statusId, githubOf(missing)?.github.stateReason],
          ["canceled", "missing"],
        );
        assert.deepStrictEqual(yield* sql`SELECT number FROM ticket_github_sync_pending`, []);
      }),
    ),
  );

  it.effect("a manual missing refresh with lost issue access leaves the ticket unchanged", () =>
    withSync([issue(7)], ({ tickets, sync, fake }) =>
      Effect.gen(function* () {
        yield* sync.syncNow(SOURCE);
        const before = yield* tickets.get((yield* tickets.resolveRef("acme/web#7")).id);
        fake.issues.delete(7);
        fake.probeFailure = new IssueProviderError({
          provider: SourceControlProviderKind.make("github"),
          operation: "list",
          reason: "unauthenticated",
          detail: "Access lost",
        });
        const failed = yield* tickets
          .refreshGitHubIssue({ ticketId: before.summary.id })
          .pipe(Effect.flip);
        assert.strictEqual(failed._tag, "TicketError");
        assert.deepStrictEqual(yield* tickets.get(before.summary.id), before);
      }),
    ),
  );

  it.effect(
    "a missing already-closed issue records availability without misleading state activity",
    () =>
      withSync([issue(7)], ({ tickets, sync, fake }) =>
        Effect.gen(function* () {
          yield* sync.syncNow(SOURCE);
          const before = yield* tickets.resolveRef("acme/web#7");
          fake.edit(7, { state: "closed", stateReason: "completed" });
          yield* tickets.refreshGitHubIssue({ ticketId: before.id });
          fake.issues.delete(7);
          const missing = yield* tickets.refreshGitHubIssue({ ticketId: before.id });
          const detail = yield* tickets.get(before.id);
          assert.deepStrictEqual(
            [missing.statusId, githubOf(missing)?.github.stateReason],
            ["done", "missing"],
          );
          assert.deepStrictEqual(detail.activity.at(-1)?.entry, {
            type: "synced",
            changes: ["availability"],
          });
        }),
      ),
  );
});
