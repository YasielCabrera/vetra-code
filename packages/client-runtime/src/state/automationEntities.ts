import type {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationSnapshot,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";

/** An automation together with the environment whose server runs it. */
export interface EnvironmentAutomation extends Automation {
  readonly environmentId: EnvironmentId;
}

/** A run thread together with the environment that holds it. */
export interface EnvironmentAutomationRun extends AutomationRun {
  readonly environmentId: EnvironmentId;
}

export interface ScopedAutomationRef {
  readonly environmentId: EnvironmentId;
  readonly automationId: AutomationId;
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
 * Merges every environment's automation stream into workspace-wide lists.
 * `snapshotAtom` yields the live result of `automations.subscribe` for one
 * environment, or an initial result where the server offers none.
 */
export function createEnvironmentAutomationAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<AutomationSnapshot, unknown>>;
}) {
  const environmentSnapshotAtom = Atom.family((environmentId: EnvironmentId) => {
    let previousAutomations: ReadonlyArray<EnvironmentAutomation> = [];
    let previousRuns: ReadonlyArray<EnvironmentAutomationRun> = [];
    return Atom.make((get) => {
      const snapshot = Option.getOrNull(AsyncResult.value(get(input.snapshotAtom(environmentId))));
      const automations = (snapshot?.automations ?? []).map((automation) => ({
        ...automation,
        environmentId,
      }));
      const runs = (snapshot?.runs ?? []).map((run) => ({ ...run, environmentId }));
      if (!arrayElementsEqual(previousAutomations, automations)) previousAutomations = automations;
      if (!arrayElementsEqual(previousRuns, runs)) previousRuns = runs;
      return { automations: previousAutomations, runs: previousRuns };
    }).pipe(Atom.withLabel(`environment-automations:${environmentId}`));
  });

  let previousAutomations: ReadonlyArray<EnvironmentAutomation> = [];
  const automationsAtom = Atom.make((get) => {
    const next: EnvironmentAutomation[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      next.push(...get(environmentSnapshotAtom(environmentId)).automations);
    }
    if (arrayElementsEqual(previousAutomations, next)) return previousAutomations;
    previousAutomations = next;
    return next;
  }).pipe(Atom.withLabel("environment-automation-list"));

  let previousRunsByThreadKey: ReadonlyMap<string, EnvironmentAutomationRun> = new Map();
  /** Every run of a live automation, keyed by `automationRunKey`. */
  const runsByThreadKeyAtom = Atom.make((get) => {
    const next = new Map<string, EnvironmentAutomationRun>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      for (const run of get(environmentSnapshotAtom(environmentId)).runs) {
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
        get(environmentSnapshotAtom(environmentId)).automations.find(
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
