import { describe, expect, it } from "vite-plus/test";

import {
  mergeKnownIssueAssignees,
  NO_KNOWN_ISSUE_ASSIGNEES,
  type KnownIssueAssignees,
} from "./issueAssignees.logic";

const actor = (login: string) => ({ login, name: null, avatarUrl: null });
const rows = (...logins: ReadonlyArray<ReadonlyArray<string>>) =>
  logins.map((assignees) => ({ assignees: assignees.map(actor) }));

describe("mergeKnownIssueAssignees", () => {
  it("gathers every assignee the loaded rows name, sorted and deduplicated by login", () => {
    const merged = mergeKnownIssueAssignees(NO_KNOWN_ISSUE_ASSIGNEES, "scope", [
      ...rows(["zoe", "alice"], ["ALICE"], []),
    ]);
    expect(merged.actors.map(({ login }) => login)).toEqual(["alice", "zoe"]);
  });

  it("keeps the people from earlier pages when a later one arrives", () => {
    const first = mergeKnownIssueAssignees(NO_KNOWN_ISSUE_ASSIGNEES, "scope", rows(["alice"]));
    const second = mergeKnownIssueAssignees(first, "scope", rows(["bilal"]));
    expect(second.actors.map(({ login }) => login)).toEqual(["alice", "bilal"]);
  });

  it("keeps everyone else while the answer is narrowed to one of them", () => {
    // The whole point: filtering to alice returns only alice's rows, and the menu that got you
    // there must still be able to take you to bilal.
    const both = mergeKnownIssueAssignees(
      NO_KNOWN_ISSUE_ASSIGNEES,
      "scope",
      rows(["alice", "bilal"]),
    );
    const narrowed = mergeKnownIssueAssignees(both, "scope", rows(["alice"]));
    expect(narrowed).toBe(both);
  });

  it("drops them when a different narrowing changes who could be relevant", () => {
    const held: KnownIssueAssignees = mergeKnownIssueAssignees(
      NO_KNOWN_ISSUE_ASSIGNEES,
      "project-a",
      rows(["alice"]),
    );
    const moved = mergeKnownIssueAssignees(held, "project-b", rows(["bilal"]));
    expect(moved.actors.map(({ login }) => login)).toEqual(["bilal"]);
    expect(moved.key).toBe("project-b");
  });

  it("returns the identical value when an answer names nobody new", () => {
    const held = mergeKnownIssueAssignees(NO_KNOWN_ISSUE_ASSIGNEES, "scope", rows(["alice"]));
    expect(mergeKnownIssueAssignees(held, "scope", rows(["alice"], []))).toBe(held);
  });
});
