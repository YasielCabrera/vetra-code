import { ProjectId, TicketError, type TicketId } from "@t3tools/contracts";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { IssueProviderError, type IssueProviderApi } from "../issue/IssueProvider.ts";
import { IssueProviderRegistry } from "../issue/IssueProviderRegistry.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";

interface GitHubTarget {
  readonly host: string;
  readonly repository: string;
  /** Run from this source project; otherwise resolve an enabled source or a matching ticket project. */
  readonly projectId?: ProjectId | undefined;
  readonly ticketId?: TicketId | undefined;
}

export class TicketGitHub extends Context.Service<
  TicketGitHub,
  {
    readonly projectFor: (
      target: GitHubTarget,
      excludeProjectId?: string,
    ) => Effect.Effect<ProjectId | null, TicketError>;
    readonly run: <A>(
      target: GitHubTarget,
      call: (api: IssueProviderApi, cwd: string) => Effect.Effect<A, IssueProviderError>,
    ) => Effect.Effect<A, IssueProviderError | TicketError>;
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

  const workingDirectory = (target: GitHubTarget) =>
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
      return shell.workspaceRoot;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TicketError({ message: "Could not read the ticket's GitHub project.", cause }),
      ),
    );

  const run: TicketGitHub["Service"]["run"] = (target, call) =>
    Effect.gen(function* () {
      const api = registry.get("github");
      if (api === null) {
        return yield* new TicketError({ message: "GitHub issues are not available here." });
      }
      const cwd = yield* workingDirectory(target);
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
      return yield* call(api, cwd).pipe(
        Effect.tap(() => rateLimits.recordSuccess({ ...key, lease })),
        Effect.tapError((error) =>
          error.reason === "rate-limited"
            ? rateLimits.recordRateLimit({ ...key, lease })
            : Effect.void,
        ),
      );
    });

  return TicketGitHub.of({ run, projectFor });
});

export const layer = Layer.effect(TicketGitHub, make);
