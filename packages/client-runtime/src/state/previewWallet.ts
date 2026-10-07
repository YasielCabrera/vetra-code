import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * The preview wallet each environment's server holds. Key `status` with
 * `{ environmentId, input: {} }`: every wallet chip and Settings share that one
 * subscription, and pushes after each change keep it current, mutations included.
 */
export function createPreviewWalletEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:preview-wallet:status",
      tag: WS_METHODS.previewWalletSubscribe,
    }),
    configure: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:preview-wallet:configure",
      tag: WS_METHODS.previewWalletConfigure,
    }),
    approve: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:preview-wallet:approve",
      tag: WS_METHODS.previewWalletApprove,
    }),
    reject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:preview-wallet:reject",
      tag: WS_METHODS.previewWalletReject,
    }),
  };
}
