import type {
  AutomationRun,
  AutomationRunsSnapshot,
  EnvironmentId,
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskListResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";

/** An automation (a scheduled task) together with the environment whose server runs it. */
export interface EnvironmentAutomation extends ScheduledTask {
  readonly environmentId: EnvironmentId;
}

/** A run thread together with the environment that holds it. */
export interface EnvironmentAutomationRun extends AutomationRun {
  readonly environmentId: EnvironmentId;
}

export interface ScopedAutomationRef {
  readonly environmentId: EnvironmentId;
  readonly automationId: ScheduledTaskId;
}

export function automationKey(ref: ScopedAutomationRef): string {
  return `${ref.environmentId}:${ref.automationId}`;
}

/** The run's `scopedThreadKey`, so a thread shell finds its run in one lookup. */
export function automationRunKey(run: {
  readonly environmentId: EnvironmentId;
  readonly threadId: AutomationRun["threadId"];
}): string {
  return scopedThreadKey(scopeThreadRef(run.environmentId, run.threadId));
}

/**
 * Merges every environment's scheduled tasks and tracked runs into
 * workspace-wide lists. Each atom yields that environment's live
 * subscription, or an initial result where it offers none.
 */
export function createEnvironmentAutomationAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly tasksAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<ScheduledTaskListResult, unknown>>;
  readonly runsAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<AutomationRunsSnapshot, unknown>>;
}) {
  const environmentAutomationsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<EnvironmentAutomation> = [];
    return Atom.make((get) => {
      const tasks = Option.getOrNull(AsyncResult.value(get(input.tasksAtom(environmentId))))?.tasks;
      const next = (tasks ?? [])
        .map((task) => ({ ...task, environmentId }))
        // Creation order, like the rest of the workspace's lists; upstream
        // sends most recently edited first.
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      if (!arrayElementsEqual(previous, next)) previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-automations:${environmentId}`));
  });

  const environmentRunsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<EnvironmentAutomationRun> = [];
    return Atom.make((get) => {
      const runs = Option.getOrNull(AsyncResult.value(get(input.runsAtom(environmentId))))?.runs;
      const next = (runs ?? []).map((run) => ({ ...run, environmentId }));
      if (!arrayElementsEqual(previous, next)) previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-automation-runs:${environmentId}`));
  });

  let previousAutomations: ReadonlyArray<EnvironmentAutomation> = [];
  const automationsAtom = Atom.make((get) => {
    const next: EnvironmentAutomation[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      next.push(...get(environmentAutomationsAtom(environmentId)));
    }
    if (arrayElementsEqual(previousAutomations, next)) return previousAutomations;
    previousAutomations = next;
    return next;
  }).pipe(Atom.withLabel("environment-automation-list"));

  let previousRunsByThreadKey: ReadonlyMap<string, EnvironmentAutomationRun> = new Map();
  /** Every tracked run, keyed by `automationRunKey`. */
  const runsByThreadKeyAtom = Atom.make((get) => {
    const next = new Map<string, EnvironmentAutomationRun>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      for (const run of get(environmentRunsAtom(environmentId))) {
        next.set(automationRunKey(run), run);
      }
    }
    if (
      next.size === previousRunsByThreadKey.size &&
      [...next].every(([key, run]) => previousRunsByThreadKey.get(key) === run)
    ) {
      return previousRunsByThreadKey;
    }
    previousRunsByThreadKey = next;
    return next;
  }).pipe(Atom.withLabel("environment-automation-runs"));

  const automationAtomFamily = Atom.family((key: string) =>
    Atom.make((get): EnvironmentAutomation | null => {
      const separatorIndex = key.indexOf(":");
      const environmentId = key.slice(0, separatorIndex) as EnvironmentId;
      const automationId = key.slice(separatorIndex + 1);
      return (
        get(environmentAutomationsAtom(environmentId)).find(
          (automation) => automation.id === automationId,
        ) ?? null
      );
    }).pipe(Atom.withLabel(`environment-automation:${key}`)),
  );

  return {
    automationsAtom,
    runsByThreadKeyAtom,
    automationAtom: (ref: ScopedAutomationRef) => automationAtomFamily(automationKey(ref)),
  };
}
