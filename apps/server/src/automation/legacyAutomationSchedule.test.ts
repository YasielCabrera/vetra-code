import { describe, expect, it } from "vite-plus/test";

import { convertLegacyAutomationSchedule, zoneOffsetMinutes } from "./legacyAutomationSchedule.ts";

// 2026-10-02 12:00Z: New York is UTC-4 (daylight time), Berlin UTC+2.
const NOW_MS = Date.parse("2026-10-02T12:00:00.000Z");
const sameZone = { serverTimeZone: "America/New_York", nowMs: NOW_MS };

function convert(cron: string, timeZone = "America/New_York", serverTimeZone = timeZone) {
  return convertLegacyAutomationSchedule(
    { kind: "recurring", cron, timeZone },
    { serverTimeZone, nowMs: NOW_MS },
  );
}

describe("convertLegacyAutomationSchedule", () => {
  it("keeps every preset the old form produced", () => {
    expect(convert("30 9 * * *")).toEqual({
      schedule: { type: "fixed_time", timeOfDay: "09:30" },
      exact: true,
    });
    expect(convert("0 8 * * 1-5")).toEqual({
      schedule: { type: "fixed_time", timeOfDay: "08:00", weekdays: [1, 2, 3, 4, 5] },
      exact: true,
    });
    expect(convert("0 16 * * 5")).toEqual({
      schedule: { type: "fixed_time", timeOfDay: "16:00", weekdays: [5] },
      exact: true,
    });
    expect(convert("15 */6 * * *")).toEqual({
      schedule: { type: "interval", everyMs: 6 * 60 * 60 * 1000 },
      exact: true,
    });
  });

  it("reads weekday lists and Sunday written as 7", () => {
    expect(convert("0 7 * * 1,3,7")).toEqual({
      schedule: { type: "fixed_time", timeOfDay: "07:00", weekdays: [0, 1, 3] },
      exact: true,
    });
  });

  it("moves a schedule written for another zone onto the server's clock", () => {
    // 23:30 in New York is 05:30 the next morning in Berlin.
    expect(convert("30 23 * * 1-5", "America/New_York", "Europe/Berlin")).toEqual({
      schedule: { type: "fixed_time", timeOfDay: "05:30", weekdays: [2, 3, 4, 5, 6] },
      exact: true,
    });
  });

  it("flags schedules scheduled tasks cannot express", () => {
    for (const cron of ["0 9 1 * *", "*/5 * * * *", "0 9-17 * * *", "0 */6 * * 1", "bad"]) {
      expect(convert(cron).exact, cron).toBe(false);
    }
    expect(
      convertLegacyAutomationSchedule({ kind: "once", runAt: "2026-10-03T09:00:00.000Z" }, sameZone)
        .exact,
    ).toBe(false);
    expect(convertLegacyAutomationSchedule(null, sameZone).exact).toBe(false);
  });
});

describe("zoneOffsetMinutes", () => {
  it("reads a zone's offset at an instant", () => {
    expect(zoneOffsetMinutes("America/New_York", NOW_MS)).toBe(-240);
    expect(zoneOffsetMinutes("UTC", NOW_MS)).toBe(0);
  });
});
