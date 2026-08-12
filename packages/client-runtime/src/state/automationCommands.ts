import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import { createAtomCommandScheduler, createEnvironmentCommand } from "./runtime.ts";
import {
  type ClaimAutomationRunInput,
  type CreateAutomationInput,
  type DeleteAutomationInput,
  type DisableAutomationInput,
  type EnableAutomationInput,
  type UpdateAutomationInput,
  claimAutomationRun,
  createAutomation,
  deleteAutomation,
  disableAutomation,
  enableAutomation,
  updateAutomation,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export type {
  ClaimAutomationRunInput,
  CreateAutomationInput,
  DeleteAutomationInput,
  DisableAutomationInput,
  EnableAutomationInput,
  UpdateAutomationInput,
} from "../operations/commands.ts";

export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
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
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:create",
      execute: (input: CreateAutomationInput) => createAutomation(input),
      scheduler,
      concurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:update",
      execute: (input: UpdateAutomationInput) => updateAutomation(input),
      scheduler,
      concurrency,
    }),
    enable: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:enable",
      execute: (input: EnableAutomationInput) => enableAutomation(input),
      scheduler,
      concurrency,
    }),
    disable: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:disable",
      execute: (input: DisableAutomationInput) => disableAutomation(input),
      scheduler,
      concurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:delete",
      execute: (input: DeleteAutomationInput) => deleteAutomation(input),
      scheduler,
      concurrency,
    }),
    claimRun: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:claim-run",
      execute: (input: ClaimAutomationRunInput) => claimAutomationRun(input),
      scheduler,
      concurrency,
    }),
  };
}
