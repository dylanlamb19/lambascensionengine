/** Personal owner-calendar helpers. Pure — no Google I/O, no sales booking. */

export const OWNER_TZ_DEFAULT = "America/Chicago";
export const OWNER_EVENT_DEFAULT_MINUTES = 30;

export type LastOwnerEvent = {
  id: string;
  title: string;
  whenLabel: string;
  start: string;
  end: string;
  fingerprint: string;
};

export type ResolveOwnerWhenInput = {
  when?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  timezone?: string;
  now?: Date;
};

export type ResolveOwnerWhenOk = {
  ok: true;
  start: Date;
  end: Date;
  ymd: string;
  durationMinutes: number;
  whenLabel: string;
  timeLabel: string;
  timezone: string;
};

export type ResolveOwnerWhenNeed = {
  ok: false;
  need: "time" | "when";
  question: string;
  dateLabel?: string;
};

export type ResolveOwnerWhenResult = ResolveOwnerWhenOk | ResolveOwnerWhenNeed;

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function partsInTz(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const grab = (t: string) => parts.find((p) => p.type === t)?.value || "";
  let hour = Number(grab("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(grab("year")),
    month: Number(grab("month")),
    day: Number(grab("day")),
    hour,
    minute: Number(grab("minute")),
    second: Number(grab("second")),
    weekday: grab("weekday"),
  };
}

/** Minutes to add to UTC to get local clock time (Chicago CDT ≈ -300). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function fromZonedLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const off1 = tzOffsetMinutes(utcGuess, timeZone);
  let instant = new Date(utcGuess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(instant, timeZone);
  if (off2 !== off1) instant = new Date(utcGuess.getTime() - off2 * 60000);
  return instant;
}

export function ymdInTimezone(date: Date, timeZone: string): string {
  const p = partsInTz(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = (ymd || "").split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const utc = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export function weekdayIndexOfYmd(ymd: string, timeZone: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedLocal(y, m, d, 12, 0, timeZone);
  const name = partsInTz(noon, timeZone).weekday.slice(0, 3).toLowerCase();
  return WEEKDAY_INDEX[name] ?? noon.getUTCDay();
}

export function toOffsetIso(date: Date, timeZone: string): string {
  const p = partsInTz(date, timeZone);
  const off = tzOffsetMinutes(date, timeZone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatTimeInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatOwnerWhen(start: Date, timeZone: string, now: Date): string {
  const ymd = ymdInTimezone(start, timeZone);
  const today = ymdInTimezone(now, timeZone);
  const tomorrow = addDaysYmd(today, 1);
  const time = formatTimeInTz(start, timeZone);
  if (ymd === today) return `today at ${time}`;
  if (ymd === tomorrow) return `tomorrow at ${time}`;
  const long = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(start);
  return `${long} at ${time}`;
}

function clampDuration(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return OWNER_EVENT_DEFAULT_MINUTES;
  return Math.min(180, Math.max(5, Math.round(n)));
}

export function parseClock(raw: string, opts?: { tonight?: boolean }): { hour: number; minute: number } | null {
  const t = (raw || "").toLowerCase();
  if (/\bmidnight\b/.test(t)) return { hour: 0, minute: 0 };
  if (/\bnoon\b/.test(t) || /\bmidday\b/.test(t)) return { hour: 12, minute: 0 };
  const apm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  const at = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))\b/) || t.match(/\bat\s+(\d{1,2})\b/);
  const lone = t.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*$/);
  const m = apm || at || lone;
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  const ap = (m[3] || "").replace(/\./g, "");
  if (ap.startsWith("p") && hour < 12) hour += 12;
  else if (ap.startsWith("a") && hour === 12) hour = 0;
  else if (!ap && hour <= 7 && hour > 0) hour += 12;
  if (opts?.tonight && hour < 12) hour += 12;
  if (hour === 24) hour = 0;
  return { hour, minute };
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function parseYmdToken(raw: string, todayYmd: string): string | null {
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const us = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (us) {
    const month = parseInt(us[1], 10);
    const day = parseInt(us[2], 10);
    let year = us[3] ? parseInt(us[3], 10) : Number(todayYmd.slice(0, 4));
    if (year && year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  const named = raw.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const day = parseInt(named[2], 10);
    const year = named[3] ? parseInt(named[3], 10) : Number(todayYmd.slice(0, 4));
    if (month && day >= 1 && day <= 31) return `${year}-${pad(month)}-${pad(day)}`;
  }
  return null;
}

function nextWeekdayYmd(fromYmd: string, want: number, timeZone: string, { skipToday }: { skipToday: boolean }): string {
  let ymd = skipToday ? addDaysYmd(fromYmd, 1) : fromYmd;
  for (let i = 0; i < 8; i += 1) {
    if (weekdayIndexOfYmd(ymd, timeZone) === want) return ymd;
    ymd = addDaysYmd(ymd, 1);
  }
  return addDaysYmd(fromYmd, 1);
}

function parseDateYmd(blob: string, today: string, timeZone: string): { ymd: string; label: string } | null {
  const t = blob.toLowerCase();
  if (/\btomorrow\b/.test(t)) return { ymd: addDaysYmd(today, 1), label: "tomorrow" };
  if (/\btonight\b/.test(t) || /\btoday\b/.test(t)) return { ymd: today, label: /\btonight\b/.test(t) ? "tonight" : "today" };
  const iso = parseYmdToken(t, today);
  if (iso) return { ymd: iso, label: iso };
  const next = /\bnext\b/.test(t);
  for (const [name, idx] of Object.entries(WEEKDAY_INDEX)) {
    if (name.length < 3) continue;
    const re = new RegExp(`\\b${name}\\b`);
    if (!re.test(t)) continue;
    const ymd = nextWeekdayYmd(today, idx, timeZone, { skipToday: next && weekdayIndexOfYmd(today, timeZone) === idx });
    return { ymd, label: next ? `next ${WEEKDAY_NAME[idx]}` : WEEKDAY_NAME[idx] };
  }
  return null;
}

export function resolveOwnerWhen(input: ResolveOwnerWhenInput): ResolveOwnerWhenResult {
  const timezone = input.timezone || OWNER_TZ_DEFAULT;
  const now = input.now || new Date();
  const blob = [input.when, input.date, input.time].filter((s) => typeof s === "string" && s.trim()).join(" ").trim();
  const today = ymdInTimezone(now, timezone);
  const tonight = /\btonight\b/i.test(blob);
  const clock = parseClock(input.time || blob, { tonight });
  const dated = parseDateYmd(input.date || input.when || blob, today, timezone);
  const durationMinutes = clampDuration(input.durationMinutes);

  if (!clock) {
    if (dated) {
      return {
        ok: false,
        need: "time",
        question: `What time ${dated.label}?`,
        dateLabel: dated.label,
      };
    }
    return {
      ok: false,
      need: "when",
      question: "What day and time should I put on your calendar?",
    };
  }

  let ymd = dated?.ymd;
  if (!ymd) {
    const todayStart = fromZonedLocal(
      Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10)),
      clock.hour, clock.minute, timezone,
    );
    ymd = todayStart.getTime() > now.getTime() ? today : addDaysYmd(today, 1);
  }

  const [y, m, d] = ymd.split("-").map(Number);
  const start = fromZonedLocal(y, m, d, clock.hour, clock.minute, timezone);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const whenLabel = formatOwnerWhen(start, timezone, now);
  return {
    ok: true,
    start,
    end,
    ymd,
    durationMinutes,
    whenLabel,
    timeLabel: formatTimeInTz(start, timezone),
    timezone,
  };
}

export function sanitizeOwnerTitle(raw: string): string {
  let t = (raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(please\s+)?(remind me (on my calendar )?to|add|put|schedule|set (a |an )?(reminder|event) (on my calendar )?(for|to)?)\s+/i, "");
  t = t.replace(/^that i need to\s+/i, "");
  t = t.replace(/^['"]|['"]$/g, "").trim();
  if (!t) t = (raw || "").replace(/\s+/g, " ").trim();
  return t.slice(0, 200);
}

export function ownerEventFingerprint(opts: { title: string; startIso: string; durationMinutes: number }): string {
  const title = opts.title.trim().toLowerCase().replace(/\s+/g, " ");
  return `owner-cal:${title}:${opts.startIso}:${opts.durationMinutes}`;
}

export function ownerEventSuccessSpeech(title: string, whenLabel: string): string {
  return `Done — I added ‘${title}’ to your calendar for ${whenLabel}.`;
}

export function ownerEventFailureSpeech(): string {
  return "I couldn't create that event, so nothing was added.";
}

export function ownerEventSpeechFromState(last: LastOwnerEvent | null | undefined): string {
  if (!last) return "I haven’t added a personal calendar event this session.";
  return `I added ‘${last.title}’ to your calendar for ${last.whenLabel}.`;
}
