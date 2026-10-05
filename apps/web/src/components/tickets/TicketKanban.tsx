import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type Active,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type Over,
  PointerSensor,
  type UniqueIdentifier,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { LegendList } from "@legendapp/list/react";
import { type EnvironmentTicket, ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { EnvironmentId, TicketStatusDefinition, TicketStatusSet } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { memo, useCallback, useId, useMemo, useState, type MouseEvent } from "react";

import "./TicketKanban.css";

import { confirmGitHubStateChange, useTicketActions } from "../../hooks/useTicketActions";
import { cn } from "../../lib/utils";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { groupTicketsByStatus, type TicketStatusGroup } from "./ticketBoard.logic";
import { TICKET_REVISION_CONFLICT } from "./ticketDocument.logic";
import {
  applyPendingMoves,
  dropSortKey,
  type PendingTicketMove,
  settlePendingMoves,
  statusForColumn,
} from "./ticketKanban.logic";
import { TicketLinkCounts, TicketStatusIcon } from "./ticketPresentation";
import {
  TicketAssignees,
  TicketSource,
  TicketStatusMark,
  TicketTags,
  TicketUpdatedAt,
} from "./TicketListRow";
import { formatTicketRef } from "./ticketRefs";

const VIRTUALIZE_AFTER = 50;
const CARD_HEIGHT_ESTIMATE = 152;

type DropPosition =
  | { readonly type: "card"; readonly columnKey: string; readonly index: number }
  | { readonly type: "column-end"; readonly columnKey: string; readonly slot: number };

interface DropTarget {
  readonly columnKey: string;
  readonly slot: number;
}

const columnDroppableId = (columnKey: string) => `ticket-column:${columnKey}`;

/**
 * Hit-tests the page rather than droppable rects, which ignore clipping: a card scrolled under its
 * column's header, or a column scrolled under the sidebar, must not take a drop. The innermost
 * droppable under the pointer wins, so a card beats its column.
 */
const visibleDroppableUnderPointer: CollisionDetection = ({
  pointerCoordinates,
  droppableContainers,
}) => {
  if (pointerCoordinates === null) return [];
  for (const element of document.elementsFromPoint(pointerCoordinates.x, pointerCoordinates.y)) {
    if (element.closest("[data-ticket-drag-overlay]") !== null) continue;
    const id = element.closest<HTMLElement>("[data-ticket-drop]")?.dataset.ticketDrop;
    const container = droppableContainers.find((candidate) => candidate.id === id);
    return container === undefined
      ? []
      : [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
  }
  return [];
};
const keyOf = (ticket: EnvironmentTicket) =>
  ticketKey({ environmentId: ticket.environmentId, ticketId: ticket.id });

export function TicketKanban(props: {
  readonly tickets: ReadonlyArray<EnvironmentTicket>;
  readonly statusSets: ReadonlyMap<EnvironmentId, TicketStatusSet>;
  /** A status group key; only that column shows. */
  readonly statusFilter: string | undefined;
  readonly collapsedOverrides: ReadonlyMap<string, boolean>;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly onToggleColumn: (group: TicketStatusGroup, collapsed: boolean) => void;
  readonly onOpen: (ticket: EnvironmentTicket) => void;
}) {
  const { statusSets, statusFilter } = props;
  const actions = useTicketActions();
  const [pending, setPending] = useState<ReadonlyMap<string, PendingTicketMove>>(() => new Map());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(
    () =>
      groupTicketsByStatus(applyPendingMoves(props.tickets, pending), statusSets).filter(
        (group) => statusFilter === undefined || group.key === statusFilter,
      ),
    [pending, props.tickets, statusFilter, statusSets],
  );
  const { positions, ticketsByKey } = useMemo(() => {
    const positions = new Map<UniqueIdentifier, DropPosition>();
    const ticketsByKey = new Map<string, EnvironmentTicket>();
    for (const column of columns) {
      positions.set(columnDroppableId(column.key), {
        type: "column-end",
        columnKey: column.key,
        slot: column.tickets.length,
      });
      column.tickets.forEach((ticket, index) => {
        const key = keyOf(ticket);
        positions.set(key, { type: "card", columnKey: column.key, index });
        ticketsByKey.set(key, ticket);
      });
    }
    return { positions, ticketsByKey };
  }, [columns]);
  const movingKeys = useMemo(
    () => new Set(settlePendingMoves(pending, props.tickets).keys()),
    [pending, props.tickets],
  );

  const targetFor = useCallback(
    (active: Active, over: Over | null): DropTarget | null => {
      const position = over === null ? undefined : positions.get(over.id);
      if (over === null || position === undefined) return null;
      if (position.type === "column-end") {
        return { columnKey: position.columnKey, slot: position.slot };
      }
      const dragged = active.rect.current.translated;
      const below =
        dragged !== null && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2;
      return { columnKey: position.columnKey, slot: position.index + (below ? 1 : 0) };
    },
    [positions],
  );

  const handleDragMove = (event: DragMoveEvent) => {
    const next = targetFor(event.active, event.over);
    setDropTarget((current) =>
      current?.columnKey === next?.columnKey && current?.slot === next?.slot ? current : next,
    );
  };

  const clearPending = (key: string, move: PendingTicketMove) =>
    setPending((current) => {
      if (current.get(key) !== move) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });

  const drop = async (ticket: EnvironmentTicket, target: DropTarget) => {
    const column = columns.find((candidate) => candidate.key === target.columnKey);
    if (column === undefined) return;
    const status = statusForColumn(
      statusSets.get(ticket.environmentId),
      column.key,
      ticket.statusId,
    );
    if (status === undefined) {
      const environment = props.environmentLabels.get(ticket.environmentId) ?? "Its environment";
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Can't move ${formatTicketRef(ticket)} to ${column.name}`,
          description: `${environment} has no "${column.name}" status. Add one in Settings → Tickets.`,
        }),
      );
      return;
    }
    const key = keyOf(ticket);
    const sortKey = dropSortKey(
      column.tickets.map((other) => other.sortKey),
      target.slot,
      column.tickets.findIndex((other) => keyOf(other) === key),
    );
    if (sortKey === null) return;

    const move: PendingTicketMove = { fromRevision: ticket.revision, statusId: status.id, sortKey };
    setPending((current) => new Map(settlePendingMoves(current, props.tickets)).set(key, move));
    if (!(await confirmGitHubStateChange(ticket, status))) {
      clearPending(key, move);
      return;
    }
    const result = await actions.move(
      { environmentId: ticket.environmentId, ticketId: ticket.id },
      { expectedRevision: ticket.revision, statusId: status.id, sortKey },
    );
    if (result !== null && result !== TICKET_REVISION_CONFLICT) return;
    clearPending(key, move);
    if (result === TICKET_REVISION_CONFLICT) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `${formatTicketRef(ticket)} changed elsewhere`,
          description: "The board shows its latest version. Move it again if you still want to.",
        }),
      );
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const ticket = ticketsByKey.get(String(event.active.id));
    const target = targetFor(event.active, event.over);
    setActiveKey(null);
    setDropTarget(null);
    if (ticket !== undefined && target !== null) void drop(ticket, target);
  };

  const activeTicket = activeKey === null ? undefined : ticketsByKey.get(activeKey);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={visibleDroppableUnderPointer}
      onDragStart={(event) => setActiveKey(String(event.active.id))}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveKey(null);
        setDropTarget(null);
      }}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-4">
        {columns.map((column) => {
          const collapsed = props.collapsedOverrides.get(column.key) ?? column.collapsedByDefault;
          return (
            <TicketColumn
              key={column.key}
              column={column}
              collapsed={collapsed}
              dropSlot={dropTarget?.columnKey === column.key ? dropTarget.slot : null}
              movingKeys={movingKeys}
              projectByKey={props.projectByKey}
              onToggle={props.onToggleColumn}
              onOpen={props.onOpen}
            />
          );
        })}
      </div>
      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
        {activeTicket === undefined ? null : (
          <div data-ticket-drag-overlay>
            <TicketCard
              ticket={activeTicket}
              status={statusSets
                .get(activeTicket.environmentId)
                ?.statuses.find((status) => status.id === activeTicket.statusId)}
              projectByKey={props.projectByKey}
              lifted
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

const TicketColumn = memo(function TicketColumn(props: {
  readonly column: TicketStatusGroup;
  readonly collapsed: boolean;
  readonly dropSlot: number | null;
  readonly movingKeys: ReadonlySet<string>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly onToggle: (group: TicketStatusGroup, collapsed: boolean) => void;
  readonly onOpen: (ticket: EnvironmentTicket) => void;
}) {
  const { column, collapsed, dropSlot } = props;
  const { setNodeRef } = useDroppable({ id: columnDroppableId(column.key) });
  const cardsId = useId();
  const dropTargeted = dropSlot !== null;
  const status = useMemo(
    () => ({ name: column.name, color: column.color, category: column.category }),
    [column.name, column.color, column.category],
  );
  // LegendList re-renders a mounted card only when its item or `extraData` changes.
  const { movingKeys, projectByKey } = props;
  const virtualizedCardInputs = useMemo(
    () => ({ dropSlot, movingKeys, projectByKey }),
    [dropSlot, movingKeys, projectByKey],
  );
  const renderCard = (ticket: EnvironmentTicket, index: number) => (
    <DraggableTicketCard
      ticket={ticket}
      status={status}
      moving={movingKeys.has(keyOf(ticket))}
      dropLine={
        dropSlot === index
          ? "before"
          : dropSlot === column.tickets.length && index === column.tickets.length - 1
            ? "after"
            : null
      }
      projectByKey={projectByKey}
      onOpen={props.onOpen}
    />
  );
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.parentElement?.toggleAttribute("data-instant", event.detail === 0);
    props.onToggle(column, collapsed);
  };

  return (
    <section
      ref={setNodeRef}
      data-ticket-drop={columnDroppableId(column.key)}
      data-kanban-column=""
      data-collapsed={collapsed ? "" : undefined}
      data-drop-target={dropTargeted ? "" : undefined}
      aria-label={column.name}
    >
      <button
        type="button"
        data-kanban-toggle=""
        className="text-xs font-medium text-muted-foreground"
        aria-expanded={!collapsed}
        aria-controls={cardsId}
        aria-label={`${column.name}, ${column.tickets.length} tickets`}
        onClick={toggle}
      >
        <span data-kanban-face="open" aria-hidden={collapsed || undefined}>
          <TicketStatusIcon color={column.color} category={column.category} />
          <span data-kanban-name="" className="text-foreground">
            {column.name}
          </span>
          <span className="tabular-nums">{column.tickets.length}</span>
          <ChevronLeftIcon data-kanban-chevron="" aria-hidden className="size-3.5 shrink-0" />
        </span>
        <span data-kanban-face="rail" aria-hidden={!collapsed || undefined}>
          <TicketStatusIcon color={column.color} category={column.category} />
          <ChevronRightIcon data-kanban-chevron="" aria-hidden className="size-3.5 shrink-0" />
          <span className="tabular-nums">{column.tickets.length}</span>
          <span data-kanban-name="" className="text-foreground">
            {column.name}
          </span>
        </span>
      </button>
      <div
        id={cardsId}
        data-kanban-column-cards=""
        inert={collapsed}
        aria-hidden={collapsed || undefined}
      >
        {dropTargeted && column.tickets.length === 0 ? <DropLine position="before" /> : null}
        {column.tickets.length > VIRTUALIZE_AFTER ? (
          <LegendList<EnvironmentTicket>
            data={column.tickets}
            keyExtractor={keyOf}
            estimatedItemSize={CARD_HEIGHT_ESTIMATE}
            getFixedItemSize={() => CARD_HEIGHT_ESTIMATE}
            drawDistance={CARD_HEIGHT_ESTIMATE * 6}
            extraData={virtualizedCardInputs}
            style={{ height: "100%" }}
            renderItem={({ item, index }) => renderCard(item, index)}
          />
        ) : (
          <div data-kanban-list="">
            {column.tickets.map((ticket, index) => (
              <div key={keyOf(ticket)}>{renderCard(ticket, index)}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

const DraggableTicketCard = memo(function DraggableTicketCard(props: {
  readonly ticket: EnvironmentTicket;
  readonly status: Pick<TicketStatusDefinition, "name" | "color" | "category">;
  readonly moving: boolean;
  readonly dropLine: "before" | "after" | null;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly onOpen: (ticket: EnvironmentTicket) => void;
}) {
  const id = keyOf(props.ticket);
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, disabled: props.moving });
  const { setNodeRef: setDropNodeRef } = useDroppable({ id });
  return (
    <div ref={setDropNodeRef} data-ticket-drop={id} className="relative px-2 py-1">
      {props.dropLine === null ? null : <DropLine position={props.dropLine} />}
      <div ref={setNodeRef} {...listeners} className={cn(isDragging && "opacity-40")}>
        <TicketCard
          ticket={props.ticket}
          status={props.status}
          projectByKey={props.projectByKey}
          onOpen={props.onOpen}
        />
      </div>
    </div>
  );
});

function DropLine(props: { readonly position: "before" | "after" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary",
        props.position === "before" ? "top-0" : "bottom-0",
      )}
    />
  );
}

const TicketCard = memo(function TicketCard(props: {
  readonly ticket: EnvironmentTicket;
  readonly status: Pick<TicketStatusDefinition, "name" | "color" | "category"> | undefined;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly onOpen?: (ticket: EnvironmentTicket) => void;
  readonly lifted?: boolean;
}) {
  const { ticket, onOpen } = props;
  return (
    <button
      type="button"
      onClick={onOpen === undefined ? undefined : () => onOpen(ticket)}
      className={cn(
        "flex h-36 w-full min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-card p-2.5 text-left text-sm shadow-xs outline-none hover:border-border hover:bg-accent/30 focus-visible:ring-1 focus-visible:ring-ring",
        props.lifted && "cursor-grabbing shadow-lg",
      )}
    >
      <span className="flex h-4 w-full shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <TicketStatusMark status={props.status} />
        <span className="font-mono tabular-nums">{formatTicketRef(ticket)}</span>
        <span className="ml-auto flex items-center gap-2">
          <TicketLinkCounts ticket={ticket} />
          <TicketAssignees ticket={ticket} />
        </span>
      </span>
      <span className="min-h-0 w-full flex-1">
        <span className="line-clamp-2 font-medium leading-5 text-foreground">{ticket.title}</span>
      </span>
      <span className="flex h-5 w-full shrink-0 items-center">
        <TicketTags ticket={ticket} projectByKey={props.projectByKey} />
      </span>
      <span className="flex w-full shrink-0 items-center gap-2">
        <span className="min-w-0 flex-1">
          <TicketSource ticket={ticket} />
        </span>
        <TicketUpdatedAt ticket={ticket} />
      </span>
    </button>
  );
});
