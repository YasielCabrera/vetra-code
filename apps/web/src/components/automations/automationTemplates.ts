import {
  ClipboardListIcon,
  GitPullRequestArrowIcon,
  LightbulbIcon,
  PackageIcon,
  SunriseIcon,
  TelescopeIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  cronFromPreset,
  DEFAULT_SCHEDULE_PRESET,
  type SchedulePreset,
} from "./automationSchedule.logic";

/**
 * Starting points for the empty state. Deliberately shaped for a coding
 * workspace rather than an inbox: every one of them is something an agent with
 * a checkout can actually do.
 */
export interface AutomationTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly preset: SchedulePreset;
  readonly scheduleLabel: string;
  readonly icon: LucideIcon;
}

const weekdaysAt = (minutesOfDay: number): SchedulePreset => ({
  ...DEFAULT_SCHEDULE_PRESET,
  kind: "weekdays",
  minutesOfDay,
});

const weeklyAt = (weekday: number, minutesOfDay: number): SchedulePreset => ({
  ...DEFAULT_SCHEDULE_PRESET,
  kind: "weekly",
  weekday,
  minutesOfDay,
});

const dailyAt = (minutesOfDay: number): SchedulePreset => ({
  ...DEFAULT_SCHEDULE_PRESET,
  kind: "daily",
  minutesOfDay,
});

export const AUTOMATION_TEMPLATES: ReadonlyArray<AutomationTemplate> = [
  {
    id: "morning-briefing",
    title: "Morning briefing",
    description: "What moved in this repository since yesterday, and what needs a decision today.",
    prompt:
      "Summarize what changed in this repository since yesterday: merged pull requests, new commits on the default branch, and anything that looks like it needs a decision from me. Keep it short.",
    preset: weekdaysAt(8 * 60),
    scheduleLabel: "Weekdays at 8:00 AM",
    icon: SunriseIcon,
  },
  {
    id: "dependency-refresh",
    title: "Dependency refresh",
    description: "Update dependencies, run the test suite, and open a pull request if it is green.",
    prompt:
      "Update this project's dependencies to their latest compatible versions. Run the test suite. If everything passes, open a pull request describing what moved and why; if anything fails, stop and explain what broke.",
    preset: weeklyAt(1, 6 * 60),
    scheduleLabel: "Every Monday at 6:00 AM",
    icon: PackageIcon,
  },
  {
    id: "review-queue",
    title: "Review queue",
    description: "Read the open pull requests and tell me which ones are waiting on me.",
    prompt:
      "List the open pull requests in this repository. For each, say who it is waiting on, whether checks are green, and how long it has been open. Put the ones waiting on me first.",
    preset: weekdaysAt(9 * 60),
    scheduleLabel: "Weekdays at 9:00 AM",
    icon: GitPullRequestArrowIcon,
  },
  {
    id: "weekly-review",
    title: "Weekly review",
    description: "A Friday summary of what shipped this week.",
    prompt:
      "Write a short summary of what shipped in this repository this week: what merged, what is still in flight, and anything that slipped. Aim for something I could paste into a team update.",
    preset: weeklyAt(5, 16 * 60),
    scheduleLabel: "Every Friday at 4:00 PM",
    icon: ClipboardListIcon,
  },
  {
    id: "flaky-tests",
    title: "Flaky test hunt",
    description: "Look for tests that fail intermittently and propose fixes.",
    prompt:
      "Look through recent CI runs for tests that failed and then passed without a code change. For each one you find, explain the likely cause and propose a fix. Do not change anything yet.",
    preset: weeklyAt(3, 7 * 60),
    scheduleLabel: "Every Wednesday at 7:00 AM",
    icon: TelescopeIcon,
  },
  {
    id: "cleanup-ideas",
    title: "Cleanup ideas",
    description: "Find the code most worth simplifying, without touching it.",
    prompt:
      "Find three places in this codebase that would most benefit from simplification — duplication, a leaky abstraction, a function doing too much. For each, describe the change you would make and what it would buy. Do not edit anything.",
    preset: dailyAt(18 * 60),
    scheduleLabel: "Every day at 6:00 PM",
    icon: LightbulbIcon,
  },
];

export function findAutomationTemplate(id: string | undefined): AutomationTemplate | null {
  if (id === undefined) return null;
  return AUTOMATION_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** A template's schedule as the cron the form will save. */
export function templateCron(template: AutomationTemplate): string {
  return cronFromPreset(template.preset);
}
