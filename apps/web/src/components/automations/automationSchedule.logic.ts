import type { ScheduledTaskSchedule } from "@t3tools/contracts";

/**
 * The schedule vocabulary the form offers, and its translation to and from
 * the scheduled-task schedule the server runs. `kept` is a schedule the
 * picker cannot express (an agent or the scheduled-tasks API made it); the
 * form leaves it untouched rather than silently rounding it off.
 */
export type SchedulePresetKind = "daily" | "weekdays" | "weekly" | "hourly" | "kept";

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface SchedulePreset {
  readonly kind: SchedulePresetKind;
  /** Minutes past midnight, for the presets that run at a time of day. */
  readonly minutesOfDay: number;
  /** 0 = Sunday. Only meaningful for the weekly preset. */
  readonly weekday: number;
  /** Only meaningful for the hourly preset. */
  readonly everyHours: number;
}

export const DEFAULT_SCHEDULE_PRESET: SchedulePreset = {
  kind: "daily",
  minutesOfDay: 9 * 60,
  weekday: 1,
  everyHours: 6,
};

const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS_MASK = [1, 2, 3, 4, 5] as const;

export function formatMinutesOfDay(minutesOfDay: number): string {
  const normalized = ((Math.trunc(minutesOfDay) % 1_440) + 1_440) % 1_440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseMinutesOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The picker's state as the schedule to save. `kept` is resolved by the caller. */
export function scheduleFromPreset(preset: SchedulePreset): ScheduledTaskSchedule {
  const timeOfDay = formatMinutesOfDay(preset.minutesOfDay);
  switch (preset.kind) {
    case "weekdays":
      return { type: "fixed_time", timeOfDay, weekdays: [...WEEKDAYS_MASK] };
    case "weekly":
      return { type: "fixed_time", timeOfDay, weekdays: [preset.weekday] };
    case "hourly":
      return {
        type: "interval",
        everyMs: Math.max(1, Math.min(23, Math.trunc(preset.everyHours))) * HOUR_MS,
      };
    case "daily":
    case "kept":
      return { type: "fixed_time", timeOfDay };
  }
}

function distinctWeekdays(weekdays: ReadonlyArray<number> | undefined): ReadonlyArray<number> {
  return [...new Set(weekdays ?? [])].toSorted((left, right) => left - right);
}

/**
 * Read a saved schedule back into the picker, or null when the picker cannot
 * express it — the form then keeps it as it is instead of pretending.
 */
export function presetFromSchedule(schedule: ScheduledTaskSchedule): SchedulePreset | null {
  if (schedule.type === "interval") {
    const everyHours = schedule.everyMs / HOUR_MS;
    return Number.isInteger(everyHours) && everyHours >= 1 && everyHours <= 23
      ? { ...DEFAULT_SCHEDULE_PRESET, kind: "hourly", everyHours }
      : null;
  }
  const minutesOfDay = parseMinutesOfDay(schedule.timeOfDay);
  if (minutesOfDay === null) return null;
  const weekdays = distinctWeekdays(schedule.weekdays);
  if (weekdays.length === 0 || weekdays.length === 7) {
    return { ...DEFAULT_SCHEDULE_PRESET, kind: "daily", minutesOfDay };
  }
  if (weekdays.join(",") === WEEKDAYS_MASK.join(",")) {
    return { ...DEFAULT_SCHEDULE_PRESET, kind: "weekdays", minutesOfDay };
  }
  if (weekdays.length === 1) {
    return { ...DEFAULT_SCHEDULE_PRESET, kind: "weekly", minutesOfDay, weekday: weekdays[0]! };
  }
  return null;
}

function formatClockLabel(minutesOfDay: number, use24Hour: boolean): string {
  const normalized = ((Math.trunc(minutesOfDay) % 1_440) + 1_440) % 1_440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  if (use24Hour) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const suffix = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function describeInterval(everyMs: number): string {
  const minutes = Math.max(1, Math.round(everyMs / 60_000));
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

/** How a schedule reads in a list: "Weekdays at 8:00 AM". */
export function describeAutomationSchedule(
  schedule: ScheduledTaskSchedule,
  options?: { readonly use24Hour?: boolean },
): string {
  if (schedule.type === "interval") return describeInterval(schedule.everyMs);
  const use24Hour = options?.use24Hour === true;
  const minutesOfDay = parseMinutesOfDay(schedule.timeOfDay);
  const at = minutesOfDay === null ? schedule.timeOfDay : formatClockLabel(minutesOfDay, use24Hour);
  const preset = presetFromSchedule(schedule);
  switch (preset?.kind) {
    case "weekdays":
      return `Weekdays at ${at}`;
    case "weekly":
      return `Every ${WEEKDAY_LABELS[preset.weekday] ?? "week"} at ${at}`;
    case "daily":
      return `Every day at ${at}`;
    default: {
      const days = distinctWeekdays(schedule.weekdays)
        .map((day) => WEEKDAY_LABELS[day]?.slice(0, 3))
        .filter((label) => label !== undefined);
      return `${days.join(", ")} at ${at}`;
    }
  }
}
