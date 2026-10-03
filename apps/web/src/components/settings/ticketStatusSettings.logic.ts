import type {
  TicketCloseReason,
  TicketStatusCategory,
  TicketStatusColor,
  TicketStatusDefinition,
  TicketStatusId,
  TicketStatusSet,
  TicketStatusUpsertInput,
} from "@t3tools/contracts";

export interface TicketStatusEdit {
  readonly name?: string;
  readonly color?: TicketStatusColor;
  readonly category?: TicketStatusCategory;
  readonly closeReason?: TicketCloseReason;
  readonly collapsedByDefault?: boolean;
  readonly makeDefault?: true;
}

export interface TicketStatusEditQueue {
  readonly status: TicketStatusDefinition;
  readonly sourceStatus: TicketStatusDefinition;
  readonly edits: ReadonlyArray<TicketStatusEdit>;
}

export function enqueueTicketStatusEdit(
  queue: TicketStatusEditQueue | undefined,
  status: TicketStatusDefinition,
  edit: TicketStatusEdit,
): TicketStatusEditQueue {
  return {
    status:
      queue === undefined || (queue.edits.length === 0 && queue.sourceStatus !== status)
        ? status
        : queue.status,
    sourceStatus: status,
    edits: [...(queue?.edits ?? []), edit],
  };
}

export function settleTicketStatusEdit(
  queue: TicketStatusEditQueue,
  result: TicketStatusSet | null,
): TicketStatusEditQueue {
  return {
    ...queue,
    status: result?.statuses.find((status) => status.id === queue.status.id) ?? queue.status,
    edits: queue.edits.slice(1),
  };
}

/**
 * The upsert that applies `edit` to `status`. The server takes whole definitions, and only a
 * closed status carries a close reason: moving into closed picks "completed" unless told
 * otherwise, and moving out drops it.
 */
export function ticketStatusUpsert(
  status: TicketStatusDefinition,
  edit: TicketStatusEdit,
): TicketStatusUpsertInput {
  const base = {
    statusId: status.id,
    name: edit.name ?? status.name,
    color: edit.color ?? status.color,
    collapsedByDefault: edit.collapsedByDefault ?? status.collapsedByDefault,
    ...(edit.makeDefault ? { isDefault: true } : {}),
  };
  const category = edit.category ?? status.category;
  if (category !== "closed") return { ...base, category };
  return {
    ...base,
    category,
    closeReason:
      edit.closeReason ?? (status.category === "closed" ? status.closeReason : "completed"),
  };
}

export function moveTicketStatus(
  statusIds: ReadonlyArray<TicketStatusId>,
  statusId: TicketStatusId,
  direction: -1 | 1,
): ReadonlyArray<TicketStatusId> {
  const index = statusIds.indexOf(statusId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= statusIds.length) return statusIds;
  const next = [...statusIds];
  next[index] = statusIds[target]!;
  next[target] = statusId;
  return next;
}
