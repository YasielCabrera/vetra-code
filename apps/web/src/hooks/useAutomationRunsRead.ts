import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useCallback } from "react";

import { automationRunVisitKey } from "../components/automations/automationsList.logic";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";

/**
 * Clears the unread mark on runs without opening them — the way out of a badge
 * that has been counting up while nobody was looking.
 *
 * Each run is stamped at its own completion instant rather than at now, exactly
 * as opening the thread would: a run that completes again later still has
 * something new to say. Servers with visited tracking own the stamp, so it
 * syncs to every device; older servers keep the browser-local one.
 */
export function useMarkAutomationRunsRead(): (runs: ReadonlyArray<EnvironmentThreadShell>) => void {
  const markThreadsVisited = useUiStateStore((state) => state.markThreadsVisited);
  const visitThreadMutation = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  return useCallback(
    (runs) => {
      const localEntries: Array<{ threadKey: string; visitedAt: string }> = [];
      for (const thread of runs) {
        const completedAt = thread.latestRun?.completedAt;
        // An unfinished run has no completion to acknowledge.
        if (!completedAt) continue;
        if (thread.lastVisitedAt !== undefined) {
          void visitThreadMutation({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, visitedAt: completedAt },
          });
          continue;
        }
        localEntries.push({ threadKey: automationRunVisitKey(thread), visitedAt: completedAt });
      }
      if (localEntries.length > 0) markThreadsVisited(localEntries);
    },
    [markThreadsVisited, visitThreadMutation],
  );
}
