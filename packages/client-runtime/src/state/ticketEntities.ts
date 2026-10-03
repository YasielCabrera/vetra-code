import {
  EnvironmentId,
  type ScopedThreadRef,
  TicketId,
  type TicketStatusSet,
  type TicketSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { parseScopedThreadKey, scopedThreadKey } from "../environment/scoped.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";

export type EnvironmentTicket = TicketSummary & { readonly environmentId: EnvironmentId };

export interface ScopedTicketRef {
  readonly environmentId: EnvironmentId;
  readonly ticketId: TicketId;
}

/** `environmentId:ticketId`, the `/tickets/$ticketKey` param. */
export function ticketKey(ref: ScopedTicketRef): string {
  return `${ref.environmentId}:${ref.ticketId}`;
}

export function parseTicketKey(key: string): ScopedTicketRef | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) return null;
  return {
    environmentId: EnvironmentId.make(key.slice(0, separatorIndex)),
    ticketId: TicketId.make(key.slice(separatorIndex + 1)),
  };
}

/** `null` for an environment whose server keeps no tickets. */
type TicketSourceAtom<A> = (
  environmentId: EnvironmentId,
) => Atom.Atom<AsyncResult.AsyncResult<A, unknown> | null>;

export interface TicketBoardState {
  /** Every ticket across environments, in each environment's snapshot order. */
  readonly tickets: ReadonlyArray<EnvironmentTicket>;
  /** Status sets of the environments that keep tickets and have sent one. */
  readonly statusSets: ReadonlyMap<EnvironmentId, TicketStatusSet>;
  /** Environments whose server keeps tickets, connected or not. */
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  /** True once every ticket-keeping environment has sent its list, failed, or disconnected. */
  readonly loaded: boolean;
}

interface EnvironmentTicketList {
  readonly tickets: ReadonlyArray<EnvironmentTicket>;
  readonly byId: ReadonlyMap<string, EnvironmentTicket>;
}

const EMPTY_TICKETS: ReadonlyArray<EnvironmentTicket> = [];

/**
 * Per-environment ticket atoms plus the board that merges them. References stay stable: an
 * unchanged summary keeps its `EnvironmentTicket`, and an unchanged board keeps its arrays and map.
 */
export function createEnvironmentTicketAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly listAtom: TicketSourceAtom<ReadonlyMap<string, TicketSummary>>;
  readonly statusesAtom: TicketSourceAtom<TicketStatusSet>;
  /** True while the environment is unreachable, so the board stops waiting for its list. */
  readonly disconnectedAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean>;
}) {
  const environmentListAtom = Atom.family((environmentId: EnvironmentId) => {
    let scoped = new WeakMap<TicketSummary, EnvironmentTicket>();
    let previous: EnvironmentTicketList = { tickets: EMPTY_TICKETS, byId: new Map() };
    return Atom.make((get): EnvironmentTicketList => {
      const result = get(input.listAtom(environmentId));
      const summaries = result === null ? null : Option.getOrNull(AsyncResult.value(result));
      const nextScoped = new WeakMap<TicketSummary, EnvironmentTicket>();
      const tickets = [...(summaries?.values() ?? [])].map((summary) => {
        const ticket = scoped.get(summary) ?? { ...summary, environmentId };
        nextScoped.set(summary, ticket);
        return ticket;
      });
      scoped = nextScoped;
      if (!arrayElementsEqual(previous.tickets, tickets)) {
        previous = { tickets, byId: new Map(tickets.map((ticket) => [ticket.id, ticket])) };
      }
      return previous;
    }).pipe(Atom.withLabel(`environment-ticket-list:${environmentId}`));
  });

  const environmentTicketsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => get(environmentListAtom(environmentId)).tickets).pipe(
      Atom.withLabel(`environment-tickets:${environmentId}`),
    ),
  );

  const statusSetAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): TicketStatusSet | null => {
      const statuses = get(input.statusesAtom(environmentId));
      return statuses === null ? null : Option.getOrNull(AsyncResult.value(statuses));
    }).pipe(Atom.withLabel(`environment-ticket-statuses:${environmentId}`)),
  );

  /** Tickets linking one thread, keyed by `scopedThreadKey`. */
  const threadTicketsAtomFamily = Atom.family((key: string) => {
    const ref = parseScopedThreadKey(key);
    let previous = EMPTY_TICKETS;
    return Atom.make((get) => {
      if (ref === null) return EMPTY_TICKETS;
      const next = get(environmentTicketsAtom(ref.environmentId)).filter((ticket) =>
        ticket.linkRefs.some((link) => link.kind === "thread" && link.targetKey === ref.threadId),
      );
      if (!arrayElementsEqual(previous, next)) previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-tickets:${key}`));
  });

  let previousBoard: TicketBoardState = {
    tickets: [],
    statusSets: new Map(),
    environmentIds: [],
    loaded: false,
  };
  const boardAtom = Atom.make((get): TicketBoardState => {
    const tickets: EnvironmentTicket[] = [];
    const statusSets = new Map<EnvironmentId, TicketStatusSet>();
    const environmentIds: EnvironmentId[] = [];
    let loaded = true;
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const list = get(input.listAtom(environmentId));
      if (list === null) continue;
      environmentIds.push(environmentId);
      if (
        Option.isNone(AsyncResult.value(list)) &&
        !AsyncResult.isFailure(list) &&
        !get(input.disconnectedAtom(environmentId))
      ) {
        loaded = false;
      }
      tickets.push(...get(environmentTicketsAtom(environmentId)));
      const statusSet = get(statusSetAtom(environmentId));
      if (statusSet !== null) statusSets.set(environmentId, statusSet);
    }
    const sameStatusSets =
      statusSets.size === previousBoard.statusSets.size &&
      [...statusSets].every(([id, set]) => previousBoard.statusSets.get(id) === set);
    const sameTickets = arrayElementsEqual(previousBoard.tickets, tickets);
    const sameEnvironmentIds = arrayElementsEqual(previousBoard.environmentIds, environmentIds);
    if (loaded === previousBoard.loaded && sameTickets && sameEnvironmentIds && sameStatusSets) {
      return previousBoard;
    }
    previousBoard = {
      tickets: sameTickets ? previousBoard.tickets : tickets,
      statusSets: sameStatusSets ? previousBoard.statusSets : statusSets,
      environmentIds: sameEnvironmentIds ? previousBoard.environmentIds : environmentIds,
      loaded,
    };
    return previousBoard;
  }).pipe(Atom.withLabel("environment-ticket-board"));

  const ticketAtomFamily = Atom.family((key: string) => {
    const ref = parseTicketKey(key);
    return Atom.make((get): EnvironmentTicket | null =>
      ref === null
        ? null
        : (get(environmentListAtom(ref.environmentId)).byId.get(ref.ticketId) ?? null),
    ).pipe(Atom.withLabel(`environment-ticket:${key}`));
  });

  return {
    boardAtom,
    environmentTicketsAtom,
    statusSetAtom,
    ticketAtom: (ref: ScopedTicketRef) => ticketAtomFamily(ticketKey(ref)),
    threadTicketsAtom: (ref: ScopedThreadRef) => threadTicketsAtomFamily(scopedThreadKey(ref)),
  };
}
