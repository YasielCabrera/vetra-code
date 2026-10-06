import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Run tracking for automations. The automations themselves are scheduled
 * tasks, read and changed through the scheduled-task atoms on the server
 * environment.
 */
export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** Every tracked run: a snapshot on subscribe, then after every change. */
    runsLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:automation-runs:live",
      tag: WS_METHODS.automationRunsSubscribe,
    }),
    setRunHidden: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:automation-run:set-hidden",
      tag: WS_METHODS.automationRunsSetHidden,
    }),
  };
}
