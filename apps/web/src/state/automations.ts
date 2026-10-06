import { useAtomValue } from "@effect/atom-react";
import {
  automationRunKey,
  createAutomationEnvironmentAtoms,
  createEnvironmentAutomationAtoms,
  type EnvironmentAutomation,
  type EnvironmentAutomationRun,
  type ScopedAutomationRef,
} from "@t3tools/client-runtime/state/automations";
import type {
  AutomationRunsSnapshot,
  EnvironmentId,
  ScheduledTaskListResult,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime);

/** Automations are scheduled tasks; every connected V2 server has them. */
const automationTasksAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<ScheduledTaskListResult, unknown> => {
    if (!get(environmentServerConfigsAtom).has(environmentId)) return AsyncResult.initial(false);
    return get(serverEnvironment.scheduledTasksLive({ environmentId, input: {} }));
  }).pipe(Atom.withLabel(`web-automations:tasks:${environmentId}`)),
);

/** Runs are tracked only by servers that say so; elsewhere they are plain threads. */
const automationRunsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): AsyncResult.AsyncResult<AutomationRunsSnapshot, unknown> => {
    const supported =
      get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities.automations ===
      true;
    if (!supported) return AsyncResult.initial(false);
    return get(automationEnvironment.runsLive({ environmentId, input: {} }));
  }).pipe(Atom.withLabel(`web-automations:runs:${environmentId}`)),
);

export const environmentAutomations = createEnvironmentAutomationAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  tasksAtom: automationTasksAtom,
  runsAtom: automationRunsAtom,
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

/** Whether this environment's server tracks automation runs, so a run can be
    moved in and out of the sidebar. */
export function readEnvironmentSupportsAutomations(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .automations === true
  );
}

export function useEnvironmentSupportsAutomations(environmentId: EnvironmentId | null): boolean {
  const configs = useAtomValue(environmentServerConfigsAtom);
  if (environmentId === null) return false;
  return configs.has(environmentId);
}
