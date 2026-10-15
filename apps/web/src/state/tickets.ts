import { useAtomValue } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@t3tools/client-runtime/connection";
import {
  createEnvironmentTicketAtoms,
  createTicketEnvironmentAtoms,
  resolveTicketEnvironmentState,
  ticketCapability,
  type EnvironmentTicket,
  type ScopedTicketRef,
  type TicketBoardState,
  type TicketCapability,
  type TicketEnvironmentState,
} from "@t3tools/client-runtime/state/tickets";
import type {
  EnvironmentId,
  ScopedThreadRef,
  TicketDetail,
  TicketGitHubSource,
  TicketPlan,
  TicketPlanId,
  TicketStatusSet,
  TicketSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "./server";

export const ticketEnvironment = createTicketEnvironmentAtoms(connectionAtomRuntime);

export function useTicketGitHubWriteAllowed(environmentId: EnvironmentId): boolean {
  return useAtomValue(ticketEnvironment.githubIssueSetAssignees.permissionAtom(environmentId));
}

export function readTicketGitHubWriteAllowed(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(
    ticketEnvironment.githubIssueSetAssignees.permissionAtom(environmentId),
  );
}

const supportsTicketIssueLinksAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
        .ticketIssueLinks === true,
  ),
);

export function useTicketIssueLinksSupported(environmentId: EnvironmentId): boolean {
  return useAtomValue(supportsTicketIssueLinksAtom(environmentId));
}

export const ticketCapabilityAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    ticketCapability(
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities,
    ),
  ).pipe(Atom.withLabel(`web-tickets:capability:${environmentId}`)),
);

const ticketListAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<ReadonlyMap<string, TicketSummary>, unknown> | null =>
    get(ticketCapabilityAtom(environmentId)) === "supported"
      ? get(ticketEnvironment.listLive({ environmentId, input: {} }))
      : null,
  ).pipe(Atom.withLabel(`web-tickets:list:${environmentId}`)),
);

const ticketStatusesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<TicketStatusSet, unknown> | null =>
    get(ticketCapabilityAtom(environmentId)) === "supported"
      ? get(ticketEnvironment.statusesLive({ environmentId, input: {} }))
      : null,
  ).pipe(Atom.withLabel(`web-tickets:statuses:${environmentId}`)),
);

const ticketGitHubSourcesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<TicketGitHubSource> => {
    if (get(ticketCapabilityAtom(environmentId)) !== "supported") return [];
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

export const ticketEnvironmentStateAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const catalog = get(environmentCatalog.catalogValueAtom);
    const known = catalog.entries.has(environmentId);
    return resolveTicketEnvironmentState({
      catalogReady: catalog.isReady,
      known,
      disconnected: known && get(environmentDisconnectedAtom(environmentId)),
      capability: get(ticketCapabilityAtom(environmentId)),
    });
  }).pipe(Atom.withLabel(`web-tickets:environment-state:${environmentId}`)),
);

const environmentTickets = createEnvironmentTicketAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  listAtom: ticketListAtom,
  statusesAtom: ticketStatusesAtom,
  disconnectedAtom: environmentDisconnectedAtom,
});

const UNKNOWN_CAPABILITY_ATOM = Atom.make<TicketCapability>("unknown").pipe(
  Atom.withLabel("web-tickets:unknown-capability"),
);
const UNKNOWN_ENVIRONMENT_STATE_ATOM = Atom.make<TicketEnvironmentState>("unknown").pipe(
  Atom.withLabel("web-tickets:unknown-environment"),
);
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

const EMPTY_PLAN_ATOM = Atom.make<AsyncResult.AsyncResult<TicketPlan, unknown>>(
  AsyncResult.initial(false),
).pipe(Atom.withLabel("web-ticket-plan:empty"));

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

/** One plan's body and comments, subscribed only while a caller is mounted. */
export function useTicketPlan(
  ref: { readonly environmentId: EnvironmentId; readonly planId: TicketPlanId } | null,
): AsyncResult.AsyncResult<TicketPlan, unknown> {
  const supported = useEnvironmentSupportsTickets(ref?.environmentId ?? null);
  return useAtomValue(
    ref === null || !supported
      ? EMPTY_PLAN_ATOM
      : ticketEnvironment.planLive({
          environmentId: ref.environmentId,
          input: { planId: ref.planId },
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
  return (
    useAtomValue(
      environmentId === null ? UNKNOWN_CAPABILITY_ATOM : ticketCapabilityAtom(environmentId),
    ) === "supported"
  );
}

export function useTicketEnvironmentState(
  environmentId: EnvironmentId | null,
): TicketEnvironmentState {
  return useAtomValue(
    environmentId === null
      ? UNKNOWN_ENVIRONMENT_STATE_ATOM
      : ticketEnvironmentStateAtom(environmentId),
  );
}

export function readEnvironmentSupportsTickets(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(ticketCapabilityAtom(environmentId)) === "supported";
}

/** Every environment's GitHub sources, subscribed while a caller is mounted. */
export function useTicketGitHubSources(): ReadonlyArray<EnvironmentTicketGitHubSource> {
  return useAtomValue(allTicketGitHubSourcesAtom);
}
