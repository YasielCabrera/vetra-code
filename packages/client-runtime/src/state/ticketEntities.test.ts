import {
  EnvironmentId,
  ThreadId,
  TicketId,
  TicketStatusId,
  type TicketStatusSet,
  type TicketSummary,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import {
  createEnvironmentTicketAtoms,
  parseTicketKey,
  resolveTicketBoardAvailability,
  resolveTicketEnvironmentState,
  ticketCapability,
  ticketKey,
  type TicketBoardAvailability,
  type TicketCapability,
  type TicketEnvironmentState,
} from "./ticketEntities.ts";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const THREAD_ID = ThreadId.make("thread-1");

type ListResult = AsyncResult.AsyncResult<ReadonlyMap<string, TicketSummary>, unknown> | null;

const summary = (id: string, title: string, threadId?: ThreadId): TicketSummary => ({
  kind: "local",
  id: TicketId.make(id),
  number: 1,
  homeProjectId: null,
  title,
  labels: [],
  statusId: TicketStatusId.make("todo"),
  sortKey: "a0",
  revision: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdBy: { type: "user" },
  linkRefs: threadId === undefined ? [] : [{ kind: "thread", targetKey: threadId }],
  attachmentCount: 0,
  plans: [],
});

const loadedList = (...tickets: TicketSummary[]): ListResult =>
  AsyncResult.success(new Map(tickets.map((ticket) => [ticket.id, ticket])));

const statusSet: TicketStatusSet = {
  statuses: [
    {
      id: TicketStatusId.make("todo"),
      name: "Todo",
      color: "gray",
      position: 0,
      category: "open",
      isDefault: true,
      collapsedByDefault: false,
    },
  ],
};

function makeHarness() {
  const lists = new Map([
    [ENV_A, Atom.make<ListResult>(AsyncResult.initial(true))],
    [ENV_B, Atom.make<ListResult>(AsyncResult.initial(true))],
  ]);
  const disconnected = new Map([
    [ENV_A, Atom.make(false)],
    [ENV_B, Atom.make(false)],
  ]);
  const statuses = Atom.make<AsyncResult.AsyncResult<TicketStatusSet, unknown> | null>(
    AsyncResult.success(statusSet),
  );
  const entry = (environmentId: EnvironmentId) => ({
    target: new PrimaryConnectionTarget({
      environmentId,
      label: environmentId,
      httpBaseUrl: `https://${environmentId}.example.test`,
      wsBaseUrl: `wss://${environmentId}.example.test`,
    }),
    profile: Option.none(),
    enabled: true,
  });
  const atoms = createEnvironmentTicketAtoms({
    catalogValueAtom: Atom.make({
      isReady: true,
      entries: new Map([
        [ENV_A, entry(ENV_A)],
        [ENV_B, entry(ENV_B)],
      ]),
    }),
    listAtom: (environmentId) => lists.get(environmentId)!,
    statusesAtom: () => statuses,
    disconnectedAtom: (environmentId) => disconnected.get(environmentId)!,
  });
  const registry = AtomRegistry.make();
  return {
    atoms,
    registry,
    setList: (environmentId: EnvironmentId, result: ListResult) =>
      registry.set(lists.get(environmentId)!, result),
    setDisconnected: (environmentId: EnvironmentId, value: boolean) =>
      registry.set(disconnected.get(environmentId)!, value),
  };
}

describe("ticket capability", () => {
  it.each<{
    capabilities: Parameters<typeof ticketCapability>[0];
    expected: TicketCapability;
  }>([
    { capabilities: undefined, expected: "unknown" },
    { capabilities: null, expected: "unknown" },
    { capabilities: {}, expected: "unsupported" },
    { capabilities: { tickets: false }, expected: "unsupported" },
    { capabilities: { tickets: true }, expected: "supported" },
  ])("classifies $capabilities as $expected", ({ capabilities, expected }) => {
    expect(ticketCapability(capabilities)).toBe(expected);
  });
});

describe("ticket environment state", () => {
  it.each<{
    name: string;
    input: Parameters<typeof resolveTicketEnvironmentState>[0];
    expected: TicketEnvironmentState;
  }>([
    {
      name: "waits for the catalog before declaring an environment unknown",
      input: { catalogReady: false, known: false, disconnected: false, capability: "unknown" },
      expected: "pending",
    },
    {
      name: "identifies an environment absent from a loaded catalog",
      input: { catalogReady: true, known: false, disconnected: false, capability: "supported" },
      expected: "unknown",
    },
    {
      name: "waits for capabilities on a known connected environment",
      input: { catalogReady: true, known: true, disconnected: false, capability: "unknown" },
      expected: "pending",
    },
    {
      name: "shows disconnection before uncached capabilities",
      input: { catalogReady: true, known: true, disconnected: true, capability: "unknown" },
      expected: "disconnected",
    },
    {
      name: "shows disconnection before cached unsupported capabilities",
      input: { catalogReady: true, known: true, disconnected: true, capability: "unsupported" },
      expected: "disconnected",
    },
    {
      name: "shows disconnection before cached supported capabilities",
      input: { catalogReady: true, known: true, disconnected: true, capability: "supported" },
      expected: "disconnected",
    },
    {
      name: "identifies explicit unsupported capabilities while connected",
      input: { catalogReady: true, known: true, disconnected: false, capability: "unsupported" },
      expected: "unsupported",
    },
    {
      name: "recovers a supported environment after reconnecting",
      input: { catalogReady: true, known: true, disconnected: false, capability: "supported" },
      expected: "supported",
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveTicketEnvironmentState(input)).toBe(expected);
  });
});

describe("ticket board availability", () => {
  it.each<{
    name: string;
    input: Parameters<typeof resolveTicketBoardAvailability>[0];
    expected: TicketBoardAvailability;
  }>([
    {
      name: "waits for catalog readiness",
      input: { catalogReady: false, environments: [] },
      expected: "pending",
    },
    {
      name: "treats a ready empty catalog as disconnected",
      input: { catalogReady: true, environments: [] },
      expected: "disconnected",
    },
    {
      name: "waits for an uncached config on a connected environment",
      input: {
        catalogReady: true,
        environments: [{ enabled: true, connectionPhase: "connected", capability: "unknown" }],
      },
      expected: "pending",
    },
    {
      name: "requires explicit unsupported capabilities on every connected environment",
      input: {
        catalogReady: true,
        environments: [
          { enabled: true, connectionPhase: "connected", capability: "unsupported" },
          { enabled: true, connectionPhase: "connected", capability: "unsupported" },
        ],
      },
      expected: "unsupported",
    },
    {
      name: "keeps a pending config distinct from another environment's unsupported config",
      input: {
        catalogReady: true,
        environments: [
          { enabled: true, connectionPhase: "connected", capability: "unsupported" },
          { enabled: true, connectionPhase: "connected", capability: "unknown" },
        ],
      },
      expected: "pending",
    },
    {
      name: "keeps uncached and cached offline environments disconnected",
      input: {
        catalogReady: true,
        environments: [
          { enabled: true, connectionPhase: "offline", capability: "unknown" },
          { enabled: true, connectionPhase: "offline", capability: "supported" },
          { enabled: true, connectionPhase: "error", capability: "unsupported" },
        ],
      },
      expected: "disconnected",
    },
    {
      name: "does not infer unsupported tickets while another environment is disconnected",
      input: {
        catalogReady: true,
        environments: [
          { enabled: true, connectionPhase: "connected", capability: "unsupported" },
          { enabled: true, connectionPhase: "offline", capability: "unknown" },
        ],
      },
      expected: "disconnected",
    },
    {
      name: "waits during reconnection even with a cached unsupported config",
      input: {
        catalogReady: true,
        environments: [
          { enabled: true, connectionPhase: "reconnecting", capability: "unsupported" },
        ],
      },
      expected: "pending",
    },
    {
      name: "shows a disconnected state for an available environment that has not connected",
      input: {
        catalogReady: true,
        environments: [{ enabled: true, connectionPhase: "available", capability: "unknown" }],
      },
      expected: "disconnected",
    },
    {
      name: "does not treat a disabled environment's cached support as connected",
      input: {
        catalogReady: true,
        environments: [{ enabled: false, connectionPhase: "connected", capability: "supported" }],
      },
      expected: "disconnected",
    },
    {
      name: "allows a connected supported environment to serve tickets while others recover",
      input: {
        catalogReady: true,
        environments: [
          { enabled: true, connectionPhase: "connecting", capability: "unknown" },
          { enabled: true, connectionPhase: "offline", capability: "supported" },
          { enabled: true, connectionPhase: "connected", capability: "supported" },
        ],
      },
      expected: "ready",
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveTicketBoardAvailability(input)).toBe(expected);
  });
});

describe("createEnvironmentTicketAtoms", () => {
  it("preserves confirmed support and cached tickets while an environment disconnects", () => {
    const harness = makeHarness();
    const unsubscribe = harness.registry.subscribe(harness.atoms.boardAtom, () => {});
    harness.setList(ENV_A, loadedList(summary("a", "Cached ticket")));
    harness.setList(ENV_B, null);
    const before = harness.registry.get(harness.atoms.boardAtom);
    harness.setDisconnected(ENV_A, true);
    const offline = harness.registry.get(harness.atoms.boardAtom);

    expect(offline.tickets.map((ticket) => ticket.title)).toEqual(["Cached ticket"]);
    expect(offline.environmentIds).toEqual([ENV_A]);
    expect(offline).toBe(before);

    unsubscribe();
    harness.registry.dispose();
  });

  it("settles the board once each environment has sent its list, failed, or disconnected", () => {
    const harness = makeHarness();
    const loaded = () => harness.registry.get(harness.atoms.boardAtom).loaded;
    const unsubscribe = harness.registry.subscribe(harness.atoms.boardAtom, () => {});

    expect(loaded()).toBe(false);
    harness.setList(ENV_A, loadedList(summary("a", "Alpha")));
    expect(loaded()).toBe(false);
    harness.setList(ENV_B, AsyncResult.failure(Cause.fail(new Error("offline"))));
    expect(loaded()).toBe(true);
    harness.setList(ENV_B, AsyncResult.initial(true));
    expect(loaded()).toBe(false);
    harness.setDisconnected(ENV_B, true);
    expect(loaded()).toBe(true);
    expect(harness.registry.get(harness.atoms.boardAtom).tickets.map((t) => t.title)).toEqual([
      "Alpha",
    ]);

    unsubscribe();
    harness.registry.dispose();
  });

  it("keeps the status map's reference when only tickets change", () => {
    const harness = makeHarness();
    const unsubscribe = harness.registry.subscribe(harness.atoms.boardAtom, () => {});
    harness.setList(ENV_A, loadedList(summary("a", "Alpha")));
    const before = harness.registry.get(harness.atoms.boardAtom);
    harness.setList(ENV_A, loadedList(summary("a", "Alpha 2")));
    const after = harness.registry.get(harness.atoms.boardAtom);

    expect(after.tickets.map((ticket) => ticket.title)).toEqual(["Alpha 2"]);
    expect(after.statusSets).toBe(before.statusSets);
    expect(after.environmentIds).toBe(before.environmentIds);

    unsubscribe();
    harness.registry.dispose();
  });

  it("reads one thread's tickets from its own environment and ignores unrelated changes", () => {
    const harness = makeHarness();
    const threadTickets = harness.atoms.threadTicketsAtom({
      environmentId: ENV_A,
      threadId: THREAD_ID,
    });
    const unsubscribe = harness.registry.subscribe(threadTickets, () => {});
    const linkedSummary = summary("a", "Linked", THREAD_ID);
    harness.setList(ENV_A, loadedList(linkedSummary, summary("b", "Other")));
    harness.setList(ENV_B, loadedList(summary("c", "Same thread id elsewhere", THREAD_ID)));
    const linked = harness.registry.get(threadTickets);
    harness.setList(ENV_A, loadedList(linkedSummary, summary("b", "Other 2")));

    expect(linked.map((ticket) => ticket.title)).toEqual(["Linked"]);
    expect(harness.registry.get(threadTickets)).toBe(linked);

    unsubscribe();
    harness.registry.dispose();
  });

  it("finds a ticket by its key", () => {
    const harness = makeHarness();
    const ref = { environmentId: ENV_B, ticketId: TicketId.make("c") };
    const ticket = harness.atoms.ticketAtom(ref);
    const unsubscribe = harness.registry.subscribe(ticket, () => {});
    harness.setList(ENV_B, loadedList(summary("c", "Gamma")));

    expect(harness.registry.get(ticket)?.title).toBe("Gamma");
    expect(parseTicketKey(ticketKey(ref))).toEqual(ref);
    expect(parseTicketKey("no-separator")).toBeNull();
    expect(parseTicketKey("env-a:")).toBeNull();

    unsubscribe();
    harness.registry.dispose();
  });
});
