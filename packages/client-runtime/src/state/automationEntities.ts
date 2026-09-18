import type {
  AutomationId,
  EnvironmentId,
  OrchestrationAutomation,
  OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";

const EMPTY_AUTOMATIONS: ReadonlyArray<OrchestrationAutomation> = Object.freeze([]);

/** An automation together with the environment whose server runs it. */
export interface EnvironmentAutomation extends OrchestrationAutomation {
  readonly environmentId: EnvironmentId;
}

export interface ScopedAutomationRef {
  readonly environmentId: EnvironmentId;
  readonly automationId: AutomationId;
}

export function automationKey(ref: ScopedAutomationRef): string {
  return `${ref.environmentId}:${ref.automationId}`;
}

/**
 * Automations arrive on the shell snapshot, so these read the same cached,
 * live-updating source as projects and thread shells — one projection, not a
 * second fetch path.
 */
export function createEnvironmentAutomationAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const environmentAutomationsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<EnvironmentAutomation> = [];
    return Atom.make((get): ReadonlyArray<EnvironmentAutomation> => {
      const automations = get(input.snapshotAtom(environmentId))?.automations ?? EMPTY_AUTOMATIONS;
      const next = automations.map((automation) => ({ ...automation, environmentId }));
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-automations:${environmentId}`));
  });

  let previousAutomations: ReadonlyArray<EnvironmentAutomation> = [];
  const automationsAtom = Atom.make((get) => {
    const next: EnvironmentAutomation[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      next.push(...get(environmentAutomationsAtom(environmentId)));
    }
    if (arrayElementsEqual(previousAutomations, next)) {
      return previousAutomations;
    }
    previousAutomations = next;
    return next;
  }).pipe(Atom.withLabel("environment-automation-list"));

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
    environmentAutomationsAtom,
    automationsAtom,
    automationAtom: (ref: ScopedAutomationRef) => automationAtomFamily(automationKey(ref)),
  };
}
