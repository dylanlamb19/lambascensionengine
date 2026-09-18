export type Busy = { start: Date; end: Date };

function overlaps(a: Busy, b: Busy): boolean {
  return a.start < b.end && b.start < a.end;
}

export function labelSlot(start: Date, timezone = "America/Chicago"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    }).format(start);
  } catch {
    return start.toUTCString();
  }
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
    const hour = cursor.getHours();
    const day = cursor.getDay();
    const start = new Date(cursor);
    const end = new Date(cursor.getTime() + duration);
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
