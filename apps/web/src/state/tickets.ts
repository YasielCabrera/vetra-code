import { useAtomValue } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentTicketAtoms,
  createTicketEnvironmentAtoms,
  type EnvironmentTicket,
  type ScopedTicketRef,
  type TicketBoardState,
} from "@t3tools/client-runtime/state/tickets";
import type {
  EnvironmentId,
  ScopedThreadRef,
  TicketDetail,
  TicketGitHubSource,
  TicketStatusSet,
  TicketSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "./server";

export const ticketEnvironment = createTicketEnvironmentAtoms(connectionAtomRuntime);

const supportsTicketsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities.tickets ===
      true,
  ).pipe(Atom.withLabel(`web-tickets:supported:${environmentId}`)),
);

const ticketListAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<ReadonlyMap<string, TicketSummary>, unknown> | null =>
    get(supportsTicketsAtom(environmentId))
      ? get(ticketEnvironment.listLive({ environmentId, input: {} }))
      : null,
  ).pipe(Atom.withLabel(`web-tickets:list:${environmentId}`)),
);

const ticketStatusesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<TicketStatusSet, unknown> | null =>
    get(supportsTicketsAtom(environmentId))
      ? get(ticketEnvironment.statusesLive({ environmentId, input: {} }))
      : null,
  ).pipe(Atom.withLabel(`web-tickets:statuses:${environmentId}`)),
);

const ticketGitHubSourcesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<TicketGitHubSource> => {
    if (!get(supportsTicketsAtom(environmentId))) return [];
    const result = get(ticketEnvironment.githubSourcesLive({ environmentId, input: {} }));
    return Option.getOrNull(AsyncResult.value(result))?.sources ?? [];
  }).pipe(Atom.withLabel(`web-tickets:github-sources:${environmentId}`)),
);

export type EnvironmentTicketGitHubSource = TicketGitHubSource & {
  readonly environmentId: EnvironmentId;
};

const allTicketGitHubSourcesAtom = Atom.make((get) =>
  [...get(environmentCatalog.catalogValueAtom).entries.keys()].flatMap((environmentId) =>
    get(ticketGitHubSourcesAtom(environmentId)).map((source): EnvironmentTicketGitHubSource => ({
      ...source,
      environmentId,
    })),
  ),
).pipe(Atom.withLabel("web-tickets:github-sources"));

const environmentDisconnectedAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      connectionProjectionPhase(
        Option.getOrElse(
          AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
          () => AVAILABLE_CONNECTION_STATE,
        ),
      ) === "disconnected",
  ).pipe(Atom.withLabel(`web-tickets:disconnected:${environmentId}`)),
);

const environmentTickets = createEnvironmentTicketAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  listAtom: ticketListAtom,
  statusesAtom: ticketStatusesAtom,
  disconnectedAtom: environmentDisconnectedAtom,
});

const FALSE_ATOM = Atom.make(false).pipe(Atom.withLabel("web-tickets:false"));
const NO_TICKETS: ReadonlyArray<EnvironmentTicket> = [];
const NO_TICKETS_ATOM = Atom.make(NO_TICKETS).pipe(Atom.withLabel("web-tickets:none"));
const NO_STATUSES_ATOM = Atom.make<TicketStatusSet | null>(null).pipe(
  Atom.withLabel("web-tickets:no-statuses"),
);
const EMPTY_TICKET_ATOM = Atom.make<EnvironmentTicket | null>(null).pipe(
  Atom.withLabel("web-ticket:empty"),
);
const EMPTY_DETAIL_ATOM = Atom.make<AsyncResult.AsyncResult<TicketDetail, unknown>>(
  AsyncResult.initial(false),
).pipe(Atom.withLabel("web-ticket-detail:empty"));

export function useTickets(): TicketBoardState {
  return useAtomValue(environmentTickets.boardAtom);
}

/** The board as of now, for event handlers that should not re-render on every change. */
export function readTicketBoard(): TicketBoardState {
  return appAtomRegistry.get(environmentTickets.boardAtom);
}

export function useTicket(ref: ScopedTicketRef | null): EnvironmentTicket | null {
  return useAtomValue(ref === null ? EMPTY_TICKET_ATOM : environmentTickets.ticketAtom(ref));
}

/**
 * Body, links, attachments and activity; subscribed only while a caller is mounted and only on an
 * environment whose server keeps tickets.
 */
export function useTicketDetail(
  ref: ScopedTicketRef | null,
): AsyncResult.AsyncResult<TicketDetail, unknown> {
  const supported = useEnvironmentSupportsTickets(ref?.environmentId ?? null);
  return useAtomValue(
    ref === null || !supported
      ? EMPTY_DETAIL_ATOM
      : ticketEnvironment.detailLive({
          environmentId: ref.environmentId,
          input: { ticketId: ref.ticketId },
        }),
  );
}

export function useTicketsForThread(ref: ScopedThreadRef | null): ReadonlyArray<EnvironmentTicket> {
  return useAtomValue(ref === null ? NO_TICKETS_ATOM : environmentTickets.threadTicketsAtom(ref));
}

/** One environment's tickets; pass null to unsubscribe, as the `#` picker does while closed. */
export function useEnvironmentTickets(
  environmentId: EnvironmentId | null,
): ReadonlyArray<EnvironmentTicket> {
  return useAtomValue(
    environmentId === null
      ? NO_TICKETS_ATOM
      : environmentTickets.environmentTicketsAtom(environmentId),
  );
}

export function useTicketStatuses(environmentId: EnvironmentId | null): TicketStatusSet | null {
  return useAtomValue(
    environmentId === null ? NO_STATUSES_ATOM : environmentTickets.statusSetAtom(environmentId),
  );
}

export function useEnvironmentSupportsTickets(environmentId: EnvironmentId | null): boolean {
  return useAtomValue(environmentId === null ? FALSE_ATOM : supportsTicketsAtom(environmentId));
}

export function readEnvironmentSupportsTickets(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(supportsTicketsAtom(environmentId));
}

/** Every environment's GitHub sources, subscribed while a caller is mounted. */
export function useTicketGitHubSources(): ReadonlyArray<EnvironmentTicketGitHubSource> {
  return useAtomValue(allTicketGitHubSourcesAtom);
}
