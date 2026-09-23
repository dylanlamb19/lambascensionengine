export type Busy = { start: Date; end: Date };

function overlaps(a: Busy, b: Busy): boolean {
  return a.start < b.end && b.start < a.end;
}

export function labelSlot(start: Date, timezone = "America/Chicago"): string {
  try {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    }).format(start);
    const zone = timezone === "America/Chicago" ? "CT" : timezone;
    return `${when} ${zone}`;
  } catch {
    return start.toUTCString();
  }
}

function zonedClock(date: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const name = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? date.getUTCDay();
  return { hour, weekday };
}

export function openSlots(opts: {
  from: Date;
  busy: Busy[];
  count?: number;
  durationMin?: number;
  timezone?: string;
  workStart?: number;
  workEnd?: number;
}): { start: Date; end: Date; label: string }[] {
  const duration = (opts.durationMin || 30) * 60 * 1000;
  const out: { start: Date; end: Date; label: string }[] = [];
  const cursor = new Date(opts.from);
  cursor.setMinutes(0, 0, 0);
  if (cursor.getMinutes() !== 0) cursor.setHours(cursor.getHours() + 1);
  for (let i = 0; i < 14 * 24 && out.length < (opts.count || 3); i += 1) {
    const start = new Date(cursor);
    const end = new Date(cursor.getTime() + duration);
    const zoned = opts.timezone ? zonedClock(start, opts.timezone) : null;
    const hour = zoned ? zoned.hour : cursor.getHours();
    const day = zoned ? zoned.weekday : cursor.getDay();
    const workStart = opts.workStart ?? 8;
    const workEnd = opts.workEnd ?? 17;
    const weekday = day >= 1 && day <= 5;
    const inHours = hour >= workStart && hour < workEnd;
    const conflict = opts.busy.some((b) => overlaps({ start, end }, b));
    if (weekday && inHours && !conflict && start > opts.from) {
      out.push({ start, end, label: labelSlot(start, opts.timezone) });
    }
    cursor.setTime(cursor.getTime() + 30 * 60 * 1000);
  }
  return out;
}
