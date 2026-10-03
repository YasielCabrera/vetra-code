import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentAutomation,
  EnvironmentAutomationRun,
} from "@t3tools/client-runtime/state/automations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

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
  /** The subset of `runThreads` nobody has read, newest first. */
  readonly unreadRunThreads: ReadonlyArray<EnvironmentThreadShell>;
}

/** Where a thread's read stamp lives: `uiStateStore.threadLastVisitedAtById`. */
export type ThreadLastVisitedAtByKey = Readonly<Record<string, string>>;

/** Run records keyed by `scopedThreadKey`, from the automations stream. */
export type AutomationRunsByThreadKey = ReadonlyMap<string, EnvironmentAutomationRun>;

const WORKING_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/** Whether a run thread's latest run is still working, waiting on approval included. */
export function isAutomationRunWorking(thread: EnvironmentThreadShell): boolean {
  const status = thread.latestRun?.status;
  return status !== undefined && WORKING_RUN_STATUSES.has(status);
}

export function automationRunVisitKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/**
 * A finished run whose result nobody has looked at: its thread has not been
 * opened since the run completed.
 *
 * A never-opened run counts as unread, which is the opposite of the rule for
 * threads you started yourself — the schedule fired while nobody was watching,
 * so "never opened" is exactly the state worth reporting. Archiving a run is
 * how you say you are done with it, so archived runs are read by definition.
 */
export function isAutomationRunUnread(input: {
  readonly thread: EnvironmentThreadShell;
  readonly lastVisitedAt: string | undefined;
}): boolean {
  const { lastVisitedAt, thread } = input;
  if (thread.archivedAt !== null) return false;
  if (isAutomationRunWorking(thread)) return false;
  const completedAt = thread.latestRun?.completedAt;
  if (!completedAt) return false;
  const completedAtMs = Date.parse(completedAt);
  if (Number.isNaN(completedAtMs)) return false;
  if (lastVisitedAt === undefined) return true;
  const lastVisitedAtMs = Date.parse(lastVisitedAt);
  // Corrupt local data must not eat the signal.
  if (Number.isNaN(lastVisitedAtMs)) return true;
  return completedAtMs > lastVisitedAtMs;
}

/**
 * The sidebar badge's number: unread runs across every connected environment.
 * Counted rather than collected — the badge only ever shows the total.
 */
export function countUnreadAutomationRuns(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /**
   * Runs of live automations only. A run whose automation is gone — deleted
   * while the run itself was promoted to the sidebar — is a plain thread now,
   * and the sidebar's own unread treatment owns it. Counting it here would
   * leave a badge the automations page has nothing to clear.
   */
  readonly runsByThreadKey: AutomationRunsByThreadKey;
  readonly lastVisitedAtByThreadKey: ThreadLastVisitedAtByKey;
}): number {
  if (input.runsByThreadKey.size === 0) return 0;
  let count = 0;
  for (const thread of input.threads) {
    const key = automationRunVisitKey(thread);
    if (!input.runsByThreadKey.has(key)) continue;
    if (isAutomationRunUnread({ thread, lastVisitedAt: input.lastVisitedAtByThreadKey[key] })) {
      count += 1;
    }
  }
  return count;
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
  if (input.runThreads.some(isAutomationRunWorking)) {
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
  readonly runsByThreadKey: AutomationRunsByThreadKey;
  readonly resolveProjectName: (automation: EnvironmentAutomation) => string | null;
  readonly resolveModelLabel: (automation: EnvironmentAutomation) => string | null;
  readonly resolveEnvironmentLabel: (automation: EnvironmentAutomation) => string | null;
  /** Absent means nothing has been read yet, so every finished run is unread. */
  readonly lastVisitedAtByThreadKey?: ThreadLastVisitedAtByKey;
  readonly use24Hour?: boolean;
}): ReadonlyArray<AutomationRowModel> {
  const runThreadsByAutomation = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    const run = input.runsByThreadKey.get(automationRunVisitKey(thread));
    if (run === undefined) continue;
    const key = `${thread.environmentId}:${run.automationId}`;
    const bucket = runThreadsByAutomation.get(key);
    if (bucket === undefined) {
      runThreadsByAutomation.set(key, [thread]);
    } else {
      bucket.push(thread);
    }
  }

  const lastVisitedAtByThreadKey = input.lastVisitedAtByThreadKey ?? {};
  return input.automations.map((automation) => {
    const runThreads =
      runThreadsByAutomation.get(`${automation.environmentId}:${automation.id}`) ?? [];
    let lastRunAt: string | null = null;
    for (const thread of runThreads) {
      if (lastRunAt === null || thread.createdAt > lastRunAt) {
        lastRunAt = thread.createdAt;
      }
    }
    const newestFirst = runThreads.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
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
      runThreads: newestFirst,
      unreadRunThreads: newestFirst.filter((thread) =>
        isAutomationRunUnread({
          thread,
          lastVisitedAt: lastVisitedAtByThreadKey[automationRunVisitKey(thread)],
        }),
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

export function unreadRunCountLabel(count: number): string {
  return count === 1 ? "1 unread run" : `${count} unread runs`;
}

/** Kept short so a busy schedule cannot stretch the sidebar row it sits in. */
export function unreadRunBadgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
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
