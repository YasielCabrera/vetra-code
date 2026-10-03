import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo } from "react";

import { readLocalApi } from "../localApi";
import { readAutomationRun } from "../state/automations";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../components/ui/toast";

/**
 * The three things you can do to an automation without opening it, shared by
 * the list's row menu and the automation's own page so a Run now from either
 * place means exactly the same thing.
 *
 * Each action reports its own failure and resolves to whether it happened, so
 * callers can navigate (or not) on the result.
 */
export interface AutomationActions {
  readonly runNow: (automation: EnvironmentAutomation) => Promise<boolean>;
  readonly setEnabled: (automation: EnvironmentAutomation, enabled: boolean) => Promise<boolean>;
  /**
   * Confirms first, spelling out what goes with it: hidden runs are archived,
   * runs moved to the sidebar stay. Resolves false when the user backs out.
   */
  readonly confirmAndDelete: (
    automation: EnvironmentAutomation,
    runThreads: ReadonlyArray<EnvironmentThreadShell>,
  ) => Promise<boolean>;
}

export function describeAutomationDeletion(input: { readonly revealedRunCount: number }): string {
  return input.revealedRunCount > 0
    ? `This deletes the automation and archives its hidden runs. The ${input.revealedRunCount} run(s) you moved to the sidebar stay.`
    : "This deletes the automation and archives its runs.";
}

export function useAutomationActions(): AutomationActions {
  const setAutomationEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const deleteAutomation = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    reportFailure: false,
  });
  const runAutomationNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    reportFailure: false,
  });

  /**
   * An atom command resolves with its failure rather than throwing, so every
   * action has to read the result. Reports and answers false unless the command
   * actually landed; an interrupted command is a newer one taking over, which
   * is not something to shout about.
   */
  const settled = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>): boolean => {
      if (result._tag !== "Failure") return true;
      if (isAtomCommandInterrupted(result)) return false;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return false;
    },
    [],
  );

  const runNow = useCallback(
    async (automation: EnvironmentAutomation) => {
      const result = await runAutomationNow({
        environmentId: automation.environmentId,
        input: { id: automation.id },
      });
      if (!settled("Could not start a run", result)) return false;
      toastManager.add({ type: "success", title: "Run started" });
      return true;
    },
    [runAutomationNow, settled],
  );

  const setEnabled = useCallback(
    async (automation: EnvironmentAutomation, enabled: boolean) => {
      const result = await setAutomationEnabled({
        environmentId: automation.environmentId,
        input: { id: automation.id, enabled },
      });
      return settled(enabled ? "Could not resume" : "Could not pause", result);
    },
    [setAutomationEnabled, settled],
  );

  const confirmAndDelete = useCallback(
    async (
      automation: EnvironmentAutomation,
      runThreads: ReadonlyArray<EnvironmentThreadShell>,
    ) => {
      const localApi = readLocalApi();
      if (localApi) {
        const confirmed = await localApi.dialogs.confirm(
          [
            `Delete automation "${automation.title}"?`,
            describeAutomationDeletion({
              revealedRunCount: runThreads.filter((thread) => {
                const run = readAutomationRun(thread);
                return run !== null && run.hiddenAt === null;
              }).length,
            }),
          ].join("\n"),
          { variant: "destructive" },
        );
        if (!confirmed) return false;
      }
      const result = await deleteAutomation({
        environmentId: automation.environmentId,
        input: { id: automation.id },
      });
      return settled("Could not delete the automation", result);
    },
    [deleteAutomation, settled],
  );

  return useMemo(
    () => ({ runNow, setEnabled, confirmAndDelete }),
    [confirmAndDelete, runNow, setEnabled],
  );
}
