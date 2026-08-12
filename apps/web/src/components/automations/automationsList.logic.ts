import type { EnvironmentAutomation } from "@vetra-code/client-runtime/state/automations";
import type { EnvironmentThreadShell } from "@vetra-code/client-runtime/state/models";

import { describeAutomationSchedule } from "./automationSchedule.logic";

export interface AutomationRowModel {
  readonly automation: EnvironmentAutomation;
  readonly scheduleLabel: string;
  /** The model a run starts with, as the picker labels it. */
  readonly modelLabel: string | null;
  readonly projectName: string | null;
  /** Named only when the automation runs somewhere other than this machine. */
  readonly environmentLabel: string | null;
  readonly runCount: number;
  readonly lastRunAt: string | null;
  readonly status: AutomationRowStatus;
  /** This automation's run threads, newest first. Grouped once here so the row
      menu's delete confirmation can count them without a second pass. */
  readonly runThreads: ReadonlyArray<EnvironmentThreadShell>;
}

/**
 * What the row leads with. `missed` and `skipped` outcomes matter more than the
 * next run: they are the cases where the user may want to press Run now.
 */
export type AutomationRowStatus =
  | { readonly kind: "paused" }
  | { readonly kind: "running" }
  | { readonly kind: "missed"; readonly scheduledFor: string }
  | { readonly kind: "skipped"; readonly scheduledFor: string }
  | { readonly kind: "scheduled"; readonly nextRunAt: string }
  | { readonly kind: "idle" };

export function resolveAutomationRowStatus(input: {
  readonly automation: EnvironmentAutomation;
  readonly runThreads: ReadonlyArray<EnvironmentThreadShell>;
}): AutomationRowStatus {
  const { automation } = input;
  const isRunning = input.runThreads.some(
    (thread) =>
      thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      thread.latestTurn?.state === "running",
  );
  if (isRunning) {
    return { kind: "running" };
  }
  if (!automation.enabled) {
    return { kind: "paused" };
  }
  const lastRun = automation.lastRun;
  if (lastRun !== null && lastRun.outcome === "missed") {
    return { kind: "missed", scheduledFor: lastRun.scheduledFor };
  }
  if (
    lastRun !== null &&
    (lastRun.outcome === "skipped-overlap" || lastRun.outcome === "skipped-disabled")
  ) {
    return { kind: "skipped", scheduledFor: lastRun.scheduledFor };
  }
  if (automation.nextRunAt !== null) {
    return { kind: "scheduled", nextRunAt: automation.nextRunAt };
  }
  return { kind: "idle" };
}

export function buildAutomationRowModels(input: {
  readonly automations: ReadonlyArray<EnvironmentAutomation>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly resolveProjectName: (automation: EnvironmentAutomation) => string | null;
  readonly resolveModelLabel: (automation: EnvironmentAutomation) => string | null;
  readonly resolveEnvironmentLabel: (automation: EnvironmentAutomation) => string | null;
  readonly use24Hour?: boolean;
}): ReadonlyArray<AutomationRowModel> {
  const runThreadsByAutomation = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    if (thread.automationId == null) continue;
    const key = `${thread.environmentId}:${thread.automationId}`;
    const bucket = runThreadsByAutomation.get(key);
    if (bucket === undefined) {
      runThreadsByAutomation.set(key, [thread]);
    } else {
      bucket.push(thread);
    }
  }

  return input.automations.map((automation) => {
    const runThreads =
      runThreadsByAutomation.get(`${automation.environmentId}:${automation.id}`) ?? [];
    let lastRunAt: string | null = null;
    for (const thread of runThreads) {
      if (lastRunAt === null || thread.createdAt > lastRunAt) {
        lastRunAt = thread.createdAt;
      }
    }
    return {
      automation,
      scheduleLabel: describeAutomationSchedule(automation.schedule, {
        use24Hour: input.use24Hour === true,
      }),
      modelLabel: input.resolveModelLabel(automation),
      projectName: input.resolveProjectName(automation),
      environmentLabel: input.resolveEnvironmentLabel(automation),
      runCount: runThreads.length,
      lastRunAt,
      status: resolveAutomationRowStatus({ automation, runThreads }),
      runThreads: runThreads.toSorted((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    };
  });
}

export function matchesAutomationQuery(row: AutomationRowModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystacks = [
    row.automation.title,
    row.automation.prompt,
    row.scheduleLabel,
    row.modelLabel ?? "",
    row.projectName ?? "",
    row.environmentLabel ?? "",
  ];
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

export function runCountLabel(count: number): string {
  return count === 1 ? "1 run" : `${count} runs`;
}

/**
 * Soonest next run first, because "what happens next" is the page's question.
 * Automations with nothing scheduled sink below the ones that do, and paused
 * ones sink below those — each group still ordered by title so the list never
 * reshuffles for no reason.
 */
export function sortAutomationRows(
  rows: ReadonlyArray<AutomationRowModel>,
): ReadonlyArray<AutomationRowModel> {
  const rank = (row: AutomationRowModel): number => {
    if (!row.automation.enabled) return 2;
    return row.automation.nextRunAt === null ? 1 : 0;
  };
  return rows.toSorted((left, right) => {
    const rankDelta = rank(left) - rank(right);
    if (rankDelta !== 0) return rankDelta;
    const leftNext = left.automation.nextRunAt;
    const rightNext = right.automation.nextRunAt;
    if (leftNext !== null && rightNext !== null && leftNext !== rightNext) {
      return leftNext < rightNext ? -1 : 1;
    }
    return left.automation.title.localeCompare(right.automation.title);
  });
}
