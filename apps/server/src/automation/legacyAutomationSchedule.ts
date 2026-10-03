import type { ScheduledTaskSchedule } from "@t3tools/contracts";

/**
 * Converts the schedule a pre-V2 automation stored (a cron string evaluated in
 * an IANA zone, or a one-time instant) into a scheduled-task schedule, which
 * is a wall-clock time on chosen weekdays in the server's zone, or an
 * interval. `exact` is false when the old schedule has no faithful
 * equivalent; the caller then keeps the task paused rather than running it on
 * a timetable the user never chose.
 */
export function convertLegacyAutomationSchedule(
  legacy: unknown,
  input: { readonly serverTimeZone: string; readonly nowMs: number },
): { readonly schedule: ScheduledTaskSchedule; readonly exact: boolean } {
  const fallback = { schedule: { type: "fixed_time", timeOfDay: "09:00" }, exact: false } as const;
  if (typeof legacy !== "object" || legacy === null) return fallback;
  const record = legacy as Record<string, unknown>;
  if (record.kind !== "recurring" || typeof record.cron !== "string") return fallback;
  const timeZone = typeof record.timeZone === "string" ? record.timeZone : input.serverTimeZone;

  const fields = record.cron.trim().split(/\s+/);
  if (fields.length !== 5) return fallback;
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (dayOfMonth !== "*" || month !== "*") return fallback;
  const minute = parseIntInRange(minuteField, 0, 59);
  if (minute === null) return fallback;

  const everyHours = /^\*\/(\d+)$/.exec(hourField);
  if (everyHours !== null) {
    const hours = Number(everyHours[1]);
    if (dayOfWeek !== "*" || hours < 1 || hours > 23) return fallback;
    return { schedule: { type: "interval", everyMs: hours * 60 * 60 * 1000 }, exact: true };
  }

  const hour = parseIntInRange(hourField, 0, 23);
  if (hour === null) return fallback;
  const weekdays = dayOfWeek === "*" ? null : parseWeekdays(dayOfWeek);
  if (dayOfWeek !== "*" && weekdays === null) return fallback;

  // The old schedule ran in its own zone; scheduled tasks run in the server's.
  // Shift by today's offset difference, carrying across midnight onto the
  // neighbouring weekday.
  const shift =
    zoneOffsetMinutes(input.serverTimeZone, input.nowMs) - zoneOffsetMinutes(timeZone, input.nowMs);
  const shifted = hour * 60 + minute + shift;
  const dayCarry = Math.floor(shifted / 1440);
  const minutesOfDay = ((shifted % 1440) + 1440) % 1440;
  const timeOfDay = `${pad(Math.floor(minutesOfDay / 60))}:${pad(minutesOfDay % 60)}`;
  const rotated =
    weekdays === null
      ? null
      : [...new Set(weekdays.map((day) => (((day + dayCarry) % 7) + 7) % 7))].toSorted(
          (left, right) => left - right,
        );
  return {
    schedule:
      rotated === null
        ? { type: "fixed_time", timeOfDay }
        : { type: "fixed_time", timeOfDay, weekdays: rotated },
    exact: true,
  };
}

function parseIntInRange(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

/** Cron weekday lists and ranges, with 7 as an alias for Sunday. */
function parseWeekdays(value: string): ReadonlyArray<number> | null {
  const days = new Set<number>();
  for (const part of value.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range !== null) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end || end > 7) return null;
      for (let day = start; day <= end; day += 1) days.add(day % 7);
      continue;
    }
    const day = parseIntInRange(part, 0, 7);
    if (day === null) return null;
    days.add(day % 7);
  }
  return days.size === 0 ? null : [...days];
}

/** Minutes the zone's wall clock is ahead of UTC at `atMs`. */
export function zoneOffsetMinutes(timeZone: string, atMs: number): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(atMs);
  } catch {
    return 0;
  }
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const wallClockMs = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return Math.round((wallClockMs - (atMs - (atMs % 60_000))) / 60_000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
