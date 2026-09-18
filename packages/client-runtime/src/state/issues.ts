import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/** Read-only issue queries use the same environment-scoped RPC lifecycle as pull requests. */
export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:list",
      tag: WS_METHODS.issuesList,
      staleTimeMs: 30_000,
    }),
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:detail",
      tag: WS_METHODS.issuesDetail,
      staleTimeMs: 15_000,
    }),
    activity: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:activity",
      tag: WS_METHODS.issuesActivity,
      staleTimeMs: 15_000,
    }),
    /** Repository member lists are read only when somebody opens the assignee picker. */
    assigneeCandidates: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:assignee-candidates",
      tag: WS_METHODS.issuesAssigneeCandidates,
      staleTimeMs: 60_000,
    }),
    setAssignees: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:set-assignees",
      tag: WS_METHODS.issuesSetAssignees,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
      },
    }),
    invalidate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:invalidate",
      tag: WS_METHODS.issuesInvalidate,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
      },
    }),
  };
}
