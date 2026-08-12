import type { AutomationSchedule } from "@vetra-studio/contracts";

/**
 * The schedule vocabulary the form offers, and its translation to and from
 * cron. The picker is the common ground; anything it cannot express stays
 * editable as a raw expression rather than being silently rounded off.
 */
export type SchedulePresetKind = "daily" | "weekdays" | "weekly" | "hourly" | "custom" | "once";

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

/** The picker's state as a cron expression. Custom is passed through by the caller. */
export function cronFromPreset(preset: SchedulePreset): string {
  const minutes = ((Math.trunc(preset.minutesOfDay) % 1_440) + 1_440) % 1_440;
  const minute = minutes % 60;
  const hour = Math.floor(minutes / 60);
  switch (preset.kind) {
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${preset.weekday}`;
    case "hourly":
      return `${minute} */${Math.max(1, Math.min(23, Math.trunc(preset.everyHours)))} * * *`;
    case "daily":
    case "custom":
    case "once":
      return `${minute} ${hour} * * *`;
  }
}

/**
 * Read a cron expression back into the picker, or null when the picker cannot
 * express it — the form then shows the raw expression instead of pretending.
 */
export function presetFromCron(cron: string): SchedulePreset | null {
  const segments = cron.trim().split(/\s+/);
  if (segments.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, weekday] = segments as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (dayOfMonth !== "*" || month !== "*") return null;
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return null;

  const hourlyMatch = /^\*\/(\d{1,2})$/.exec(hour);
  if (hourlyMatch !== null && weekday === "*") {
    const everyHours = Number(hourlyMatch[1]);
    if (everyHours < 1 || everyHours > 23) return null;
    return {
      ...DEFAULT_SCHEDULE_PRESET,
      kind: "hourly",
      everyHours,
      minutesOfDay: Number(minute),
    };
  }
  if (!/^\d{1,2}$/.test(hour)) return null;
  const minutesOfDay = Number(hour) * 60 + Number(minute);
  if (minutesOfDay > 1_439) return null;

  if (weekday === "*") {
    return { ...DEFAULT_SCHEDULE_PRESET, kind: "daily", minutesOfDay };
  }
  if (weekday === "1-5") {
    return { ...DEFAULT_SCHEDULE_PRESET, kind: "weekdays", minutesOfDay };
  }
  if (/^[0-6]$/.test(weekday)) {
    return {
      ...DEFAULT_SCHEDULE_PRESET,
      kind: "weekly",
      minutesOfDay,
      weekday: Number(weekday),
    };
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

/**
 * How a schedule reads in a list: "Weekdays at 8:00 AM". A cron the picker
 * cannot express falls back to the expression itself — honest, and still
 * scannable next to the ones that do.
 */
export function describeAutomationSchedule(
  schedule: AutomationSchedule,
  options?: { readonly use24Hour?: boolean },
): string {
  const use24Hour = options?.use24Hour === true;
  if (schedule.kind === "once") {
    return "Once";
  }
  const preset = presetFromCron(schedule.cron);
  if (preset === null) {
    return schedule.cron;
  }
  const at = formatClockLabel(preset.minutesOfDay, use24Hour);
  switch (preset.kind) {
    case "weekdays":
      return `Weekdays at ${at}`;
    case "weekly":
      return `Every ${WEEKDAY_LABELS[preset.weekday] ?? "week"} at ${at}`;
    case "hourly":
      return preset.everyHours === 1 ? "Every hour" : `Every ${preset.everyHours} hours`;
    case "daily":
    case "custom":
    case "once":
      return `Every day at ${at}`;
  }
}

/** The zone an automation created here should be evaluated in. */
export function resolveLocalTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : "UTC";
  } catch {
    return "UTC";
  }
}
