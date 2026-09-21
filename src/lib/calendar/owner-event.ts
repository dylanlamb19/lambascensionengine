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

const SALES_BOOKING_RE = /\b(schedule|book)\s+(them|it|the call|this (call|company|prospect))\b/i;
const VIEW_CALENDAR_RE = /\b(pull up|show( me)?|open|go to)\s+(my |the )?calendar\b/i;
const PERSONAL_HINT_RE = new RegExp(
  [
    String.raw`\bremind me\b`,
    String.raw`\b(set|add|put)\s+(a |an )?(reminder|event|appointment)\b`,
    String.raw`\b(add|put|schedule)\b[\s\S]{0,120}\b(on|to)\s+my calendar\b`,
    String.raw`\bschedule\s+(gym|dentist|lunch|dinner|haircut|doctor|workout|run|errand)\b`,
    String.raw`\b(set|add|put|schedule)\s+(a |an )?.{0,40}\b(appointment|reminder)\b`,
    String.raw`\b(add|put|set|schedule)\s+(a |an |my |this )?(call|meeting|appointment|event|reminder)\b`,
  ].join("|"),
  "i",
);
const WEEKDAY_WORDS = "sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:r(?:s)?)?|fri|sat";
const RELATIVE_WORDS = "today|tonight|tomorrow";
const MONTH_WORDS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec";

function collapseDuplicateSpeech(raw: string): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  const words = t.split(" ").filter(Boolean);
  if (words.length < 6) return t;
  const max = Math.min(12, Math.floor(words.length / 2));
  for (let i = max; i >= 3; i -= 1) {
    const head = words.slice(0, i).join(" ").toLowerCase();
    const next = words.slice(i, i * 2).join(" ").toLowerCase();
    if (head && head === next) return words.slice(i).join(" ");
  }
  return t;
}

function stripWakeWord(raw: string): string {
  let t = collapseDuplicateSpeech(raw);
  t = t.replace(/^(hey |ok |okay |hi |yo )?ara[,:]?\s+/i, "").trim();
  t = t.replace(/^(please[, ]+)+/i, "").trim();
  if (!/\b(hear me|are you there|are you listening)\b/i.test(t)) {
    t = t.replace(/^((i want you to|i need you to|i(?:'d| would) like you to|can you please|could you please|can you|could you|would you|will you)\s+)+/i, "").trim();
  }
  t = t.replace(/^(please[, ]+)+/i, "").trim();
  return t.replace(/\s+/g, " ").trim();
}

export function isPersonalCalendarCommand(raw: string): boolean {
  const lower = stripWakeWord(raw).toLowerCase();
  if (!lower) return false;
  if (SALES_BOOKING_RE.test(lower)) return false;
  if (VIEW_CALENDAR_RE.test(lower) && !/\b(remind|reminder|add |put |set a )\b/.test(lower)) return false;
  if (isOwnerCalendarManageCommand(raw)) return false;
  if (PERSONAL_HINT_RE.test(lower)) return true;
  return /\bon my calendar\b/.test(lower) && /\b(remind|reminder|add|put|set|schedule)\b/.test(lower);
}

function stripWhenFromTitle(s: string): string {
  let t = s;
  t = t.replace(new RegExp(`\\b(next\\s+)?(this\\s+)?(on\\s+)?(${WEEKDAY_WORDS})s?\\b`, "gi"), " ");
  t = t.replace(new RegExp(`\\b(${RELATIVE_WORDS})\\b`, "gi"), " ");
  t = t.replace(new RegExp(`\\b(${MONTH_WORDS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"), " ");
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  t = t.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  t = t.replace(/\b(at\s+)?\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/gi, " ");
  t = t.replace(/\bat\s+\d{1,2}(:\d{2})?\b/gi, " ");
  t = t.replace(/\b(at\s+)?(noon|midnight|midday)\b/gi, " ");
  t = t.replace(/\bfor\s+\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\b/gi, " ");
  t = t.replace(/\b(on|to)\s+my calendar\b/gi, " ");
  return t.replace(/\s+/g, " ").trim();
}

function tidyOwnerTitle(s: string): string {
  let t = s.replace(/^[-–—,:;.\s]+|[-–—,:;.\s]+$/g, "").trim();
  t = t.replace(/^(a |an |the )/i, "");
  t = t.replace(/^that i (need to |have to |should )/i, "");
  t = t.replace(/^to\s+/i, "");
  t = t.replace(/^['"]|['"]$/g, "").trim();
  if (t && t[0] === t[0].toLowerCase()) t = t[0].toUpperCase() + t.slice(1);
  return t.slice(0, 200);
}

export type OwnerCalendarSpeech =
  | { matched: false }
  | { matched: true; title: string; when: string; generic: boolean };

const GENERIC_TITLE_RE = /^(a |an |the |my )?(call|meeting|appointment|event|reminder|sales call)( with| for)?$/i;

export function isGenericOwnerTitle(title: string): boolean {
  const t = (title || "").trim().replace(/[?.!,]/g, "");
  if (!t) return true;
  return GENERIC_TITLE_RE.test(t);
}

export function ownerGenericNameQuestion(title: string): string {
  const t = (title || "").toLowerCase();
  if (/\bmeeting\b/.test(t)) return "What should I name the meeting?";
  if (/\bappointment\b/.test(t)) return "What should I name the appointment?";
  if (/\breminder\b/.test(t)) return "What should I name the reminder?";
  return "What should I name the call?";
}

function extractSubjectTitle(rawTitle: string): string {
  let t = tidyOwnerTitle(stripWhenFromTitle(rawTitle));
  const withFor = t.match(/^(call|meeting|appointment|event|reminder|sales call)\s+(with|for)\s+(.+)$/i);
  if (withFor?.[3]) t = tidyOwnerTitle(withFor[3]);
  return t;
}

export function parseOwnerCalendarSpeech(raw: string): OwnerCalendarSpeech {
  const stripped = stripWakeWord(raw);
  if (!isPersonalCalendarCommand(stripped)) return { matched: false };

  const quoted = stripped.match(/['"“”‘’](.+?)['"“”‘’]/);
  const thatNeed = stripped.match(/\bthat i (?:need to |have to |should )?(.+)$/i);
  const remindTo = stripped.match(/\bremind me(?: on my calendar)?(?: to | that i (?:need to |have to )?)(.+)$/i);

  let title = "";
  if (quoted?.[1]) title = quoted[1];
  else if (thatNeed?.[1]) title = thatNeed[1];
  else if (remindTo?.[1]) title = remindTo[1];
  else {
    title = stripped
      .replace(/^(please\s+)/i, "")
      .replace(/^(set|add|put|schedule)\s+(a |an )?(reminder|event)\s+(on my calendar\s+)?(for\s+)?/i, "")
      .replace(/^(set|add|put|schedule)\s+(a |an |my |this )?/i, "")
      .replace(/\s+(on|to)\s+my calendar\b/i, " ");
  }
  title = extractSubjectTitle(title);
  const generic = isGenericOwnerTitle(title);
  return { matched: true, title: generic ? tidyOwnerTitle(title) || "Call" : title, when: stripped, generic };
}

export function extractOwnerFollowupTitle(raw: string): string {
  let t = stripWakeWord(raw);
  t = t.replace(/^(add|put|schedule|set)\s+(it|that|this)\s+(for|with|as)\s+/i, "");
  t = t.replace(/^(add|put|schedule)\s+(it|that|this)\s+/i, "");
  t = t.replace(/^(it'?s|it is|call it|name it|name the (call|meeting|appointment|event)|make it)\s+/i, "");
  t = t.replace(/^(for|with)\s+/i, "");
  t = extractSubjectTitle(t);
  if (isGenericOwnerTitle(t)) return "";
  return t;
}

export function isOwnerCalendarFollowupTime(raw: string): boolean {
  const t = stripWakeWord(raw);
  if (!t || isPersonalCalendarCommand(t)) return false;
  if (/\b(cancel|never mind|forget it|stop)\b/i.test(t)) return false;
  return Boolean(parseClock(t));
}

export function isOwnerCalendarFollowupName(raw: string): boolean {
  const t = stripWakeWord(raw);
  if (!t) return false;
  if (isConversationalAside(t)) return false;
  if (isOwnerCalendarCorrection(t)) return false;
  if (/\b(cancel|never mind|forget it|stop)\b/i.test(t) && t.length < 24) return false;
  if (isOwnerCalendarManageCommand(t)) return false;
  if (isOwnerCalendarFollowupTime(t) && t.length < 16) return false;
  const title = extractOwnerFollowupTitle(t);
  return Boolean(title) && !isGenericOwnerTitle(title);
}

export type PendingOwnerCal = {
  title: string;
  when: string;
  need?: "time" | "when" | "name" | "which";
  intent?: "create" | "rename";
  eventId?: string;
  at?: number;
};

const PENDING_OWNER_CAL_TTL_MS = 15 * 60 * 1000;

export function pendingOwnerCalExpired(pending?: PendingOwnerCal | null, now = Date.now()): boolean {
  if (!pending) return true;
  if (!pending.at) return false;
  return now - pending.at > PENDING_OWNER_CAL_TTL_MS;
}

/** Open/show/pull up/go to Calendar — not scheduling speech that merely mentions calendar. */
export function isExplicitCalendarNavigate(raw: string): boolean {
  const t = stripWakeWord(raw).toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (SALES_BOOKING_RE.test(t)) return false;
  if (isPersonalCalendarCommand(raw)) return false;
  if (isOwnerCalendarManageCommand(raw)) return false;
  if (/^(my |the )?calendar$/.test(t)) return true;
  return VIEW_CALENDAR_RE.test(t);
}

export function isConversationalAside(raw: string): boolean {
  const lower = (raw || "").toLowerCase();
  if (/\bcan you hear me\b/.test(lower)) return true;
  if (/\bare you (there|listening|on)\b/.test(lower)) return true;
  const t = stripWakeWord(raw).toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/^(are you (there|listening|on)|you there|you listening|hear me)$/.test(t)) return true;
  if (/^(hello|hi|hey|thanks|thank you|okay|ok|yes|yeah|yep|nope)( ara)?$/.test(t)) return true;
  if (/^ara$/.test(t)) return true;
  return false;
}

export function isOwnerCalendarCorrection(raw: string): boolean {
  const t = stripWakeWord(raw).toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /\bthat('s| is) not (the name|what i|the one)\b/.test(t)
    || /\bnot the name i wanted\b/.test(t)
    || /\bwrong name\b/.test(t)
    || /\brename (it|that|the (call|event|meeting|appointment))\b/.test(t)
    || /\bi (didn't|did not) (want|mean) that name\b/.test(t)
    || /\bthat is not the name i wanted you to name\b/.test(t)
  );
}

export function ownerCalendarRenameQuestion(): string {
  return "What should I rename it to?";
}

export function shouldKeepPendingOwnerCalendar(raw: string, pending?: PendingOwnerCal | null): boolean {
  if (!pending) return false;
  if (pendingOwnerCalExpired(pending)) return false;
  if (isOwnerCalendarCorrection(raw)) return true;
  if (isConversationalAside(raw)) return true;
  if (isOwnerCalendarFollowupName(raw) || isOwnerCalendarFollowupTime(raw)) return true;
  if (isPersonalCalendarCommand(raw) || isOwnerCalendarManageCommand(raw)) return true;
  return false;
}

export function expandRangeToOwnerDays(from: Date, to: Date, timeZone = OWNER_TZ_DEFAULT): { from: Date; to: Date } {
  const startYmd = ymdInTimezone(from, timeZone);
  const [y, m, d] = startYmd.split("-").map(Number);
  const start = fromZonedLocal(y, m, d, 0, 0, timeZone);
  const end = to.getTime() > start.getTime() ? to : new Date(start.getTime() + 24 * 3600 * 1000);
  return { from: start, to: end };
}

/** True when Ara must stop talking and let the app own this personal-calendar turn. */
export function shouldSilenceAraForOwnerCalendar(
  raw: string,
  pending?: PendingOwnerCal | null,
): boolean {
  const t = (raw || "").trim();
  if (!t) return false;
  if (/\bwhat did you (just )?add\b|\bwhat did you (just )?put on (my )?calendar\b/i.test(t)) return true;
  if (isOwnerCalendarCorrection(t)) return true;
  if (isConversationalAside(t)) return false;
  if (isExplicitCalendarNavigate(t)) return false;
  if (isOwnerCalendarManageCommand(t)) return true;
  if (isPersonalCalendarCommand(t)) return true;
  if (pending?.need === "name" && isOwnerCalendarFollowupName(t)) return true;
  if (pending?.need === "which" && isOwnerCalendarFollowupName(t)) return true;
  if (pending && isOwnerCalendarFollowupTime(t)) return true;
  return false;
}

/** The production refusal Ara used before personal events were wired. */
export function isOwnerCalendarRefusalSpeech(raw: string): boolean {
  const t = (raw || "").toLowerCase();
  if (!t) return false;
  if (/i('ll| will) prepare that calendar booking/.test(t)) return true;
  if (/don'?t have a tool to add personal (reminders|events)/.test(t)) return true;
  if (/i can open your calendar or help with sales call bookings/.test(t)) return true;
  if (/only the ones i created( myself)?/.test(t)) return true;
  if (/can'?t delete or remove anything from your google calendar/.test(t)) return true;
  if (/only calendar tool i have is for adding/.test(t)) return true;
  return false;
}

export function sanitizeOwnerTitle(raw: string): string {
  const parsed = parseOwnerCalendarSpeech(raw);
  if (parsed.matched && parsed.title) return parsed.title;
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

export function ownerLinkedCallSpeech(name: string, whenLabel: string): string {
  return `Done — I scheduled ${name} for ${whenLabel} and linked the call to their Lamb Ascension profile.`;
}

export function ownerUnlinkedCallSpeech(title: string, whenLabel: string): string {
  return `I scheduled ‘${title}’ for ${whenLabel}. I didn't find a matching Lamb Ascension prospect, so it isn't linked to a company profile.`;
}

export function ownerAmbiguousProspectSpeech(matches: { name: string; city?: string }[]): string {
  const bits = matches.slice(0, 4).map((m) => (m.city ? `${m.name} in ${m.city}` : m.name));
  const noun = matches.length === 2 ? "two" : String(matches.length);
  const label = matches[0]?.name || "matching";
  return `I found ${noun} ${label} records. Which one do you mean — ${bits.join(" or ")}?`;
}

export function ownerEventFailureSpeech(): string {
  return "I couldn't create that event, so nothing was added.";
}

export function ownerEventSpeechFromState(last: LastOwnerEvent | null | undefined): string {
  if (!last) return "I haven’t added a personal calendar event this session.";
  return `I added ‘${last.title}’ to your calendar for ${last.whenLabel}.`;
}

const LAST_EVENT_RE = /\b(the event i just added|the one i just (added|put|created)|what you just (added|put)|that event i just added)\b/i;
const LIST_MANAGE_RE = /\bwhat (do i have|have i got)\b|\bwhat(?:'s| is) on my calendar\b|\bshow (me )?(my )?(events|calendar events)\b|\bwhat(?:'s| is) on (the )?calendar\b|\bwhen is (my |the )?(?!next\b)(.{0,80})\bcall\b/i;
const DELETE_MANAGE_RE = /\b(delete|remove)\b|\bcancel (the |my |this )?(event|appointment|reminder|meeting|dentist|gym|lunch|bank|call)\b|\bcancel .{0,80}\bcall\b/i;
const UPDATE_MANAGE_RE = /\b(move|reschedule)\b|\bchange\b.{0,80}\b(to |from )\b|\brename\b/i;
const CAL_NOUN_RE = /\b(event|appointment|reminder|meeting|dentist|gym|lunch|bank|calendar|insurance|call)\b/;
const MOVE_TIME_RE = /\b(to|at|from)\s+(\d{1,2}|noon|midnight)/i;

export type OwnerCalendarManage =
  | { kind: "none" }
  | {
      kind: "list" | "delete" | "update";
      title: string;
      when: string;
      lastEvent: boolean;
      newTime?: string;
      newTitle?: string;
    };

function isBareCalendarNavigate(t: string): boolean {
  return VIEW_CALENDAR_RE.test(t) && !/\b(tomorrow|today|tonight|afternoon|morning|evening|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t) && !/\bevents\b/.test(t);
}

export function isOwnerCalendarManageCommand(raw: string): boolean {
  const t = stripWakeWord(raw).toLowerCase();
  if (!t || SALES_BOOKING_RE.test(t)) return false;
  if (/^(cancel that|never mind|cancel it|forget it)$/.test(t)) return false;
  if (isBareCalendarNavigate(t)) return false;
  if (LIST_MANAGE_RE.test(t)) return true;
  if (DELETE_MANAGE_RE.test(t) && (CAL_NOUN_RE.test(t) || LAST_EVENT_RE.test(t))) return true;
  if (/\b(pipeline|home|background|overlay|focal|widget|image|preset)\b/.test(t)) return false;
  if (/\brename\b/.test(t)) return true;
  if (/\b(move|reschedule)\b/.test(t) && (CAL_NOUN_RE.test(t) || LAST_EVENT_RE.test(t) || MOVE_TIME_RE.test(t) || /\b(that|it)\b/.test(t))) return true;
  if (/\bchange\b/.test(t) && /\b(to|from)\b/.test(t) && (CAL_NOUN_RE.test(t) || MOVE_TIME_RE.test(t))) return true;
  return false;
}

export function parseOwnerCalendarManage(raw: string): OwnerCalendarManage {
  const stripped = stripWakeWord(raw);
  const t = stripped.toLowerCase();
  if (!isOwnerCalendarManageCommand(stripped)) return { kind: "none" };
  let lastEvent = LAST_EVENT_RE.test(t);
  let kind: "list" | "delete" | "update" = "list";
  if (DELETE_MANAGE_RE.test(t) && !UPDATE_MANAGE_RE.test(t)) kind = "delete";
  else if (UPDATE_MANAGE_RE.test(t)) kind = "update";
  else if (LIST_MANAGE_RE.test(t)) kind = "list";
  else if (DELETE_MANAGE_RE.test(t)) kind = "delete";

  const fromTo = stripped.match(/\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight)\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i);
  const toTime = stripped.match(/\b(?:to|at)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i);
  const rename = stripped.match(/\brename\s+['"“”‘’]?(.+?)['"“”‘’]?\s+to\s+['"“”‘’]?(.+?)['"“”‘’]?\s*$/i);
  const whenIs = stripped.match(/\bwhen is (?:my |the |our )?(.+?)\s+call\b/i);

  let title = "";
  if (whenIs?.[1] && kind === "list") title = tidyOwnerTitle(whenIs[1]);
  else if (kind === "list") title = "";
  else if (rename?.[1] && kind === "update") title = rename[1];
  else {
    title = stripped
      .replace(/^(please\s+)/i, "")
      .replace(/^(delete|remove|cancel|move|reschedule|change|rename)\s+(the |my |this )?/i, "")
      .replace(/\b(from my calendar|on my calendar|from the calendar)\b/gi, " ");
    title = tidyOwnerTitle(stripWhenFromTitle(title));
    title = title.replace(/\b(from|to)\b/gi, " ").replace(/\s+/g, " ").trim();
    title = tidyOwnerTitle(title.replace(/\b(call|event|appointment|reminder|meeting)\b/gi, " "));
  }
  if (kind !== "list") {
    title = tidyOwnerTitle(title.replace(/\b(call|event|appointment|reminder|meeting)\b/gi, " "));
  }
  if (/^(event|appointment|reminder|meeting|one|that|it|this|call)$/i.test(title)) {
    if (/^(that|it|this)$/i.test(title)) lastEvent = true;
    title = "";
  }

  const newTitle = rename?.[2] ? tidyOwnerTitle(rename[2]) : undefined;
  const newTime = kind === "update" ? (fromTo?.[2] || (rename ? undefined : toTime?.[1]) || undefined) : undefined;
  const when = fromTo?.[1] ? stripped.replace(fromTo[0], `at ${fromTo[1]}`) : stripped;

  return {
    kind,
    title,
    when,
    lastEvent,
    newTime: newTime ? String(newTime) : undefined,
    newTitle,
  };
}

export type OwnerWindow = {
  ok: true;
  from: Date;
  to: Date;
  label: string;
  start?: Date;
  hasClock: boolean;
};

export function resolveOwnerWindow(input: { when?: string; timezone?: string; now?: Date }): OwnerWindow | { ok: false } {
  const timezone = input.timezone || OWNER_TZ_DEFAULT;
  const now = input.now || new Date();
  const blob = (input.when || "").trim();
  const today = ymdInTimezone(now, timezone);
  const dated = parseDateYmd(blob, today, timezone);
  const clock = parseClock(blob, { tonight: /\btonight\b/i.test(blob) });
  const afternoon = /\bafternoon\b/i.test(blob);
  const morning = /\bmorning\b/i.test(blob);
  const evening = /\b(evening|tonight)\b/i.test(blob);
  const week = /\bthis week\b/i.test(blob);

  if (week) {
    return { ok: true, from: now, to: new Date(now.getTime() + 7 * 86400000), label: "this week", hasClock: false };
  }

  let ymd = dated?.ymd || today;
  if (!dated && clock) {
    const todayStart = fromZonedLocal(Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10)), clock.hour, clock.minute, timezone);
    ymd = todayStart.getTime() > now.getTime() ? today : addDaysYmd(today, 1);
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const label = dated?.label || (ymd === today ? "today" : ymd === addDaysYmd(today, 1) ? "tomorrow" : ymd);

  if (clock) {
    const start = fromZonedLocal(y, m, d, clock.hour, clock.minute, timezone);
    return {
      ok: true,
      from: new Date(start.getTime() - 90 * 60 * 1000),
      to: new Date(start.getTime() + 90 * 60 * 1000),
      label,
      start,
      hasClock: true,
    };
  }
  if (afternoon) {
    return { ok: true, from: fromZonedLocal(y, m, d, 12, 0, timezone), to: fromZonedLocal(y, m, d, 18, 0, timezone), label: `${label} afternoon`, hasClock: false };
  }
  if (morning) {
    return { ok: true, from: fromZonedLocal(y, m, d, 5, 0, timezone), to: fromZonedLocal(y, m, d, 12, 0, timezone), label: `${label} morning`, hasClock: false };
  }
  if (evening) {
    return { ok: true, from: fromZonedLocal(y, m, d, 17, 0, timezone), to: fromZonedLocal(y, m, d, 23, 59, timezone), label: evening && /\btonight\b/i.test(blob) ? "tonight" : `${label} evening`, hasClock: false };
  }
  return {
    ok: true,
    from: fromZonedLocal(y, m, d, 0, 0, timezone),
    to: fromZonedLocal(y, m, d, 23, 59, timezone),
    label,
    hasClock: false,
  };
}

export type ManageMatch<T extends { id: string; title: string; start: string }> = {
  matches: T[];
  ambiguous: boolean;
};

export function scoreCalendarMatch(event: { title: string; start: string }, query: { title?: string; startMs?: number; windowMs?: number }): number {
  const et = event.title.toLowerCase();
  const qt = (query.title || "").toLowerCase().replace(/\b(the|my|a|an|event|appointment|reminder|meeting|ones?|call)\b/g, " ").replace(/\s+/g, " ").trim();
  let score = 0;
  if (!qt) score += 1;
  else if (et === qt) score += 10;
  else if (et.includes(qt) || qt.includes(et)) score += 8;
  else {
    const tokens = qt.split(" ").filter((w) => w.length > 2);
    const hits = tokens.filter((tok) => et.includes(tok));
    if (!tokens.length) score += 1;
    else if (hits.length === tokens.length) score += 6;
    else if (hits.length) score += 2;
    else return 0;
  }
  if (query.startMs != null) {
    const t = Date.parse(event.start);
    if (!Number.isFinite(t)) return 0;
    const window = query.windowMs ?? 90 * 60 * 1000;
    const delta = Math.abs(t - query.startMs);
    if (delta > window) return 0;
    score += Math.max(0, 5 - Math.floor(delta / (15 * 60 * 1000)));
  }
  return score;
}

export function pickCalendarMatches<T extends { id: string; title: string; start: string }>(
  events: T[],
  query: { title?: string; startMs?: number; windowMs?: number },
): ManageMatch<T> {
  const scored = events
    .map((e) => ({ e, s: scoreCalendarMatch(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { matches: [], ambiguous: false };
  const top = scored[0].s;
  const strong = scored.filter((x) => x.s >= Math.max(query.title ? 6 : 1, top - 1));
  if (strong.length > 1) return { matches: strong.map((x) => x.e), ambiguous: true };
  return { matches: [scored[0].e], ambiguous: false };
}

export function formatEventWhen(startIso: string, timeZone: string, now: Date): string {
  const d = new Date(startIso);
  if (!Number.isFinite(d.getTime())) return startIso;
  return formatOwnerWhen(d, timeZone, now);
}

export function ownerListSpeech(events: { title: string; start: string }[], label: string, timeZone: string, now: Date): string {
  if (!events.length) return `Nothing on your calendar ${label}.`;
  const bits = events.slice(0, 12).map((e) => `‘${e.title}’ ${formatEventWhen(e.start, timeZone, now)}`);
  if (events.length === 1) return `${label[0].toUpperCase()}${label.slice(1)} you have ${bits[0]}.`;
  return `${label[0].toUpperCase()}${label.slice(1)} you have ${events.length} events: ${bits.join("; ")}.`;
}

export function ownerDeleteSuccessSpeech(title: string): string {
  return `Done — I removed ‘${title}’ from your calendar.`;
}

export function ownerDeleteMissingSpeech(): string {
  return "I couldn't find a matching event, so I didn't delete anything.";
}

export function ownerUpdateSuccessSpeech(title: string, whenLabel: string): string {
  return `Done — I moved ‘${title}’ to ${whenLabel}.`;
}

export function ownerUpdateFailureSpeech(): string {
  return "I couldn't update that event, so nothing changed.";
}

export function ownerAmbiguousSpeech(events: { title: string; start: string }[], timeZone: string, now: Date, verb: "delete" | "change"): string {
  const bits = events.slice(0, 4).map((e) => `${e.title} (${formatEventWhen(e.start, timeZone, now)})`);
  return `I found ${events.length} events: ${bits.join(" and ")}. Which should I ${verb}?`;
}

export function ownerAlreadyGoneSpeech(): string {
  return "That event is already gone.";
}

export function ownerSalesDeleteConfirmSpeech(title: string, attendees: number): string {
  if (attendees > 0) {
    return `This event is a booked sales call with an attendee. Deleting it may affect the prospect record. Do you want me to cancel ‘${title}’?`;
  }
  return `This event is a booked sales call. Deleting it may affect the prospect record. Do you want me to cancel ‘${title}’?`;
}

export function ownerGuestDeleteConfirmSpeech(title: string): string {
  return `‘${title}’ has guests. Deleting it will not email them. Do you want me to remove it?`;
}

export function ownerSalesUpdateConfirmSpeech(title: string): string {
  return `‘${title}’ is a booked sales call. Changing it may affect the prospect record. Do you want me to update it?`;
}

export function isOwnerCalendarConfirmYes(raw: string): boolean {
  const t = stripWakeWord(raw).toLowerCase().replace(/[?.!,]/g, "").trim();
  return /^(yes|yeah|yep|do it|go ahead|please do|cancel it|delete it|remove it|confirm)$/.test(t);
}

export function isOwnerCalendarConfirmNo(raw: string): boolean {
  const t = stripWakeWord(raw).toLowerCase().replace(/[?.!,]/g, "").trim();
  return /^(no|nope|never mind|forget it|stop|don'?t|do not)$/.test(t);
}
