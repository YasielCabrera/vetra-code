import {
  ProjectId,
  TicketError,
  sourceControlHostOf,
  SourceControlProviderKind,
  type OrchestrationProjectShell,
  type TicketId,
  type TicketIssueLinkCandidates,
} from "@t3tools/contracts";
import {
  canonicalRepositoryKey,
  detectSourceControlProviderFromRemoteUrl,
} from "@t3tools/shared/sourceControl";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { IssueProviderError, type IssueProviderApi } from "../issue/IssueProvider.ts";
import { IssueProviderRegistry } from "../issue/IssueProviderRegistry.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";

interface GitHubTarget {
  readonly host: string;
  readonly repository: string;
  /** Run from this source project; otherwise resolve an enabled source or a matching ticket project. */
  readonly projectId?: ProjectId | undefined;
  readonly ticketId?: TicketId | undefined;
}

const decodeProvider = Schema.decodeUnknownOption(SourceControlProviderKind);

export class TicketGitHub extends Context.Service<
  TicketGitHub,
  {
    readonly projectFor: (
      target: GitHubTarget,
      excludeProjectId?: string,
    ) => Effect.Effect<ProjectId | null, TicketError>;
    readonly run: <A>(
      target: GitHubTarget,
      call: (
        api: IssueProviderApi,
        cwd: string,
        project: OrchestrationProjectShell,
      ) => Effect.Effect<A, IssueProviderError>,
    ) => Effect.Effect<A, IssueProviderError | TicketError>;
    readonly issueLinkCandidates: (
      projectIds: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<TicketIssueLinkCandidates, TicketError>;
  }
>()("t3/ticket/TicketGitHub") {}

export const describeGitHubFailure = (error: IssueProviderError | TicketError): string => {
  if (error._tag === "TicketError") return error.message;
  switch (error.reason) {
    case "missing-tool":
      return "GitHub CLI (`gh`) is not installed on this environment.";
    case "unauthenticated":
      return "GitHub CLI is not signed in on this environment. Run `gh auth login` there.";
    case "rate-limited":
      return "GitHub's request limit was reached. Try again after it resets.";
    case "failed":
      return error.detail;
  }
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const registry = yield* IssueProviderRegistry;
  const projects = yield* ProjectService.ProjectService;
  const rateLimits = yield* SourceControlRateLimit.SourceControlRateLimit;
  const sourceControlProviders = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const recordedProvider = (project: OrchestrationProjectShell) =>
    decodeProvider(project.repositoryIdentity?.provider).pipe(
      Option.getOrElse(() => "unknown" as const),
    );

  const projectFor: TicketGitHub["Service"]["projectFor"] = (target, excludeProjectId) =>
    Effect.gen(function* () {
      if (target.projectId !== undefined) return target.projectId;
      const sources = yield* sql<{ readonly project_id: string }>`
        SELECT project_id FROM ticket_github_sources
        WHERE lower(host) = ${target.host.toLowerCase()}
          AND lower(repository) = ${target.repository.toLowerCase()} AND enabled = 1
        ORDER BY created_at
      `;
      const links =
        target.ticketId === undefined
          ? []
          : yield* sql<{ readonly project_id: string }>`
        SELECT target_key AS project_id FROM ticket_links
        WHERE ticket_id = ${target.ticketId} AND kind = 'project'
          AND target_key <> ${excludeProjectId ?? ""} ORDER BY created_at, target_key
      `;
      const ids = [...new Set([...sources, ...links].map((row) => ProjectId.make(row.project_id)))];
      if (ids.length === 0) return null;
      const shells = yield* projects.listShells({ projectIds: ids });
      const source = sources.find((row) => shells.some((shell) => shell.id === row.project_id));
      if (source !== undefined) return ProjectId.make(source.project_id);
      const key = canonicalRepositoryKey(`${target.host}/${target.repository}`.toLowerCase());
      return (
        shells.find(
          (shell) =>
            links.some((link) => link.project_id === shell.id) &&
            shell.repositoryIdentity != null &&
            canonicalRepositoryKey(shell.repositoryIdentity.canonicalKey.toLowerCase()) === key,
        )?.id ?? null
      );
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TicketError({ message: "Could not resolve the ticket's GitHub project.", cause }),
      ),
    );

  const workingProject = (target: GitHubTarget) =>
    Effect.gen(function* () {
      const projectId = yield* projectFor(target);
      const shells =
        projectId === null ? [] : yield* projects.listShells({ projectIds: [projectId] });
      const shell = shells.find((candidate) => candidate.id === projectId);
      if (shell === undefined) {
        return yield* new TicketError({
          message: `No project here can read ${target.host}/${target.repository}. Add an enabled GitHub source or link a project with this repository.`,
        });
      }
      return shell;
    }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "TicketError"
          ? cause
          : new TicketError({ message: "Could not read the ticket's GitHub project.", cause }),
      ),
    );

  const run: TicketGitHub["Service"]["run"] = (target, call) =>
    Effect.gen(function* () {
      const api = registry.get("github");
      if (api === null) {
        return yield* new TicketError({ message: "GitHub issues are not available here." });
      }
      const project = yield* workingProject(target);
      const key = { provider: "github", host: target.host } as const;
      const lease = yield* rateLimits.check(key).pipe(
        Effect.mapError(
          (cause) =>
            new IssueProviderError({
              provider: "github",
              operation: "rateLimit",
              reason: "rate-limited",
              detail: cause.detail,
              cause,
            }),
        ),
      );
      return yield* call(api, project.workspaceRoot, project).pipe(
        Effect.tap(() => rateLimits.recordSuccess({ ...key, lease })),
        Effect.tapError((error) =>
          error.reason === "rate-limited"
            ? rateLimits.recordRateLimit({ ...key, lease })
            : Effect.void,
        ),
      );
    });

  class RepositoryRead extends Data.Class<{
    readonly projectId: ProjectId;
    readonly host: string;
    readonly repository: string;
  }> {}
  const candidateCache = yield* Cache.makeWith(
    (target: RepositoryRead) =>
      run(target, (api, cwd) =>
        api.listIssues({
          cwd,
          host: target.host,
          repository: target.repository,
          state: "open",
          limit: 30,
        }),
      ),
    {
      capacity: 512,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.seconds(30) : Duration.zero),
    },
  );
  class ProviderRead extends Data.Class<{
    readonly cwd: string;
    readonly remoteName: string;
    readonly remoteUrl: string;
    readonly kind: SourceControlProviderKind;
    readonly name: string;
    readonly baseUrl: string;
  }> {}
  const providerCache = yield* Cache.makeWith(
    (target: ProviderRead) =>
      sourceControlProviders
        .resolveHandle({
          cwd: target.cwd,
          context: {
            provider: { kind: target.kind, name: target.name, baseUrl: target.baseUrl },
            remoteName: target.remoteName,
            remoteUrl: target.remoteUrl,
          },
        })
        .pipe(
          Effect.flatMap((handle) =>
            handle.context == null || handle.context.provider.kind === "unknown"
              ? Effect.fail(undefined)
              : Effect.succeed(handle.context.provider.kind),
          ),
        ),
    {
      capacity: 512,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.seconds(30) : Duration.zero),
    },
  );

  const issueLinkCandidates: TicketGitHub["Service"]["issueLinkCandidates"] = (projectIds) =>
    Effect.gen(function* () {
      const shells = yield* projects
        .listShells({ projectIds })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TicketError({ message: "Could not read the ticket's linked projects.", cause }),
          ),
        );
      const unknownByHost = new Map<string, Array<ProviderRead>>();
      for (const project of shells) {
        const identity = project.repositoryIdentity;
        if (identity == null || recordedProvider(project) !== "unknown") continue;
        const detected = detectSourceControlProviderFromRemoteUrl(identity.locator.remoteUrl);
        if (detected === null) continue;
        const candidates = unknownByHost.get(detected.baseUrl) ?? [];
        candidates.push(
          new ProviderRead({
            cwd: project.workspaceRoot,
            remoteName: identity.locator.remoteName,
            remoteUrl: identity.locator.remoteUrl,
            ...detected,
          }),
        );
        unknownByHost.set(detected.baseUrl, candidates);
      }
      const refined = new Map(
        yield* Effect.forEach(
          unknownByHost,
          ([host, candidates]) =>
            Effect.firstSuccessOf(
              candidates.map((target) => Cache.get(providerCache, target)),
            ).pipe(
              Effect.map((kind) => [host, kind] as const),
              Effect.orElseSucceed(() => [host, "unknown"] as const),
            ),
          { concurrency: 12 },
        ),
      );
      const seen = new Set<string>();
      const repositories: Array<RepositoryRead> = [];
      const errors: Array<TicketIssueLinkCandidates["errors"][number]> = [];
      const failProject = (project: OrchestrationProjectShell, message: string) =>
        errors.push({ projectId: project.id, projectTitle: project.title, message });
      for (const project of shells) {
        const identity = project.repositoryIdentity;
        if (identity == null) {
          failProject(project, "This project has no repository identity.");
          continue;
        }
        const detected = detectSourceControlProviderFromRemoteUrl(identity.locator.remoteUrl);
        const recordedKind = recordedProvider(project);
        const kind =
          recordedKind === "unknown" && detected !== null
            ? (refined.get(detected.baseUrl) ?? detected.kind)
            : recordedKind;
        let host = sourceControlHostOf(identity, kind);
        if (host === kind && detected !== null) host = new URL(detected.baseUrl).host.toLowerCase();
        const canonical = canonicalRepositoryKey(identity.canonicalKey.toLowerCase());
        const repository = (
          identity.displayName ??
          (identity.owner && identity.name
            ? `${identity.owner}/${identity.name}`
            : canonical.slice(canonical.indexOf("/") + 1))
        )
          .trim()
          .toLowerCase();
        const key = `${host}\0${repository}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const api = registry.get(kind);
        if (kind !== "github" || api === null) {
          failProject(project, `GitHub issues are not available for ${host}/${repository}.`);
          continue;
        }
        if (api.repositoryLinks({ host, repository }) === null) {
          failProject(
            project,
            `The repository identity ${host}/${repository} is not valid for this host.`,
          );
          continue;
        }
        repositories.push(new RepositoryRead({ projectId: project.id, host, repository }));
      }
      for (const projectId of projectIds) {
        if (!shells.some((project) => project.id === projectId))
          errors.push({
            projectId,
            projectTitle: projectId,
            message: "This linked project is no longer available here.",
          });
      }
      const entries = yield* Effect.forEach(
        repositories,
        (target) =>
          Cache.get(candidateCache, target).pipe(
            Effect.map((batch) =>
              batch.issues.slice(0, 30).map((issue) => ({
                host: target.host,
                repository: target.repository,
                number: issue.number,
                title: issue.title,
                state: issue.state,
                url: issue.url,
              })),
            ),
            Effect.catch((error) => {
              const project = shells.find((shell) => shell.id === target.projectId);
              if (project !== undefined)
                failProject(
                  project,
                  `${target.host}/${target.repository}: ${describeGitHubFailure(error)}`,
                );
              return Effect.succeed([]);
            }),
          ),
        { concurrency: 12 },
      );
      return { entries: entries.flat(), errors };
    });

  return TicketGitHub.of({ run, projectFor, issueLinkCandidates });
});

export const layer = Layer.effect(TicketGitHub, make);
