import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../../connection/runtime";
import { formatEnvironmentQueryError } from "../../state/query";

const remotesQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "tickets:project-remotes",
  tag: WS_METHODS.vcsListRemotes,
  staleTimeMs: 30_000,
  idleTtlMs: 30_000,
});

/** Keep one picker subscription so each row does not mount its own remote query. */
export function useTicketGitHubRemotes(projects: ReadonlyArray<EnvironmentProject>, open: boolean) {
  const state = useMemo(
    () =>
      Atom.make((get) => {
        let loading = false;
        const errors: string[] = [];
        const withRemotes = projects.map((project) => {
          const result = open
            ? get(
                remotesQuery({
                  environmentId: project.environmentId,
                  input: { cwd: project.workspaceRoot },
                }),
              )
            : null;
          loading ||= result !== null && (result.waiting || result._tag === "Initial");
          if (result?._tag === "Failure") {
            errors.push(`${project.title}: ${formatEnvironmentQueryError(result.cause)}`);
          }
          return {
            ...project,
            remotes:
              result === null ? [] : (Option.getOrNull(AsyncResult.value(result))?.remotes ?? []),
          };
        });
        return { projects: withRemotes, loading, errors };
      }),
    [projects, open],
  );
  return useAtomValue(state);
}
