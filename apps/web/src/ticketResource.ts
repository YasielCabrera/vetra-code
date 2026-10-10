import {
  parseTicketKey,
  ticketKey,
  type ScopedTicketRef,
} from "@t3tools/client-runtime/state/tickets";
import { EnvironmentId, TicketId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type TicketResourceTarget =
  | { kind: "ticket"; ticketRef: ScopedTicketRef }
  | { kind: "ticket-plan"; ticketRef: ScopedTicketRef; planNumber: number };

export type TicketResourceSurface =
  | { id: `ticket:${string}`; kind: "ticket"; ticketRef: ScopedTicketRef }
  | {
      id: `ticket-plan:${string}`;
      kind: "ticket-plan";
      ticketRef: ScopedTicketRef;
      planNumber: number;
      startEditing?: true;
    };

const TicketRef = Schema.Struct({ environmentId: EnvironmentId, ticketId: TicketId });
const TicketResource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ticket"), ticketRef: TicketRef }),
  Schema.Struct({
    kind: Schema.Literal("ticket-plan"),
    ticketRef: TicketRef,
    planNumber: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
]);
const isTicketResource = Schema.is(TicketResource);

export function ticketResourceSurface(target: TicketResourceTarget): TicketResourceSurface {
  const key = encodeURIComponent(ticketKey(target.ticketRef));
  return target.kind === "ticket"
    ? { id: `ticket:${key}`, kind: target.kind, ticketRef: target.ticketRef }
    : {
        id: `ticket-plan:${key}:${target.planNumber}`,
        kind: target.kind,
        ticketRef: target.ticketRef,
        planNumber: target.planNumber,
      };
}

export function parseTicketResourceSurface(value: unknown): TicketResourceSurface | null {
  if (!isTicketResource(value)) return null;
  if (value.kind === "ticket-plan" && !Number.isSafeInteger(value.planNumber)) return null;
  return ticketResourceSurface(value);
}

export function parseTicketResourceHref(href: string, origin: string): TicketResourceTarget | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const match = /^\/tickets\/([^/]+)(?:\/plans\/([1-9]\d*))?\/?$/.exec(url.pathname);
  if (!match?.[1]) return null;
  let key: string;
  try {
    key = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const ticketRef = parseTicketKey(key);
  if (ticketRef === null) return null;
  if (match[2] === undefined) return { kind: "ticket", ticketRef };
  const planNumber = Number(match[2]);
  return Number.isSafeInteger(planNumber) ? { kind: "ticket-plan", ticketRef, planNumber } : null;
}

export function matchesTicketResource(
  surface: TicketResourceTarget,
  target: TicketResourceTarget,
): boolean {
  return (
    ticketKey(surface.ticketRef) === ticketKey(target.ticketRef) &&
    (target.kind === "ticket" ||
      (surface.kind === "ticket-plan" && surface.planNumber === target.planNumber))
  );
}
