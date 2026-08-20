import type { MergedIssueList } from "~/state/issues";

function mergeByKey<A>(
  held: ReadonlyArray<A>,
  arrived: ReadonlyArray<A>,
  keyOf: (value: A) => string,
): ReadonlyArray<A> {
  const merged = [...held];
  const positions = new Map(held.map((value, index) => [keyOf(value), index]));
  for (const value of arrived) {
    const key = keyOf(value);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, merged.length);
      merged.push(value);
    } else {
      merged[position] = value;
    }
  }
  return merged;
}

/** Append one continuation slice while retaining metadata from environments that already ended. */
export function mergeIssueListPage(
  held: MergedIssueList | null,
  arrived: MergedIssueList,
  continuing: boolean,
): MergedIssueList {
  if (!continuing || held === null) return arrived;
  return {
    entries: mergeByKey(
      held.entries,
      arrived.entries,
      (entry) => `${entry.environmentId}:${entry.host}:${entry.repository}:${entry.number}`,
    ),
    providers: mergeByKey(
      held.providers,
      arrived.providers,
      (provider) => `${provider.environmentId}:${provider.host}`,
    ),
    repositories: mergeByKey(
      held.repositories,
      arrived.repositories,
      (repository) => `${repository.environmentId}:${repository.host}:${repository.repository}`,
    ),
    errors: mergeByKey(
      held.errors,
      arrived.errors,
      (error) => `${error.environmentId}:${error.projectId}:${error.message}`,
    ),
    truncated: arrived.truncated,
    nextCursors: arrived.nextCursors,
  };
}
