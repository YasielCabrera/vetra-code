import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import {
  type EnvironmentId,
  type TicketGitHubIssueRef,
  type ProjectId,
  type TicketGitHubRef,
  type TicketGitHubSource,
  type TicketStatusDefinition,
  type TicketStatusSet,
  type VcsRemote,
} from "@t3tools/contracts";
import {
  canonicalRepositoryKey,
  detectSourceControlProviderFromRemoteUrl,
} from "@t3tools/shared/sourceControl";

export type GitHubTicket = Extract<EnvironmentTicket, { kind: "github" }>;

type ScopedSource = TicketGitHubSource & { readonly environmentId: EnvironmentId };

interface RepositoryProjectContext {
  readonly sources: ReadonlyArray<ScopedSource>;
  /** The ticket's linked projects, in link order. */
  readonly linkedProjectIds: ReadonlyArray<string>;
  readonly projects: ReadonlyArray<
    Pick<EnvironmentProject, "environmentId" | "id" | "repositoryIdentity">
  >;
}

export function projectGitHubRemotes(remotes: ReadonlyArray<Pick<VcsRemote, "name" | "url">>) {
  return remotes
    .toSorted((a, b) =>
      a.name === b.name
        ? 0
        : a.name === "origin"
          ? -1
          : b.name === "origin"
            ? 1
            : a.name.localeCompare(b.name),
    )
    .flatMap((remote) => {
      const provider = detectSourceControlProviderFromRemoteUrl(remote.url);
      if (provider?.kind !== "github") return [];
      try {
        const url = new URL(remote.url.trim().replace(/^([A-Za-z0-9._-]+@[^:/\s]+):/, "ssh://$1/"));
        const repository = url.pathname
          .replace(/^\//, "")
          .replace(/\/?$/, "")
          .replace(/\.git$/i, "");
        if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) return [];
        return [{ remoteName: remote.name, host: new URL(provider.baseUrl).host, repository }];
      } catch {
        return [];
      }
    });
}

export function eligibleTicketGitHubProjects<
  Project extends Pick<EnvironmentProject, "environmentId" | "id"> & {
    readonly remotes: ReadonlyArray<Pick<VcsRemote, "name" | "url">>;
  },
>(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly sources: ReadonlyArray<ScopedSource>;
}) {
  const sourceKey = (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    host: string,
    repository: string,
  ) => JSON.stringify([environmentId, projectId, host.toLowerCase(), repository.toLowerCase()]);
  const added = new Set(
    input.sources.map((source) =>
      sourceKey(source.environmentId, source.projectId, source.host, source.repository),
    ),
  );
  const seen = new Set<string>();
  return input.projects.flatMap((project) =>
    projectGitHubRemotes(project.remotes).flatMap((remote) => {
      const key = sourceKey(project.environmentId, project.id, remote.host, remote.repository);
      const rowKey = JSON.stringify([key, remote.remoteName]);
      if (added.has(key) || seen.has(rowKey)) return [];
      seen.add(rowKey);
      return [{ project, ...remote }];
    }),
  );
}

/** The source that syncs a repository in an environment, enabled ones first. */
export function ticketGitHubSource<Source extends ScopedSource>(
  environmentId: EnvironmentId,
  repository: Pick<TicketGitHubRef, "host" | "repository">,
  sources: ReadonlyArray<Source>,
): Source | null {
  const host = repository.host.toLowerCase();
  const name = repository.repository.toLowerCase();
  const matching = sources.filter(
    (source) =>
      source.environmentId === environmentId &&
      source.host.toLowerCase() === host &&
      source.repository.toLowerCase() === name,
  );
  return matching.find((source) => source.enabled) ?? matching[0] ?? null;
}

/**
 * Project-owned issue and pull request APIs require the primary repository identity to match
 * both host and repository. A source can sync a secondary remote, so it alone is not enough.
 */
export function ticketRepositoryProjectId(
  environmentId: EnvironmentId,
  repository: Pick<TicketGitHubRef, "host" | "repository">,
  context: RepositoryProjectContext,
): ProjectId | null {
  const source = ticketGitHubSource(environmentId, repository, context.sources);
  if (
    source?.enabled &&
    context.projects.some(
      (project) =>
        project.environmentId === environmentId &&
        project.id === source.projectId &&
        project.repositoryIdentity != null &&
        canonicalRepositoryKey(project.repositoryIdentity.canonicalKey.toLowerCase()) ===
          canonicalRepositoryKey(`${repository.host}/${repository.repository}`.toLowerCase()),
    )
  )
    return source.projectId;
  const key = canonicalRepositoryKey(`${repository.host}/${repository.repository}`.toLowerCase());
  const linked = new Set(context.linkedProjectIds);
  const project = context.projects.find(
    (candidate) =>
      candidate.environmentId === environmentId &&
      linked.has(candidate.id) &&
      candidate.repositoryIdentity != null &&
      canonicalRepositoryKey(candidate.repositoryIdentity.canonicalKey.toLowerCase()) === key,
  );
  return project?.id ?? null;
}

/** Ticket issue RPCs resolve the stored host and repository on the environment. */
export function ticketIssueRef(
  ticket: GitHubTicket,
  _context: RepositoryProjectContext,
): TicketGitHubIssueRef {
  return { ticketId: ticket.id };
}

/**
 * What the board's Sync control syncs and reports. Enabled sources are the ones kept in sync, so
 * the stalest of them dates the board; with none enabled every source counts.
 */
export function summarizeGitHubSync<Source extends TicketGitHubSource>(
  sources: ReadonlyArray<Source>,
): {
  readonly sources: ReadonlyArray<Source>;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
} | null {
  if (sources.length === 0) return null;
  const enabled = sources.filter((source) => source.enabled);
  const counted = enabled.length > 0 ? enabled : sources;
  const syncedAt = counted.map((source) => source.lastSyncedAt);
  return {
    sources: counted,
    lastSyncedAt: syncedAt.includes(null) ? null : (syncedAt.toSorted()[0] ?? null),
    lastError: counted.find((source) => source.lastError !== null)?.lastError ?? null,
  };
}

/**
 * Where Close issue and Reopen issue move a ticket: the first closed status that completes the
 * issue (any closed one if none does), or the open category's default.
 */
export function issueStateTargetStatus(
  statusSet: TicketStatusSet | null,
  action: "close" | "reopen",
): TicketStatusDefinition | undefined {
  const statuses = statusSet?.statuses ?? [];
  if (action === "reopen") {
    return statuses.find((status) => status.category === "open" && status.isDefault);
  }
  const closed = statuses.filter((status) => status.category === "closed");
  return closed.find((status) => status.closeReason === "completed") ?? closed[0];
}
