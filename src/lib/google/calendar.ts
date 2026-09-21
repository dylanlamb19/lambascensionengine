import { openSlots, type Busy } from "../calendar/slots.ts";
import {
  calendarFailureReason,
  calendarScopeFlags,
  classifyGoogleCalendarHttp,
  classifyCalendarListHttp,
  calendarListUserReason,
  googleErrorReason,
  CALENDAR_API_DISABLED_MESSAGE,
  type CalendarFailureCode,
  type CalendarListCode,
} from "./calendar-errors.ts";
import { toOffsetIso } from "../calendar/owner-event.ts";

export const CALENDAR_UNREADABLE =
  "Lamb Ascension couldn’t verify your calendar availability. No time was booked.";

export const CALENDAR_VIEW_UNREADABLE =
  "Lamb Ascension couldn’t read your Google Calendar. I’m not guessing what’s on it.";

const LIST_FIELDS = "nextPageToken,items(id,status,summary,htmlLink,location,description,attendees,start,end,eventType,recurringEventId)";
const LIST_MAX_PAGES = 6;
const LIST_PAGE_SIZE = 100;

export type GoogleCalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  htmlLink?: string;
  attendees: number;
  location?: string;
  description?: string;
  allDay?: boolean;
  sales?: boolean;
};

export type FreeBusyMeta = {
  httpStatus: number;
  googleReason: string;
  calendarId: string;
};

async function readGoogleError(res: Response): Promise<{ status: number; body: string; code: CalendarFailureCode; googleReason: string }> {
  const body = await res.text().catch(() => "");
  return {
    status: res.status,
    body,
    code: classifyGoogleCalendarHttp(res.status, body),
    googleReason: googleErrorReason(body),
  };
}

function freeBusyItemIds(calendarId?: string): string[] {
  const ids: string[] = [];
  const verified = (calendarId || "").trim();
  if (verified && verified.includes("@")) ids.push(verified);
  if (!ids.includes("primary")) ids.push("primary");
  return ids;
}

type CalBusy = { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] };

function pickReadableCalendar(
  calendars: Record<string, CalBusy> | undefined,
  preferred?: string,
): { id: string; busy: { start: string; end: string }[] } | { id: string; error: string } | null {
  const map = calendars || {};
  const entries = Object.entries(map);
  if (!entries.length) return null;
  const tryId = (id: string) => {
    const row = map[id];
    if (!row) return null;
    if (row.errors && row.errors.length) return { id, error: String(row.errors[0]?.reason || "notFound") };
    return { id, busy: row.busy || [] };
  };
  if (preferred) {
    const hit = tryId(preferred);
    if (hit && !("error" in hit)) return hit;
  }
  for (const [id, row] of entries) {
    if (!row.errors?.length) return { id, busy: row.busy || [] };
  }
  const first = tryId(entries[0][0]);
  return first && "error" in first ? first : { id: entries[0][0], error: "notFound" };
}

export async function probeCalendarApiEnabled(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  calendarId?: string,
): Promise<{ enabled: boolean | "unknown"; code: CalendarFailureCode | null; reason: string }> {
  try {
    const from = new Date();
    const to = new Date(from.getTime() + 60 * 60 * 1000);
    const res = await fetchImpl("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone: "UTC",
        items: freeBusyItemIds(calendarId).map((id) => ({ id })),
      }),
    });
    if (res.ok) return { enabled: true, code: null, reason: "" };
    const err = await readGoogleError(res);
    if (err.code === "CALENDAR_API_DISABLED") {
      return { enabled: false, code: err.code, reason: CALENDAR_API_DISABLED_MESSAGE };
    }
    if (err.code === "CALENDAR_NOT_AUTHORIZED" || err.code === "CALENDAR_SCOPE_MISSING") {
      return { enabled: true, code: err.code, reason: "" };
    }
    return { enabled: "unknown", code: err.code, reason: calendarFailureReason(err.code) };
  } catch {
    return { enabled: "unknown", code: "FREEBUSY_PROVIDER_ERROR", reason: CALENDAR_UNREADABLE };
  }
}

export function asIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T00:00:00`;
    return t;
  }
  if (value && typeof value === "object" && typeof (value as { toISOString?: unknown }).toISOString === "function") {
    try {
      const iso = (value as Date).toISOString();
      return typeof iso === "string" ? iso : "";
    } catch {
      return "";
    }
  }
  return "";
}

function pickEventInstant(slot: unknown): { iso: string; allDay: boolean } | null {
  if (!slot || typeof slot !== "object") return null;
  const rec = slot as { dateTime?: unknown; date?: unknown };
  const dateTime = asIsoTimestamp(rec.dateTime);
  if (dateTime) return { iso: dateTime, allDay: false };
  const dateOnly = typeof rec.date === "string" ? rec.date.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return { iso: `${dateOnly}T00:00:00`, allDay: true };
  return null;
}

function attendeeCount(raw: unknown): number {
  if (!raw) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === "object") return Object.keys(raw as object).length;
  return 0;
}

/**
 * One parser for Calendar page, Ara list/search, delete, and reschedule.
 * Never throws. One unusual Google event is skipped instead of failing the whole calendar.
 */
export function normalizeGoogleCalendarEvent(raw: unknown): GoogleCalEvent | null {
  if (raw == null || typeof raw !== "object") return null;
  const item = raw as {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    htmlLink?: unknown;
    location?: unknown;
    description?: unknown;
    attendees?: unknown;
    start?: unknown;
    end?: unknown;
  };
  const id = String(item.id || "").trim();
  if (!id) return null;
  const status = String(item.status || "confirmed").toLowerCase();
  if (status === "cancelled") return null;
  const start = pickEventInstant(item.start);
  if (!start) return null;
  const end = pickEventInstant(item.end);
  const titleRaw = typeof item.summary === "string" ? item.summary.trim() : "";
  const htmlLink = typeof item.htmlLink === "string" ? item.htmlLink : undefined;
  const location = typeof item.location === "string" ? item.location : undefined;
  const description = typeof item.description === "string" ? item.description : undefined;
  return {
    id,
    title: titleRaw || "(No title)",
    start: start.iso,
    end: end?.iso || start.iso,
    status: status || "confirmed",
    htmlLink,
    attendees: attendeeCount(item.attendees),
    location,
    description,
    allDay: start.allDay,
  };
}

export function compareEventStart(a: { start: unknown }, b: { start: unknown }): number {
  const as = Date.parse(asIsoTimestamp(a.start)) || 0;
  const bs = Date.parse(asIsoTimestamp(b.start)) || 0;
  return as - bs;
}

function itemsFromListJson(json: { items?: unknown }): unknown[] {
  if (json.items == null) return [];
  if (Array.isArray(json.items)) return json.items;
  if (typeof json.items === "object") return Object.values(json.items as Record<string, unknown>);
  return [];
}

export async function listEvents(
  accessToken: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
  calendarId?: string,
): Promise<
  | { ok: true; events: GoogleCalEvent[]; calendarId: string }
  | { ok: false; reason: string; code: CalendarListCode; httpStatus: number; googleReason: string; calendarId: string }
> {
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    return {
      ok: false,
      reason: calendarListUserReason("CALENDAR_LIST_BAD_RANGE"),
      code: "CALENDAR_LIST_BAD_RANGE",
      httpStatus: 0,
      googleReason: "bad_range",
      calendarId: calendarId || "primary",
    };
  }
  const ids: string[] = ["primary"];
  const preferred = (calendarId || "").trim();
  if (preferred && preferred !== "primary" && !ids.includes(preferred)) ids.push(preferred);

  let lastFail: Extract<Awaited<ReturnType<typeof listEventsOnCalendar>>, { ok: false }> | null = null;
  for (const id of ids) {
    const hit = await listEventsOnCalendar(accessToken, from, to, id, fetchImpl);
    if (hit.ok) return hit;
    lastFail = hit;
    if (hit.httpStatus === 401 || hit.code === "CALENDAR_LIST_AUTH_FAILED") return hit;
  }
  return lastFail || {
    ok: false,
    reason: calendarListUserReason("CALENDAR_LIST_PARSE_FAILED"),
    code: "CALENDAR_LIST_PARSE_FAILED",
    httpStatus: 0,
    googleReason: "empty",
    calendarId: ids[0] || "primary",
  };
}

async function listEventsOnCalendar(
  accessToken: string,
  from: Date,
  to: Date,
  calendarId: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; events: GoogleCalEvent[]; calendarId: string }
  | { ok: false; reason: string; code: CalendarListCode; httpStatus: number; googleReason: string; calendarId: string }
> {
  const events: GoogleCalEvent[] = [];
  let pageToken = "";
  let usedFields = true;
  try {
    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("timeMin", from.toISOString());
      url.searchParams.set("timeMax", to.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", String(LIST_PAGE_SIZE));
      url.searchParams.set("timeZone", "America/Chicago");
      if (usedFields) url.searchParams.set("fields", LIST_FIELDS);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const raw = await res.text().catch(() => "");
      if (!res.ok) {
        if (usedFields && res.status === 400 && page === 0) {
          usedFields = false;
          page -= 1;
          continue;
        }
        const code = classifyCalendarListHttp(res.status, raw);
        if (events.length && code !== "CALENDAR_LIST_AUTH_FAILED") {
          return { ok: true, events, calendarId };
        }
        return {
          ok: false,
          reason: code === "CALENDAR_API_DISABLED" ? CALENDAR_API_DISABLED_MESSAGE : calendarListUserReason(code),
          code,
          httpStatus: res.status,
          googleReason: googleErrorReason(raw),
          calendarId,
        };
      }
      let json: { error?: { message?: string }; items?: unknown; nextPageToken?: unknown } = {};
      try {
        json = raw ? JSON.parse(raw) as { error?: { message?: string }; items?: unknown; nextPageToken?: unknown } : {};
      } catch {
        if (events.length) return { ok: true, events, calendarId };
        return {
          ok: false,
          reason: calendarListUserReason("CALENDAR_LIST_PARSE_FAILED"),
          code: "CALENDAR_LIST_PARSE_FAILED",
          httpStatus: res.status,
          googleReason: raw.trim().startsWith("<") ? "html_body" : "invalid_json",
          calendarId,
        };
      }
      const pageItems = itemsFromListJson(json);
      if (json.error && !pageItems.length && !events.length) {
        return {
          ok: false,
          reason: calendarListUserReason("CALENDAR_LIST_PARSE_FAILED"),
          code: "CALENDAR_LIST_PARSE_FAILED",
          httpStatus: res.status,
          googleReason: googleErrorReason(raw),
          calendarId,
        };
      }
      for (const item of pageItems) {
        const event = normalizeGoogleCalendarEvent(item);
        if (event) events.push(event);
      }
      pageToken = typeof json.nextPageToken === "string" ? json.nextPageToken : "";
      if (!pageToken) break;
    }
    events.sort(compareEventStart);
    return { ok: true, events, calendarId };
  } catch {
    if (events.length) return { ok: true, events, calendarId };
    return {
      ok: false,
      reason: calendarListUserReason("CALENDAR_LIST_UPSTREAM_5XX"),
      code: "CALENDAR_LIST_UPSTREAM_5XX",
      httpStatus: 0,
      googleReason: "network",
      calendarId,
    };
  }
}

export type ListBusyResult =
  | { ok: true; busy: Busy[]; calendarId: string }
  | { ok: false; reason: string; code: CalendarFailureCode; httpStatus: number; googleReason: string; calendarId: string };

export async function listBusy(
  accessToken: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
  calendarId?: string,
): Promise<ListBusyResult> {
  const ids = freeBusyItemIds(calendarId);
  try {
    const res = await fetchImpl("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        timeZone: "UTC",
        items: ids.map((id) => ({ id })),
      }),
    });
    if (!res.ok) {
      const err = await readGoogleError(res);
      return {
        ok: false,
        reason: err.code === "CALENDAR_API_DISABLED" ? CALENDAR_API_DISABLED_MESSAGE : calendarFailureReason(err.code),
        code: err.code,
        httpStatus: err.status,
        googleReason: err.googleReason,
        calendarId: ids[0] || "primary",
      };
    }
    const json = (await res.json()) as {
      error?: { message?: string };
      calendars?: Record<string, CalBusy>;
    };
    if (json.error) {
      const googleReason = googleErrorReason(JSON.stringify(json));
      return {
        ok: false,
        reason: CALENDAR_UNREADABLE,
        code: "FREEBUSY_FAILED",
        httpStatus: 200,
        googleReason,
        calendarId: ids[0] || "primary",
      };
    }
    const picked = pickReadableCalendar(json.calendars, calendarId && calendarId.includes("@") ? calendarId : "primary");
    if (!picked) {
      return {
        ok: false,
        reason: CALENDAR_UNREADABLE,
        code: "FREEBUSY_FAILED",
        httpStatus: 200,
        googleReason: "empty_calendars",
        calendarId: ids[0] || "primary",
      };
    }
    if ("error" in picked) {
      return {
        ok: false,
        reason: CALENDAR_UNREADABLE,
        code: classifyGoogleCalendarHttp(200, JSON.stringify({ calendars: json.calendars })),
        httpStatus: 200,
        googleReason: picked.error,
        calendarId: picked.id,
      };
    }
    return {
      ok: true,
      busy: picked.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
      calendarId: picked.id,
    };
  } catch {
    return {
      ok: false,
      reason: CALENDAR_UNREADABLE,
      code: "FREEBUSY_PROVIDER_ERROR",
      httpStatus: 0,
      googleReason: "network",
      calendarId: ids[0] || "primary",
    };
  }
}

export async function createEvent(
  accessToken: string,
  opts: {
    title: string;
    start: Date;
    end: Date;
    description?: string;
    location?: string;
    timeZone?: string;
    eventId?: string;
    reminderMinutes?: number[];
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; id: string; alreadyExisted?: boolean; htmlLink?: string } | { ok: false; error: string; code: CalendarFailureCode }> {
  const startPayload = opts.timeZone
    ? { dateTime: toOffsetIso(opts.start, opts.timeZone), timeZone: opts.timeZone }
    : { dateTime: opts.start.toISOString() };
  const endPayload = opts.timeZone
    ? { dateTime: toOffsetIso(opts.end, opts.timeZone), timeZone: opts.timeZone }
    : { dateTime: opts.end.toISOString() };
  const body: Record<string, unknown> = {
    summary: opts.title,
    description: opts.description || "",
    start: startPayload,
    end: endPayload,
  };
  if (opts.location) body.location = opts.location;
  if (opts.eventId) body.id = opts.eventId;
  if (opts.reminderMinutes && opts.reminderMinutes.length) {
    body.reminders = {
      useDefault: false,
      overrides: opts.reminderMinutes.map((minutes) => ({ method: "popup", minutes })),
    };
  }
  try {
    const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none";
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text().catch(() => "");
    let json: { id?: string; htmlLink?: string; error?: { message?: string } } = {};
    try { json = raw ? JSON.parse(raw) as { id?: string; htmlLink?: string; error?: { message?: string } } : {}; } catch { json = {}; }
    if (res.status === 409 && opts.eventId) {
      return { ok: true, id: opts.eventId, alreadyExisted: true };
    }
    if (!res.ok || !json.id) {
      const code = classifyGoogleCalendarHttp(res.status, raw);
      const mapped = code === "FREEBUSY_FAILED" ? "EVENT_CREATE_FAILED" : code;
      if (mapped === "CALENDAR_API_DISABLED") return { ok: false, error: CALENDAR_API_DISABLED_MESSAGE, code: mapped };
      return { ok: false, error: json.error?.message || calendarFailureReason(mapped), code: mapped };
    }
    return { ok: true, id: json.id, htmlLink: json.htmlLink };
  } catch {
    return { ok: false, error: calendarFailureReason("EVENT_CREATE_FAILED"), code: "EVENT_CREATE_FAILED" };
  }
}

export async function findMatchingEvent(
  accessToken: string,
  opts: { title: string; start: Date; windowMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleCalEvent | null> {
  const windowMs = opts.windowMs ?? 2 * 60 * 1000;
  const listed = await listEvents(
    accessToken,
    new Date(opts.start.getTime() - windowMs),
    new Date(opts.start.getTime() + windowMs + 60 * 1000),
    fetchImpl,
  );
  if (!listed.ok) return null;
  const want = opts.title.trim().toLowerCase();
  return listed.events.find((e) => {
    if (e.title.trim().toLowerCase() !== want) return false;
    const t = new Date(e.start).getTime();
    return Number.isFinite(t) && Math.abs(t - opts.start.getTime()) <= windowMs;
  }) || null;
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; alreadyGone?: boolean } | { ok: false; error: string; code: CalendarFailureCode }> {
  const id = encodeURIComponent(eventId);
  const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}?sendUpdates=none`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 410 || res.status === 404) return { ok: true, alreadyGone: true };
  if (res.ok || res.status === 204) return { ok: true };
  const err = await readGoogleError(res);
  return { ok: false, error: calendarFailureReason(err.code === "FREEBUSY_FAILED" ? "EVENT_CREATE_FAILED" : err.code), code: err.code };
}

export async function getEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; event: GoogleCalEvent } | { ok: false; missing?: boolean; reason: string; code: CalendarFailureCode }> {
  const id = encodeURIComponent(eventId);
  try {
    const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404 || res.status === 410) {
      return { ok: false, missing: true, reason: "That event is already gone.", code: "FREEBUSY_BAD_REQUEST" };
    }
    if (!res.ok) {
      const err = await readGoogleError(res);
      return { ok: false, reason: calendarFailureReason(err.code), code: err.code };
    }
    const json = await res.json().catch(() => null);
    const event = normalizeGoogleCalendarEvent(json);
    if (!event) return { ok: false, missing: true, reason: "That event is already gone.", code: "FREEBUSY_BAD_REQUEST" };
    return { ok: true, event };
  } catch {
    return { ok: false, reason: CALENDAR_VIEW_UNREADABLE, code: "FREEBUSY_PROVIDER_ERROR" };
  }
}

export async function patchEvent(
  accessToken: string,
  eventId: string,
  patch: {
    title?: string;
    start?: Date;
    end?: Date;
    timeZone?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; event: GoogleCalEvent } | { ok: false; error: string; code: CalendarFailureCode }> {
  const id = encodeURIComponent(eventId);
  const body: Record<string, unknown> = {};
  if (patch.title) body.summary = patch.title;
  if (patch.start) {
    body.start = patch.timeZone
      ? { dateTime: toOffsetIso(patch.start, patch.timeZone), timeZone: patch.timeZone }
      : { dateTime: patch.start.toISOString() };
  }
  if (patch.end) {
    body.end = patch.timeZone
      ? { dateTime: toOffsetIso(patch.end, patch.timeZone), timeZone: patch.timeZone }
      : { dateTime: patch.end.toISOString() };
  }
  try {
    const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}?sendUpdates=none`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      const err = await readGoogleError(new Response(raw, { status: res.status }));
      return { ok: false, error: calendarFailureReason(err.code === "FREEBUSY_FAILED" ? "EVENT_CREATE_FAILED" : err.code), code: err.code };
    }
    let json: unknown = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
    const event = normalizeGoogleCalendarEvent(json);
    if (!event) return { ok: false, error: calendarFailureReason("EVENT_CREATE_FAILED"), code: "EVENT_CREATE_FAILED" };
    return { ok: true, event };
  } catch {
    return { ok: false, error: calendarFailureReason("EVENT_CREATE_FAILED"), code: "EVENT_CREATE_FAILED" };
  }
}

export async function probeFreeBusy(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  calendarId?: string,
  scope?: string,
): Promise<{ ok: true; calendarId: string } | { ok: false; reason: string; code: CalendarFailureCode; httpStatus: number; googleReason: string; calendarId: string }> {
  const flags = calendarScopeFlags(scope);
  if (flags.listed && !flags.freebusy) {
    return {
      ok: false,
      reason: calendarFailureReason("CALENDAR_SCOPE_MISSING"),
      code: "CALENDAR_SCOPE_MISSING",
      httpStatus: 0,
      googleReason: "scope_missing",
      calendarId: calendarId || "primary",
    };
  }
  const from = new Date();
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const result = await listBusy(accessToken, from, to, fetchImpl, calendarId);
  if (!result.ok) return result;
  return { ok: true, calendarId: result.calendarId };
}

export async function offeredSlots(
  accessToken: string,
  opts: { from?: Date; count?: number; calendarId?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; busy: Busy[]; slots: { start: Date; end: Date; label: string }[] } | { ok: false; reason: string; slots: []; code: CalendarFailureCode }> {
  const from = opts.from || new Date();
  const result = await listBusy(accessToken, from, new Date(from.getTime() + 14 * 86400000), fetchImpl, opts.calendarId);
  if (!result.ok) return { ok: false, reason: CALENDAR_UNREADABLE, slots: [], code: result.code };
  return { ok: true, busy: result.busy, slots: openSlots({ from, busy: result.busy, count: opts.count ?? 3 }) };
}

export { openSlots, calendarScopeFlags, calendarListUserReason, classifyCalendarListHttp };
