import type {
  TicketActivity,
  TicketActivityEntry,
  TicketActor,
  TicketLinkKind,
  TicketPlanId,
} from "@t3tools/contracts";

export const ACTIVITY_GROUP_GAP_MS = 5 * 60_000;
/** A group never spans longer than this from its first entry, so a slow drip keeps splitting. */
export const ACTIVITY_GROUP_SPAN_MS = 30 * 60_000;
export const ACTIVITY_RECENT_ROWS = 8;
/** Fewer hidden rows than this are not worth a fold. */
export const ACTIVITY_MIN_FOLDED_ROWS = 4;

export type TicketActivityFamily =
  | { readonly type: "link"; readonly key: string; readonly kind: TicketLinkKind }
  | { readonly type: "attachment"; readonly key: string }
  | { readonly type: "edit"; readonly key: string }
  | { readonly type: "status"; readonly key: string }
  | { readonly type: "sync"; readonly key: string }
  | {
      readonly type: "plan";
      readonly key: string;
      readonly planId: TicketPlanId;
      readonly number: number;
    };

const ATTACHMENT_FAMILY = { type: "attachment", key: "attachment" } as const;
const EDIT_FAMILY = { type: "edit", key: "edit" } as const;
const STATUS_FAMILY = { type: "status", key: "status" } as const;
const SYNC_FAMILY = { type: "sync", key: "sync" } as const;

export function ticketActivityFamily(entry: TicketActivityEntry): TicketActivityFamily | null {
  switch (entry.type) {
    case "created":
    case "comment":
      return null;
    case "linked":
      return { type: "link", key: `link:${entry.target.kind}`, kind: entry.target.kind };
    case "unlinked":
      return { type: "link", key: `link:${entry.kind}`, kind: entry.kind };
    case "attachment_added":
    case "attachment_removed":
      return ATTACHMENT_FAMILY;
    case "edited":
      return EDIT_FAMILY;
    case "status_changed":
      return STATUS_FAMILY;
    case "synced":
      return SYNC_FAMILY;
    case "plan_created":
    case "plan_edited":
    case "plan_archived":
    case "plan_restored":
    case "plan_deleted":
    case "plan_review_status_changed":
      return {
        type: "plan",
        key: `plan:${entry.planId}`,
        planId: entry.planId,
        number: entry.number,
      };
  }
}

function actorKey(actor: TicketActor): string {
  return actor.type === "agent" ? `agent:${actor.threadId}` : actor.type;
}

/** A group's `id` is its first activity's, so entries joining later keep its expanded state. */
export type TicketActivityRow =
  | { readonly type: "entry"; readonly index: number }
  | {
      readonly type: "group";
      readonly id: number;
      readonly family: TicketActivityFamily;
      readonly start: number;
      readonly end: number;
    };

/** Bursts of same-actor, same-family activity (oldest first) as one row each. */
export function groupTicketActivity(
  activity: ReadonlyArray<TicketActivity>,
): ReadonlyArray<TicketActivityRow> {
  const rows: TicketActivityRow[] = [];
  let start = 0;
  while (start < activity.length) {
    const first = activity[start]!;
    const family = ticketActivityFamily(first.entry);
    let end = start + 1;
    if (family !== null) {
      const actor = actorKey(first.actor);
      const firstAt = Date.parse(first.createdAt);
      let previousAt = firstAt;
      for (; end < activity.length; end++) {
        const next = activity[end]!;
        const at = Date.parse(next.createdAt);
        if (
          ticketActivityFamily(next.entry)?.key !== family.key ||
          actorKey(next.actor) !== actor ||
          at - previousAt > ACTIVITY_GROUP_GAP_MS ||
          at - firstAt > ACTIVITY_GROUP_SPAN_MS
        ) {
          break;
        }
        previousAt = at;
      }
    }
    rows.push(
      family !== null && end - start > 1
        ? { type: "group", id: first.id, family, start, end }
        : { type: "entry", index: start },
    );
    start = end;
  }
  return rows;
}

export type TicketActivityFold = {
  readonly lead: ReadonlyArray<TicketActivityRow>;
  /** Folded rows, empty when the timeline is short enough to show whole. */
  readonly earlier: ReadonlyArray<TicketActivityRow>;
  readonly recent: ReadonlyArray<TicketActivityRow>;
  readonly hiddenActivityCount: number;
  readonly hiddenCommentCount: number;
};

/** Keeps the first row and the newest ones, folding the middle of a long timeline. */
export function foldTicketActivity(
  rows: ReadonlyArray<TicketActivityRow>,
  activity: ReadonlyArray<TicketActivity>,
): TicketActivityFold {
  const lead = rows.slice(0, 1);
  const hiddenRows = rows.length - lead.length - ACTIVITY_RECENT_ROWS;
  if (hiddenRows < ACTIVITY_MIN_FOLDED_ROWS) {
    return {
      lead,
      earlier: [],
      recent: rows.slice(1),
      hiddenActivityCount: 0,
      hiddenCommentCount: 0,
    };
  }
  const earlier = rows.slice(1, 1 + hiddenRows);
  let hiddenActivityCount = 0;
  let hiddenCommentCount = 0;
  for (const row of earlier) {
    if (row.type === "group") {
      hiddenActivityCount += row.end - row.start;
    } else {
      hiddenActivityCount += 1;
      if (activity[row.index]!.entry.type === "comment") hiddenCommentCount += 1;
    }
  }
  return {
    lead,
    earlier,
    recent: rows.slice(1 + hiddenRows),
    hiddenActivityCount,
    hiddenCommentCount,
  };
}
