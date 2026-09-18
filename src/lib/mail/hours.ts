export type HoursConfig = {
  workStart: number;
  workEnd: number;
  workDays: number[];
  timezone: string;
};

export const DEFAULT_HOURS: HoursConfig = {
  workStart: 8,
  workEnd: 17,
  workDays: [1, 2, 3, 4, 5],
  timezone: "America/Chicago",
};

export function withinWorkingHours(now: Date, hours: HoursConfig): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: hours.timezone || DEFAULT_HOURS.timezone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value || "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[weekday.slice(0, 3)] ?? now.getDay();
    if (!hours.workDays.includes(day)) return false;
    if (!Number.isFinite(hour)) return false;
    return hour >= hours.workStart && hour < hours.workEnd;
  } catch {
    const day = now.getDay();
    const hour = now.getHours();
    return hours.workDays.includes(day) && hour >= hours.workStart && hour < hours.workEnd;
  }
}

export function weekdayMorning(hours: HoursConfig = DEFAULT_HOURS): Date {
  // Tuesday 10:00 in America/Chicago (CDT = UTC-5 in September).
  return new Date("2026-09-15T15:00:00.000Z");
}

export function weekdayNight(hours: HoursConfig = DEFAULT_HOURS): Date {
  return new Date("2026-09-15T03:30:00.000Z"); // Monday 22:30 Chicago
}

export function nextWorkingInstant(now: Date, hours: HoursConfig = DEFAULT_HOURS): Date {
  const cursor = new Date(now.getTime());
  if (withinWorkingHours(cursor, hours)) {
    cursor.setTime(cursor.getTime() + 30 * 60 * 1000);
  }
  for (let i = 0; i < 7 * 48; i += 1) {
    if (withinWorkingHours(cursor, hours)) return cursor;
    cursor.setTime(cursor.getTime() + 30 * 60 * 1000);
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
