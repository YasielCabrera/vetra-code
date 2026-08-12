import { useAtomValue } from "@effect/atom-react";
import {
  createAutomationEnvironmentAtoms,
  createEnvironmentAutomationAtoms,
  type EnvironmentAutomation,
  type ScopedAutomationRef,
} from "@vetra-studio/client-runtime/state/automations";
import type { EnvironmentId } from "@vetra-studio/contracts";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "./server";
import { environmentSnapshotAtom } from "./shell";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime);
export const environmentAutomations = createEnvironmentAutomationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});

const EMPTY_AUTOMATION_ATOM = Atom.make<EnvironmentAutomation | null>(null).pipe(
  Atom.withLabel("web-automation:empty"),
);

/** Every automation across connected environments, in creation order. */
export function useAutomations(): ReadonlyArray<EnvironmentAutomation> {
  return useAtomValue(environmentAutomations.automationsAtom);
}

export function useAutomation(ref: ScopedAutomationRef | null): EnvironmentAutomation | null {
  return useAtomValue(
    ref === null ? EMPTY_AUTOMATION_ATOM : environmentAutomations.automationAtom(ref),
  );
}

/** Whether this environment's server understands the automation commands.
    False for pre-automation servers, so clients offer none for them rather
    than dispatching commands that would be rejected. */
export function readEnvironmentSupportsAutomations(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .automations === true
  );
}

export function useEnvironmentSupportsAutomations(environmentId: EnvironmentId | null): boolean {
  const configs = useAtomValue(environmentServerConfigsAtom);
  if (environmentId === null) return false;
  return configs.get(environmentId)?.environment.capabilities.automations === true;
}
