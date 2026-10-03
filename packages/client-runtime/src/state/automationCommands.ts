import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  // Serialized per automation: a pause landing between an edit and a Run now
  // would leave the user looking at a state neither of them asked for.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { automationId: string } }) =>
      JSON.stringify([environmentId, input.automationId]),
  };
  return {
    /** Live automations and their runs: a snapshot on subscribe, then after every change. */
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:automations:live",
      tag: WS_METHODS.automationsSubscribe,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:create",
      tag: WS_METHODS.automationsCreate,
      scheduler,
      concurrency,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:update",
      tag: WS_METHODS.automationsUpdate,
      scheduler,
      concurrency,
    }),
    enable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:enable",
      tag: WS_METHODS.automationsEnable,
      scheduler,
      concurrency,
    }),
    disable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:disable",
      tag: WS_METHODS.automationsDisable,
      scheduler,
      concurrency,
    }),
    delete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:delete",
      tag: WS_METHODS.automationsDelete,
      scheduler,
      concurrency,
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:run-now",
      tag: WS_METHODS.automationsRunNow,
      scheduler,
      concurrency,
    }),
    setRunHidden: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation:set-run-hidden",
      tag: WS_METHODS.automationsSetRunHidden,
    }),
  };
}
