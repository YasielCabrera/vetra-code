import { useAtomValue } from "@effect/atom-react";
import {
  automationRunKey,
  createAutomationEnvironmentAtoms,
  createEnvironmentAutomationAtoms,
  type EnvironmentAutomation,
  type EnvironmentAutomationRun,
  type ScopedAutomationRef,
} from "@t3tools/client-runtime/state/automations";
import type { AutomationSnapshot, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "./server";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime);

/** Subscribes only where the server offers automations, so an older server
    is never sent an RPC it would reject. */
const automationSnapshotAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<AutomationSnapshot, unknown> => {
    const supported =
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities.automations ===
      true;
    if (!supported) return AsyncResult.initial(false);
    return get(automationEnvironment.live({ environmentId, input: {} }));
  }).pipe(Atom.withLabel(`web-automations:snapshot:${environmentId}`)),
);

export const environmentAutomations = createEnvironmentAutomationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: automationSnapshotAtom,
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

export type AutomationRunsByThreadKey = ReadonlyMap<string, EnvironmentAutomationRun>;

/** Every run thread across environments, keyed by `scopedThreadKey`. */
export function useAutomationRunsByThreadKey(): AutomationRunsByThreadKey {
  return useAtomValue(environmentAutomations.runsByThreadKeyAtom);
}

export function readAutomationRun(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: EnvironmentAutomationRun["threadId"];
}): EnvironmentAutomationRun | null {
  return (
    appAtomRegistry
      .get(environmentAutomations.runsByThreadKeyAtom)
      .get(automationRunKey({ environmentId: thread.environmentId, threadId: thread.id })) ?? null
  );
}

/** A run still hidden from the sidebar; it is reachable from its automation. */
export function isHiddenAutomationRun(
  runs: AutomationRunsByThreadKey,
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: EnvironmentAutomationRun["threadId"];
  },
): boolean {
  const run = runs.get(
    automationRunKey({ environmentId: thread.environmentId, threadId: thread.id }),
  );
  return run !== undefined && run.hiddenAt !== null;
}

/** Projects automations own under Vetra home, keyed `environmentId:projectId`.
    Project listings and pickers leave these out. */
export function useAutomationOwnedProjectKeys(): ReadonlySet<string> {
  return useAtomValue(automationOwnedProjectKeysAtom);
}

let previousOwnedProjectKeys: ReadonlySet<string> = new Set();
export const automationOwnedProjectKeysAtom = Atom.make((get) => {
  const next = new Set<string>();
  for (const automation of get(environmentAutomations.automationsAtom)) {
    if (automation.ownsProject) {
      next.add(automationOwnedProjectKey(automation.environmentId, automation.projectId));
    }
  }
  if (
    next.size === previousOwnedProjectKeys.size &&
    [...next].every((key) => previousOwnedProjectKeys.has(key))
  ) {
    return previousOwnedProjectKeys;
  }
  previousOwnedProjectKeys = next;
  return next;
}).pipe(Atom.withLabel("web-automations:owned-projects"));

export function automationOwnedProjectKey(environmentId: EnvironmentId, projectId: ProjectId) {
  return `${environmentId}:${projectId}`;
}

/** Whether this environment's server serves the automation RPCs. False for
    pre-automation servers, so clients offer none for them. */
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
