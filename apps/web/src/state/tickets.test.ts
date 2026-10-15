import {
  AVAILABLE_CONNECTION_STATE,
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  type ConnectionTarget,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import { EnvironmentId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const environmentId = EnvironmentId.make("ticket-environment");
const missingId = EnvironmentId.make("missing-environment");

afterEach(() => {
  vi.doUnmock("../connection/catalog");
  vi.doUnmock("../connection/runtime");
  vi.doUnmock("./server");
  vi.resetModules();
});

async function makeHarness(target: ConnectionTarget) {
  const catalog = Atom.make<EnvironmentCatalogState>({ isReady: false, entries: new Map() });
  const configs = Atom.make<
    ReadonlyMap<EnvironmentId, { environment: { capabilities: { tickets?: boolean } } }>
  >(new Map());
  const connection = Atom.make<AsyncResult.AsyncResult<SupervisorConnectionState>>(
    AsyncResult.success(AVAILABLE_CONNECTION_STATE),
  );
  vi.doMock("../connection/catalog", () => ({
    environmentCatalog: { catalogValueAtom: catalog, stateAtom: () => connection },
  }));
  vi.doMock("../connection/runtime", () => ({
    connectionAtomRuntime: Atom.runtime(Layer.empty),
  }));
  vi.doMock("./server", () => ({ environmentServerConfigsAtom: configs }));
  const tickets = await import("./tickets");
  const registry = AtomRegistry.make();
  const stateAtom = tickets.ticketEnvironmentStateAtom(environmentId);
  const missingAtom = tickets.ticketEnvironmentStateAtom(missingId);
  const unsubscribe = registry.subscribe(stateAtom, () => {});
  const unsubscribeMissing = registry.subscribe(missingAtom, () => {});
  return {
    state: () => registry.get(stateAtom),
    missing: () => registry.get(missingAtom),
    capability: () => registry.get(tickets.ticketCapabilityAtom(environmentId)),
    setCatalog: () =>
      registry.set(catalog, {
        isReady: true,
        entries: new Map([[environmentId, { target, profile: Option.none(), enabled: true }]]),
      }),
    setConnection: (phase: SupervisorConnectionState["phase"]) =>
      registry.set(connection, AsyncResult.success({ ...AVAILABLE_CONNECTION_STATE, phase })),
    setConfig: (tickets?: boolean) =>
      registry.set(
        configs,
        new Map([
          [
            environmentId,
            { environment: { capabilities: tickets === undefined ? {} : { tickets } } },
          ],
        ]),
      ),
    dispose: () => {
      unsubscribe();
      unsubscribeMissing();
      registry.dispose();
    },
  };
}

describe("ticket environment atoms", () => {
  const targets = [
    new PrimaryConnectionTarget({
      environmentId,
      label: "Local",
      httpBaseUrl: "http://localhost:3000",
      wsBaseUrl: "ws://localhost:3000",
    }),
    new BearerConnectionTarget({ environmentId, label: "Tailscale", connectionId: "tailnet" }),
    new RelayConnectionTarget({ environmentId, label: "Relay" }),
  ];

  it.each(targets)(
    "recovers $label capability and availability without resubscribing",
    async (target) => {
      const harness = await makeHarness(target);
      try {
        expect(harness.state()).toBe("pending");
        expect(harness.missing()).toBe("pending");
        expect(harness.capability()).toBe("unknown");

        harness.setCatalog();
        expect(harness.missing()).toBe("unknown");
        expect(harness.state()).toBe("disconnected");

        harness.setConnection("connecting");
        expect(harness.state()).toBe("pending");
        harness.setConnection("connected");
        expect(harness.state()).toBe("pending");

        harness.setConfig();
        expect(harness.capability()).toBe("unsupported");
        expect(harness.state()).toBe("unsupported");
        harness.setConnection("offline");
        expect(harness.state()).toBe("disconnected");

        harness.setConfig(true);
        expect(harness.capability()).toBe("supported");
        expect(harness.state()).toBe("disconnected");
        harness.setConnection("connected");
        expect(harness.state()).toBe("supported");
      } finally {
        harness.dispose();
      }
    },
  );
});
