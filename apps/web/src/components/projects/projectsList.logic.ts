import type { EnvironmentThreadShell } from "@vetra-code/client-runtime/state/models";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";

/** What a row shows, resolved once for the list rather than per keystroke. */
export interface ProjectRowModel {
  readonly group: SidebarProjectSnapshot;
  /** The repository the group belongs to, or null when it is not in one. */
  readonly repositoryLabel: string | null;
  readonly threadCount: number;
  /** The most recent thread activity anywhere in the group; null with no threads. */
  readonly lastActiveAt: string | null;
  /** Everything the search reads, lowercased once. */
  readonly haystack: string;
}

/**
 * The repository a project group belongs to, named the way a host would name
 * it. Null when the checkout is not in a recognized repository, where the
 * workspace path is the only honest thing to show instead.
 */
export function repositoryLabelOf(group: SidebarProjectSnapshot): string | null {
  const identity = group.repositoryIdentity;
  if (!identity) return null;
  if (identity.owner && identity.name) return `${identity.owner}/${identity.name}`;
  return identity.displayName ?? identity.name ?? null;
}

/**
 * One row per logical project group, counted across every checkout the group
 * holds: a grouped repository reports the threads of all of them, because that
 * is what the one row stands for.
 */
export function buildProjectRowModels(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  threads: ReadonlyArray<
    Pick<EnvironmentThreadShell, "environmentId" | "projectId" | "updatedAt" | "hiddenAt">
  >,
): ReadonlyArray<ProjectRowModel> {
  const perProject = new Map<string, { count: number; lastActiveAt: string }>();
  for (const thread of threads) {
    // Hidden threads are not in the sidebar, so counting them here would
    // promise threads the project page cannot show.
    if (thread.hiddenAt != null) continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    const held = perProject.get(key);
    perProject.set(key, {
      count: (held?.count ?? 0) + 1,
      // ISO instants sort lexicographically, so the later string is the later time.
      lastActiveAt:
        held && held.lastActiveAt > thread.updatedAt ? held.lastActiveAt : thread.updatedAt,
    });
  }

  return groups.map((group): ProjectRowModel => {
    let threadCount = 0;
    let lastActiveAt: string | null = null;
    for (const projectRef of group.memberProjectRefs) {
      const held = perProject.get(`${projectRef.environmentId}:${projectRef.projectId}`);
      if (!held) continue;
      threadCount += held.count;
      if (lastActiveAt === null || held.lastActiveAt > lastActiveAt) {
        lastActiveAt = held.lastActiveAt;
      }
    }
    const repositoryLabel = repositoryLabelOf(group);
    return {
      group,
      repositoryLabel,
      threadCount,
      lastActiveAt,
      haystack: [
        group.displayName,
        repositoryLabel ?? "",
        // Every checkout's own title and path, so searching for the worktree
        // you remember finds the group that holds it.
        ...group.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]),
        ...group.remoteEnvironmentLabels,
      ]
        .join(" ")
        .toLowerCase(),
    };
  });
}

/** Free-text filter over everything a row can be recognized by. */
export function matchesProjectQuery(row: ProjectRowModel, normalizedQuery: string): boolean {
  return row.haystack.includes(normalizedQuery);
}

export function threadCountLabel(count: number): string {
  if (count === 0) return "No threads";
  return count === 1 ? "1 thread" : `${count} threads`;
}
