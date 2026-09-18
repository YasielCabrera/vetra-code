import type { EnvironmentId, PowerhouseProjectLocation } from "@t3tools/contracts";
import { useMemo } from "react";

import { powerhouseEnvironment } from "~/state/powerhouse";
import { useEnvironmentQuery } from "~/state/query";

const NO_PROJECTS: ReadonlyArray<PowerhouseProjectLocation> = [];

export interface PowerhouseProjectsState {
  /**
   * - `found`: at least one Powerhouse project in the workspace.
   * - `none`: none, so the panel stays hidden.
   * - `loading`: discovery has not settled.
   * - `error`: discovery failed before returning any projects.
   */
  readonly status: "loading" | "none" | "found" | "error";
  /**
   * Every project found, workspace root first. A monorepo commonly keeps the
   * Powerhouse app under `apps/<name>`, so this is not always one entry, and it
   * is not always the workspace root.
   */
  readonly projects: ReadonlyArray<PowerhouseProjectLocation>;
  readonly isPowerhouseWorkspace: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

/**
 * Powerhouse projects in the open workspace.
 *
 * Discovery is a server call rather than a config-file read because the project
 * is not always at the workspace root: finding it means scanning below the root,
 * which the client cannot do.
 */
export function usePowerhouseProjects(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): PowerhouseProjectsState {
  const query = useEnvironmentQuery(
    environmentId !== null && cwd !== null
      ? powerhouseEnvironment.projects({ environmentId, input: { cwd } })
      : null,
  );
  const projects = query.data?.projects ?? null;
  const isPending = query.isPending;
  const error = query.error;
  const refresh = query.refresh;
  return useMemo(() => {
    if (projects === null) {
      return {
        status: isPending ? "loading" : error === null ? "none" : "error",
        projects: NO_PROJECTS,
        isPowerhouseWorkspace: false,
        error,
        refresh,
      } as const;
    }
    return {
      status: projects.length > 0 ? "found" : "none",
      projects,
      isPowerhouseWorkspace: projects.length > 0,
      error,
      refresh,
    } as const;
  }, [error, isPending, projects, refresh]);
}

/** The project to show: the user's pick when it still exists, otherwise the first. */
export function resolveSelectedProject(
  projects: ReadonlyArray<PowerhouseProjectLocation>,
  selectedPath: string | null,
): PowerhouseProjectLocation | null {
  if (projects.length === 0) return null;
  if (selectedPath !== null) {
    const match = projects.find((project) => project.path === selectedPath);
    if (match !== undefined) return match;
  }
  return projects[0] ?? null;
}
