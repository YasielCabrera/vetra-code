import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type {
  IssueActivity,
  IssueAssigneeCandidateList,
  IssueAssigneeChangeInput,
  IssueDetail,
  IssueInvalidateInput,
  IssueListEntry,
  IssueListInput,
  IssueListResult,
  IssueProviderSummary,
  IssueRef,
  OrchestrationProjectShell,
  SourceControlProviderInfo,
  SourceControlProviderKind,
} from "@vetra-code/contracts";
import {
  IssueOperationError,
  IssueUnavailableError,
  sourceControlHostOf,
} from "@vetra-code/contracts";
import { detectSourceControlProviderFromRemoteUrl } from "@vetra-code/shared/sourceControl";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import { IssueProviderError, type IssueProviderApi } from "./IssueProvider.ts";
import { IssueProviderRegistry } from "./IssueProviderRegistry.ts";

const DEFAULT_REPOSITORY_LIMIT = 99;
const REPOSITORY_CONCURRENCY = 12;
const LIST_CACHE_TTL = Duration.seconds(30);
const DETAIL_CACHE_TTL = Duration.seconds(15);

export type IssueError = IssueUnavailableError | IssueOperationError;

export class IssueService extends Context.Service<
  IssueService,
  {
    readonly list: (input: IssueListInput) => Effect.Effect<IssueListResult, IssueError>;
    readonly detail: (input: IssueRef) => Effect.Effect<IssueDetail, IssueError>;
    readonly activity: (input: IssueRef) => Effect.Effect<IssueActivity, IssueError>;
    readonly assigneeCandidates: (
      input: IssueRef,
    ) => Effect.Effect<IssueAssigneeCandidateList, IssueError>;
    readonly setAssignees: (input: IssueAssigneeChangeInput) => Effect.Effect<void, IssueError>;
    readonly invalidate: (input: IssueInvalidateInput) => Effect.Effect<void>;
  }
>()("@vetra-code/server/issue/IssueService") {}

interface SupportedProject {
  readonly project: OrchestrationProjectShell;
  readonly api: IssueProviderApi;
  readonly kind: SourceControlProviderKind;
  readonly host: string;
  readonly repository: string;
  readonly links: { readonly repositoryUrl: string; readonly newIssueUrl: string };
}

interface WorkspaceProjects {
  readonly supported: ReadonlyArray<SupportedProject>;
  readonly unsupported: ReadonlyMap<
    string,
    { readonly kind: SourceControlProviderKind; readonly projectCount: number }
  >;
  readonly invalid: ReadonlyArray<{
    readonly projectId: OrchestrationProjectShell["id"];
    readonly projectTitle: string;
    readonly message: string;
  }>;
}

interface ListCursor {
  readonly updatedBefore: string;
  readonly delivered: number;
  readonly seenAt: ReadonlyArray<number>;
}

const LIST_CURSOR_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))\|(\d{1,9})\|(\d{1,9}(?:,\d{1,9})*)?$/;

function parseListCursor(raw: string): ListCursor | null {
  const match = LIST_CURSOR_PATTERN.exec(raw);
  if (match === null) return null;
  return {
    updatedBefore: match[1]!,
    delivered: Number(match[2]),
    seenAt: match[3] === undefined ? [] : match[3].split(",").map(Number),
  };
}

function listCursorKey(host: string, repository: string): string {
  return `${host} ${repository.toLowerCase()}`;
}

function nextListCursor(
  previous: ListCursor | undefined,
  delivered: ReadonlyArray<{ readonly number: number; readonly updatedAt: string }>,
): string | null {
  if (delivered.length === 0) return null;
  const oldest = delivered.reduce((left, right) =>
    right.updatedAt < left.updatedAt ? right : left,
  );
  const seenAt = [
    ...(previous?.updatedBefore === oldest.updatedAt ? previous.seenAt : []),
    ...delivered
      .filter((issue) => issue.updatedAt === oldest.updatedAt)
      .map((issue) => issue.number),
  ];
  return `${oldest.updatedAt}|${(previous?.delivered ?? 0) + delivered.length}|${seenAt.join(",")}`;
}

function repositoryIdentityOf(project: OrchestrationProjectShell): string | null {
  const identity = project.repositoryIdentity;
  if (!identity) return null;
  if (identity.provider === "azure-devops") {
    const segments = (identity.displayName ?? "").split("/").filter((part) => part !== "_git");
    return identity.name || segments.at(-1) || null;
  }
  if (identity.displayName) return identity.displayName;
  return identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null;
}

function hostOf(project: OrchestrationProjectShell, kind: SourceControlProviderKind): string {
  const identity = project.repositoryIdentity;
  const canonical = sourceControlHostOf(identity, kind);
  if (canonical !== kind) return canonical;
  const detected = identity
    ? detectSourceControlProviderFromRemoteUrl(identity.locator.remoteUrl)
    : null;
  if (detected !== null) {
    try {
      return new URL(detected.baseUrl).host.toLowerCase();
    } catch {
      // Fall through to the stable kind bucket used by older repository identities.
    }
  }
  return canonical;
}

function providerKindOf(value: string | undefined): SourceControlProviderKind {
  return value === "github" ||
    value === "gitlab" ||
    value === "azure-devops" ||
    value === "bitbucket"
    ? value
    : "unknown";
}

function serviceError(operation: string) {
  return (error: IssueProviderError): IssueError => {
    if (error.reason === "missing-tool") {
      return new IssueUnavailableError({
        reason: "cli-missing",
        provider: error.provider,
        cause: error,
      });
    }
    if (error.reason === "unauthenticated") {
      return new IssueUnavailableError({
        reason: "cli-unauthenticated",
        provider: error.provider,
        cause: error,
      });
    }
    return new IssueOperationError({
      operation,
      detail:
        error.reason === "rate-limited"
          ? "The source-control host is rate-limited. Try again after its quota resets."
          : error.detail,
      cause: error,
    });
  };
}

function providerSummaryDetail(error: IssueProviderError): string {
  switch (error.reason) {
    case "missing-tool":
      return "GitHub CLI (`gh`) is not installed on this environment.";
    case "unauthenticated":
      return "GitHub CLI is not authenticated on this environment.";
    case "rate-limited":
      return "GitHub's request limit has been reached. Try again after it resets.";
    case "failed":
      return "This host could not be read right now.";
  }
}

export const make = Effect.gen(function* () {
  const registry = yield* IssueProviderRegistry;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const sourceControlProviders = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const rateLimits = yield* SourceControlRateLimit.SourceControlRateLimit;

  const refineUnknownProjectKinds = (
    projects: ReadonlyArray<OrchestrationProjectShell>,
    filter: Pick<IssueListInput, "projectId" | "projectIds" | "host">,
  ) => {
    interface Candidate {
      readonly project: OrchestrationProjectShell;
      readonly provider: SourceControlProviderInfo;
      readonly remoteName: string;
      readonly remoteUrl: string;
    }
    const candidatesByHost = new Map<string, Candidate[]>();
    for (const project of projects) {
      if (filter.projectId !== undefined && project.id !== filter.projectId) continue;
      if (filter.projectIds !== undefined && !filter.projectIds.includes(project.id)) continue;
      const identity = project.repositoryIdentity;
      if (!identity || providerKindOf(identity.provider) !== "unknown") continue;
      const host = hostOf(project, "unknown");
      if (filter.host !== undefined && host !== "unknown" && host !== filter.host.toLowerCase()) {
        continue;
      }
      const provider = detectSourceControlProviderFromRemoteUrl(identity.locator.remoteUrl);
      if (provider === null) continue;
      const candidate = {
        project,
        provider,
        remoteName: identity.locator.remoteName,
        remoteUrl: identity.locator.remoteUrl,
      };
      const held = candidatesByHost.get(provider.baseUrl);
      if (held === undefined) candidatesByHost.set(provider.baseUrl, [candidate]);
      else held.push(candidate);
    }

    return Effect.forEach(
      candidatesByHost,
      ([baseUrl, candidates]) =>
        Effect.firstSuccessOf(
          candidates.map(({ project, provider, remoteName, remoteUrl }) =>
            Effect.suspend(() =>
              sourceControlProviders.resolveHandle({
                cwd: project.workspaceRoot,
                context: { provider, remoteName, remoteUrl },
              }),
            ).pipe(
              Effect.flatMap((handle) => {
                const kind = providerKindOf(handle.context?.provider.kind);
                return kind === "unknown" ? Effect.fail(undefined) : Effect.succeed(kind);
              }),
            ),
          ),
        ).pipe(
          Effect.map((kind) => [baseUrl, kind] as const),
          Effect.orElseSucceed(() => [baseUrl, "unknown" as const] as const),
        ),
      { concurrency: REPOSITORY_CONCURRENCY },
    ).pipe(Effect.map((resolved) => new Map(resolved)));
  };

  const runProvider = <A>(
    project: SupportedProject,
    effect: Effect.Effect<A, IssueProviderError>,
  ): Effect.Effect<A, IssueProviderError> =>
    rateLimits.check({ provider: project.kind, host: project.host }).pipe(
      Effect.mapError(
        (error) =>
          new IssueProviderError({
            provider: project.kind,
            operation: "rateLimit",
            reason: "rate-limited",
            detail: error.detail,
            cause: error,
          }),
      ),
      Effect.flatMap((lease) =>
        effect.pipe(
          Effect.tap(() =>
            rateLimits.recordSuccess({
              provider: project.kind,
              host: project.host,
              lease,
            }),
          ),
          Effect.tapError((error) =>
            error.reason === "rate-limited"
              ? rateLimits.recordRateLimit({
                  provider: project.kind,
                  host: project.host,
                  lease,
                })
              : Effect.void,
          ),
        ),
      ),
    );

  const listWorkspaceProjects = (
    filter: Pick<IssueListInput, "projectId" | "projectIds" | "host">,
  ): Effect.Effect<WorkspaceProjects, IssueError> =>
    projections.getShellSnapshot().pipe(
      Effect.mapError(
        (error) =>
          new IssueOperationError({
            operation: "listProjects",
            detail: "The project list could not be read.",
            cause: error,
          }),
      ),
      Effect.flatMap((snapshot) =>
        refineUnknownProjectKinds(snapshot.projects, filter).pipe(
          Effect.map((refinedKinds) => ({ refinedKinds, snapshot })),
        ),
      ),
      Effect.map(({ refinedKinds, snapshot }) => {
        const supported: SupportedProject[] = [];
        const unsupported = new Map<
          string,
          { kind: SourceControlProviderKind; projectCount: number }
        >();
        const invalid: WorkspaceProjects["invalid"][number][] = [];
        const seen = new Set<string>();
        for (const project of snapshot.projects) {
          if (filter.projectId !== undefined && project.id !== filter.projectId) continue;
          if (filter.projectIds !== undefined && !filter.projectIds.includes(project.id)) continue;
          const identity = project.repositoryIdentity;
          const repository = repositoryIdentityOf(project);
          if (!identity || repository === null) continue;
          const recordedKind = providerKindOf(identity.provider);
          const detected =
            recordedKind === "unknown"
              ? detectSourceControlProviderFromRemoteUrl(identity.locator.remoteUrl)
              : null;
          const kind: SourceControlProviderKind =
            detected === null
              ? recordedKind
              : (refinedKinds.get(detected.baseUrl) ?? detected.kind);
          const host = hostOf(project, kind);
          if (filter.host !== undefined && host !== filter.host.toLowerCase()) continue;
          const key = `${host}\0${repository.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const api = registry.get(kind);
          if (api === null) {
            const current = unsupported.get(host);
            if (current === undefined) unsupported.set(host, { kind, projectCount: 1 });
            else current.projectCount += 1;
            continue;
          }
          const links = api.repositoryLinks({ host, repository });
          if (links === null) {
            invalid.push({
              projectId: project.id,
              projectTitle: project.title,
              message: "The repository identity is not valid for this host.",
            });
            continue;
          }
          supported.push({ project, api, kind, host, repository, links });
        }
        return { supported, unsupported, invalid };
      }),
    );

  const requireProject = (ref: IssueRef): Effect.Effect<SupportedProject, IssueError> =>
    listWorkspaceProjects({ projectId: ref.projectId }).pipe(
      Effect.flatMap(({ supported }): Effect.Effect<SupportedProject, IssueError> => {
        const project = supported[0];
        if (project === undefined) {
          return Effect.fail(new IssueUnavailableError({ reason: "provider-unsupported" }));
        }
        if (project.repository.toLowerCase() !== ref.repository.trim().toLowerCase()) {
          return Effect.fail(
            new IssueOperationError({
              operation: "resolveRepository",
              detail: "The issue does not belong to the selected project.",
            }),
          );
        }
        return Effect.succeed(project);
      }),
    );

  const decodeCursors = (
    cursors: IssueListInput["cursors"],
  ): Effect.Effect<ReadonlyMap<string, ListCursor> | null, IssueError> => {
    if (cursors === undefined) return Effect.succeed(null);
    const decoded = new Map<string, ListCursor>();
    for (const [key, raw] of Object.entries(cursors)) {
      const cursor = parseListCursor(raw);
      if (cursor === null) {
        return Effect.fail(
          new IssueOperationError({
            operation: "list",
            detail: "The issue list could not be carried on from where it left off.",
          }),
        );
      }
      decoded.set(key, cursor);
    }
    return Effect.succeed(decoded);
  };

  const listUncached: IssueService["Service"]["list"] = (input) =>
    Effect.gen(function* () {
      const continuation = yield* decodeCursors(input.cursors);
      const workspace = yield* listWorkspaceProjects(input);
      const limit = input.limit ?? DEFAULT_REPOSITORY_LIMIT;
      const selected =
        continuation === null
          ? workspace.supported
          : workspace.supported.filter(({ host, repository }) =>
              continuation.has(listCursorKey(host, repository)),
            );
      const cursorOf = (project: SupportedProject): ListCursor | undefined =>
        continuation?.get(listCursorKey(project.host, project.repository));
      const reads = yield* Effect.forEach(
        selected,
        (project) => {
          const cursor = cursorOf(project);
          return runProvider(
            project,
            project.api.listIssues({
              cwd: project.project.workspaceRoot,
              host: project.host,
              repository: project.repository,
              state: input.state,
              limit,
              ...(input.query === undefined ? {} : { query: input.query }),
              ...(cursor === undefined
                ? {}
                : { cursor: { updatedBefore: cursor.updatedBefore, seenAt: cursor.seenAt } }),
            }),
          ).pipe(
            Effect.match({
              onFailure: (error) => ({ project, cursor, error, batch: null }),
              onSuccess: (batch) => ({ project, cursor, error: null, batch }),
            }),
          );
        },
        { concurrency: REPOSITORY_CONCURRENCY },
      );

      const providerErrors = new Map<string, IssueProviderError>();
      const successfulHosts = new Set<string>();
      const entries: IssueListEntry[] = [];
      const nextCursors: Record<string, string> = {};
      for (const read of reads) {
        if (read.error !== null) {
          if (!providerErrors.has(read.project.host)) {
            providerErrors.set(read.project.host, read.error);
          }
          continue;
        }
        successfulHosts.add(read.project.host);
        const cursor = read.cursor;
        const available =
          cursor === undefined
            ? read.batch.issues
            : read.batch.issues.filter(
                (issue) =>
                  issue.updatedAt !== cursor.updatedBefore || !cursor.seenAt.includes(issue.number),
              );
        const delivered = available.slice(0, limit);
        if (read.batch.truncated) {
          const nextCursor = nextListCursor(cursor, delivered);
          if (nextCursor !== null) {
            nextCursors[listCursorKey(read.project.host, read.project.repository)] = nextCursor;
          }
        }
        for (const issue of delivered) {
          entries.push({
            provider: read.project.kind,
            host: read.project.host,
            projectId: read.project.project.id,
            projectTitle: read.project.project.title,
            repository: read.project.repository,
            ...issue,
          });
        }
      }
      entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      const supportedCounts = new Map<string, { kind: SourceControlProviderKind; count: number }>();
      for (const project of workspace.supported) {
        const current = supportedCounts.get(project.host);
        if (current === undefined)
          supportedCounts.set(project.host, { kind: project.kind, count: 1 });
        else current.count += 1;
      }
      const providers: IssueProviderSummary[] = [
        ...[...supportedCounts].map(([host, { kind, count }]) => {
          const error = providerErrors.get(host);
          return {
            host,
            kind,
            projectCount: count,
            configured: successfulHosts.has(host) || error === undefined,
            detail: error === undefined ? null : providerSummaryDetail(error),
          };
        }),
        ...[...workspace.unsupported].map(([host, { kind, projectCount }]) => ({
          host,
          kind,
          projectCount,
          configured: false,
          detail: "Issue browsing is not available for this host yet.",
        })),
      ];

      return {
        providers,
        repositories: workspace.supported.map((project) => ({
          provider: project.kind,
          host: project.host,
          projectId: project.project.id,
          projectTitle: project.project.title,
          repository: project.repository,
          ...project.links,
        })),
        entries,
        errors: [
          ...workspace.invalid,
          ...reads.flatMap((read) =>
            read.error === null
              ? []
              : [
                  {
                    projectId: read.project.project.id,
                    projectTitle: read.project.project.title,
                    message: `${read.project.repository} could not be read.`,
                    retryable: true,
                  },
                ],
          ),
        ],
        truncated: Object.keys(nextCursors).length > 0,
        nextCursors,
      };
    });

  const detailUncached: IssueService["Service"]["detail"] = (ref) =>
    Effect.gen(function* () {
      const project = yield* requireProject(ref);
      const issue = yield* runProvider(
        project,
        project.api.getIssue({
          cwd: project.project.workspaceRoot,
          host: project.host,
          repository: project.repository,
          number: ref.number,
        }),
      ).pipe(Effect.mapError(serviceError("detail")));
      return {
        provider: project.kind,
        host: project.host,
        projectId: project.project.id,
        projectTitle: project.project.title,
        repository: project.repository,
        repositoryUrl: project.links.repositoryUrl,
        newIssueUrl: project.links.newIssueUrl,
        ...issue,
      };
    });

  const activityUncached: IssueService["Service"]["activity"] = Effect.fn(
    "IssueService.activityUncached",
  )(function* (ref) {
    const project = yield* requireProject(ref);
    return yield* runProvider(
      project,
      project.api.getIssueActivity({
        cwd: project.project.workspaceRoot,
        host: project.host,
        repository: project.repository,
        number: ref.number,
      }),
    ).pipe(Effect.mapError(serviceError("activity")));
  });

  const assigneeCandidates: IssueService["Service"]["assigneeCandidates"] = Effect.fn(
    "IssueService.assigneeCandidates",
  )(function* (ref) {
    const project = yield* requireProject(ref);
    return yield* runProvider(
      project,
      project.api.listAssigneeCandidates({
        cwd: project.project.workspaceRoot,
        host: project.host,
        repository: project.repository,
        number: ref.number,
      }),
    ).pipe(Effect.mapError(serviceError("assigneeCandidates")));
  });

  const setAssigneesUncached: IssueService["Service"]["setAssignees"] = Effect.fn(
    "IssueService.setAssigneesUncached",
  )(function* (input) {
    const project = yield* requireProject(input);
    return yield* runProvider(
      project,
      project.api.setAssignees({
        cwd: project.project.workspaceRoot,
        host: project.host,
        repository: project.repository,
        number: input.number,
        assignees: input.assignees,
        assigned: input.assigned,
      }),
    ).pipe(Effect.mapError(serviceError("setAssignees")));
  });

  let epoch = 0;
  let listEpoch = 0;
  const refEpochs = new Map<string, number>();
  const REF_EPOCH_CAPACITY = 2_048;
  const refKey = (ref: IssueRef) =>
    `${ref.projectId}\0${ref.repository.toLowerCase()}\0${ref.number}`;
  const bumpRefEpoch = (ref: IssueRef) => {
    const key = refKey(ref);
    if (!refEpochs.has(key) && refEpochs.size >= REF_EPOCH_CAPACITY) {
      const oldest = refEpochs.keys().next().value;
      if (oldest !== undefined) refEpochs.delete(oldest);
    }
    refEpochs.set(key, ++epoch);
  };

  const listCache = yield* Cache.makeWith(
    (key: string) => {
      const [, input] = JSON.parse(key) as [number, IssueListInput];
      return listUncached(input);
    },
    {
      capacity: 64,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? LIST_CACHE_TTL : Duration.zero),
    },
  );
  const detailCache = yield* Cache.makeWith(
    (key: string) => {
      const [, ref] = JSON.parse(key) as [number, IssueRef];
      return detailUncached(ref);
    },
    {
      capacity: 128,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? DETAIL_CACHE_TTL : Duration.zero),
    },
  );
  const activityCache = yield* Cache.makeWith(
    (key: string) => {
      const [, ref] = JSON.parse(key) as [number, IssueRef];
      return activityUncached(ref);
    },
    {
      capacity: 128,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? DETAIL_CACHE_TTL : Duration.zero),
    },
  );

  const list: IssueService["Service"]["list"] = (input) =>
    Cache.get(
      listCache,
      JSON.stringify([
        listEpoch,
        {
          ...input,
          ...(input.projectIds === undefined ? {} : { projectIds: [...input.projectIds].sort() }),
          ...(input.cursors === undefined
            ? {}
            : {
                cursors: Object.fromEntries(
                  Object.entries(input.cursors).toSorted(([left], [right]) =>
                    left.localeCompare(right),
                  ),
                ),
              }),
        },
      ]),
    );
  const detail: IssueService["Service"]["detail"] = (ref) =>
    Cache.get(detailCache, JSON.stringify([refEpochs.get(refKey(ref)) ?? 0, ref]));
  const activity: IssueService["Service"]["activity"] = (ref) =>
    Cache.get(activityCache, JSON.stringify([refEpochs.get(refKey(ref)) ?? 0, ref]));
  const invalidate: IssueService["Service"]["invalidate"] = (input) =>
    Effect.sync(() => {
      if (input.reference === undefined) listEpoch = ++epoch;
      else bumpRefEpoch(input.reference);
    });

  const setAssignees: IssueService["Service"]["setAssignees"] = (input) =>
    setAssigneesUncached(input).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          bumpRefEpoch(input);
          listEpoch = epoch;
        }),
      ),
    );

  return IssueService.of({
    list,
    detail,
    activity,
    assigneeCandidates,
    setAssignees,
    invalidate,
  });
});

export const layer = Layer.effect(IssueService, make);
