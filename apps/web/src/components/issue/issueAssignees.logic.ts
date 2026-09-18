import type { IssueActor, IssueListEntry } from "@t3tools/contracts";

export interface KnownIssueAssignees {
  /** The narrowings these people were gathered under, minus the assignee filter itself. */
  readonly key: string;
  readonly actors: ReadonlyArray<IssueActor>;
}

export const NO_KNOWN_ISSUE_ASSIGNEES: KnownIssueAssignees = { key: "", actors: [] };

/**
 * The people an assignee filter can offer, gathered from the issues that have arrived.
 *
 * Every row names who it is assigned to, so the loaded rows are the only list of them that costs
 * nothing to read. They accumulate rather than replace: page two must not take page one's people
 * out of the menu, and neither must an answer already narrowed to one of them — that is what
 * `key` is for, holding the people across a change of assignee and dropping them on a change of
 * anything else, where they may have nothing to do with what is being looked at now.
 *
 * Returns the identical object when nothing new arrived, so a caller can skip a re-render.
 */
export function mergeKnownIssueAssignees(
  held: KnownIssueAssignees,
  key: string,
  entries: ReadonlyArray<Pick<IssueListEntry, "assignees">>,
): KnownIssueAssignees {
  const sameScope = held.key === key;
  const carried = sameScope ? held.actors : [];
  // Keyed by the lowercased login: a host spells one account one way, but two rows can carry it
  // cased differently, and the menu must not offer the same person twice.
  const byLogin = new Map(carried.map((actor) => [actor.login.toLowerCase(), actor]));
  for (const entry of entries) {
    for (const actor of entry.assignees) {
      const login = actor.login.toLowerCase();
      if (!byLogin.has(login)) byLogin.set(login, actor);
    }
  }
  if (sameScope && byLogin.size === carried.length) return held;
  return {
    key,
    actors: [...byLogin.values()].toSorted((left, right) => left.login.localeCompare(right.login)),
  };
}
