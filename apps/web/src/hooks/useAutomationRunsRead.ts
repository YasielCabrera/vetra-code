import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useCallback } from "react";

import { automationRunVisitKey } from "../components/automations/automationsList.logic";
import { useUiStateStore } from "../uiStateStore";

/**
 * Clears the unread mark on runs without opening them — the way out of a badge
 * that has been counting up while nobody was looking.
 *
 * Each run is stamped at its own completion instant rather than at now, exactly
 * as opening the thread would: a run that completes again later still has
 * something new to say.
 */
export function useMarkAutomationRunsRead(): (runs: ReadonlyArray<EnvironmentThreadShell>) => void {
  const markThreadsVisited = useUiStateStore((state) => state.markThreadsVisited);
  return useCallback(
    (runs) => {
      const entries = runs.flatMap((thread) => {
        const completedAt = thread.latestTurn?.completedAt;
        // An unfinished run has no completion to acknowledge.
        return completedAt
          ? [{ threadKey: automationRunVisitKey(thread), visitedAt: completedAt }]
          : [];
      });
      if (entries.length === 0) return;
      markThreadsVisited(entries);
    },
    [markThreadsVisited],
  );
}
