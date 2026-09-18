import type { IssueActivity, IssueTimelineEvent, IssueTimelineItem } from "@t3tools/contracts";

/** The host usually answers oldest-first, but timestamps are the contract and the order is not. */
export function buildIssueTimeline(activity: IssueActivity): ReadonlyArray<IssueTimelineItem> {
  return activity.items.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function quoted(value: string | null | undefined): string {
  return value?.trim() ? `“${value.trim()}”` : "an unspecified value";
}

function friendlyKind(kind: string): string {
  return kind.replaceAll("_", " ").replaceAll("-", " ");
}

/** A host event stays readable even when GitHub adds a kind this client has never seen. */
export function issueTimelineEventLabel(event: IssueTimelineEvent): string {
  switch (event.kind) {
    case "assigned":
      return `assigned ${event.assignee?.login ?? "someone"}`;
    case "unassigned":
      return `unassigned ${event.assignee?.login ?? "someone"}`;
    case "labeled":
      return event.label ? `added the ${quoted(event.label.name)} label` : "added a label";
    case "unlabeled":
      return event.label ? `removed the ${quoted(event.label.name)} label` : "removed a label";
    case "milestoned":
      return `added this to the ${quoted(event.milestoneTitle)} milestone`;
    case "demilestoned":
      return `removed this from the ${quoted(event.milestoneTitle)} milestone`;
    case "renamed":
      return `renamed this from ${quoted(event.rename?.from)} to ${quoted(event.rename?.to)}`;
    case "locked":
      return event.lockReason
        ? `locked the conversation as ${friendlyKind(event.lockReason)}`
        : "locked the conversation";
    case "unlocked":
      return "unlocked the conversation";
    case "closed":
      return "closed this issue";
    case "reopened":
      return "reopened this issue";
    case "cross-referenced":
      return event.source === null
        ? "mentioned this issue elsewhere"
        : `mentioned this in ${event.source.repository}#${event.source.number}`;
    case "referenced":
      return event.commitId
        ? `referenced this from commit ${event.commitId.slice(0, 7)}`
        : "referenced this issue";
    case "connected":
      return event.source === null
        ? "linked another issue"
        : `linked ${event.source.repository}#${event.source.number}`;
    case "disconnected":
      return event.source === null
        ? "removed a linked issue"
        : `unlinked ${event.source.repository}#${event.source.number}`;
    case "transferred":
      return "transferred this issue";
    case "pinned":
      return "pinned this issue";
    case "unpinned":
      return "unpinned this issue";
    case "marked_as_duplicate":
      return "marked this as a duplicate";
    case "unmarked_as_duplicate":
      return "removed the duplicate mark";
    case "added_to_project":
      return event.projectColumnName
        ? `added this to the ${quoted(event.projectColumnName)} project column`
        : "added this to a project";
    case "moved_columns_in_project":
      return event.previousProjectColumnName || event.projectColumnName
        ? `moved this from ${quoted(event.previousProjectColumnName)} to ${quoted(event.projectColumnName)}`
        : "moved this within a project";
    case "removed_from_project":
      return "removed this from a project";
    case "converted_to_discussion":
      return "converted this issue to a discussion";
    case "mentioned":
      return "mentioned this issue";
    case "subscribed":
      return "subscribed to this issue";
    case "unsubscribed":
      return "unsubscribed from this issue";
    default:
      return `recorded ${friendlyKind(event.kind)}`;
  }
}
