import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useMemo } from "react";

import { newThreadId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { automationEnvironment } from "../state/automations";
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
   * Confirms first, spelling out what goes with it — an automation that owns
   * its workspace takes every run in it, including ones promoted to the
   * sidebar. Resolves false when the user backs out.
   */
  readonly confirmAndDelete: (
    automation: EnvironmentAutomation,
    runThreads: ReadonlyArray<EnvironmentThreadShell>,
  ) => Promise<boolean>;
}

export function describeAutomationDeletion(input: {
  readonly ownsProject: boolean;
  readonly runCount: number;
  readonly revealedRunCount: number;
}): string {
  if (input.ownsProject) {
    return input.revealedRunCount > 0
      ? `This deletes the automation, its workspace, and all ${input.runCount} of its runs — including ${input.revealedRunCount} in your sidebar.`
      : "This deletes the automation, its workspace, and its runs.";
  }
  return input.revealedRunCount > 0
    ? `This deletes the automation and its hidden runs. The ${input.revealedRunCount} run(s) you moved to the sidebar stay.`
    : "This deletes the automation and its runs.";
}

export function useAutomationActions(): AutomationActions {
  const enableAutomation = useAtomCommand(automationEnvironment.enable, {
    reportFailure: false,
  });
  const disableAutomation = useAtomCommand(automationEnvironment.disable, {
    reportFailure: false,
  });
  const deleteAutomation = useAtomCommand(automationEnvironment.delete, {
    reportFailure: false,
  });
  const claimAutomationRun = useAtomCommand(automationEnvironment.claimRun, {
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
      const result = await claimAutomationRun({
        environmentId: automation.environmentId,
        input: {
          automationId: automation.id,
          // A manual run is scheduled for the moment it was asked for, which
          // is also what keeps its command id distinct from the timer's.
          scheduledFor: new Date().toISOString(),
          reason: "manual",
          threadId: newThreadId(),
        },
      });
      if (!settled("Could not start a run", result)) return false;
      toastManager.add({ type: "success", title: "Run started" });
      return true;
    },
    [claimAutomationRun, settled],
  );

  const setEnabled = useCallback(
    async (automation: EnvironmentAutomation, enabled: boolean) => {
      const command = enabled ? enableAutomation : disableAutomation;
      const result = await command({
        environmentId: automation.environmentId,
        input: { automationId: automation.id },
      });
      return settled(enabled ? "Could not resume" : "Could not pause", result);
    },
    [disableAutomation, enableAutomation, settled],
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
              ownsProject: automation.ownsProject,
              runCount: runThreads.length,
              revealedRunCount: runThreads.filter((thread) => thread.hiddenAt == null).length,
            }),
          ].join("\n"),
          { variant: "destructive" },
        );
        if (!confirmed) return false;
      }
      const result = await deleteAutomation({
        environmentId: automation.environmentId,
        input: { automationId: automation.id, force: true },
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
