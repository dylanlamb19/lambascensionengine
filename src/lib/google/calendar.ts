import { openSlots, type Busy } from "../calendar/slots.ts";
import {
  calendarFailureReason,
  calendarScopeFlags,
  classifyGoogleCalendarHttp,
  googleErrorReason,
  CALENDAR_API_DISABLED_MESSAGE,
  type CalendarFailureCode,
} from "./calendar-errors.ts";
import { toOffsetIso } from "../calendar/owner-event.ts";

export const CALENDAR_UNREADABLE =
  "Lamb Ascension couldn’t verify your calendar availability. No time was booked.";

export const CALENDAR_VIEW_UNREADABLE =
  "Lamb Ascension couldn’t read your Google Calendar. I’m not guessing what’s on it.";

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

export async function listEvents(
  accessToken: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; events: GoogleCalEvent[] } | { ok: false; reason: string; code: CalendarFailureCode }> {
  try {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", from.toISOString());
    url.searchParams.set("timeMax", to.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "80");
    const res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await readGoogleError(res);
      if (err.code === "CALENDAR_API_DISABLED") return { ok: false, reason: CALENDAR_API_DISABLED_MESSAGE, code: err.code };
      return { ok: false, reason: CALENDAR_VIEW_UNREADABLE, code: err.code };
    }
    const json = (await res.json()) as {
      error?: { message?: string };
      items?: {
        id?: string;
        summary?: string;
        status?: string;
        htmlLink?: string;
        location?: string;
        description?: string;
        attendees?: { email?: string }[];
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }[];
    };
    if (json.error || !Array.isArray(json.items)) return { ok: false, reason: CALENDAR_VIEW_UNREADABLE, code: "FREEBUSY_FAILED" };
    const events: GoogleCalEvent[] = [];
    for (const item of json.items) {
      if (!item.id) continue;
      if ((item.status || "").toLowerCase() === "cancelled") continue;
      const start = item.start?.dateTime || (item.start?.date ? `${item.start.date}T12:00:00` : "");
      const end = item.end?.dateTime || item.end?.date || "";
      if (!start) continue;
      events.push({
        id: item.id,
        title: (item.summary || "(No title)").trim(),
        start,
        end: end || start,
        status: item.status || "confirmed",
        htmlLink: item.htmlLink,
        attendees: Array.isArray(item.attendees) ? item.attendees.length : 0,
        location: item.location,
        description: item.description,
      });
    }
    return { ok: true, events };
  } catch {
    return { ok: false, reason: CALENDAR_VIEW_UNREADABLE, code: "FREEBUSY_FAILED" };
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
  const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 410 || res.status === 404) return { ok: true, alreadyGone: true };
  if (res.ok) return { ok: true };
  const err = await readGoogleError(res);
  return { ok: false, error: calendarFailureReason(err.code === "FREEBUSY_FAILED" ? "EVENT_CREATE_FAILED" : err.code), code: err.code };
}

function itemToEvent(item: {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  location?: string;
  description?: string;
  attendees?: { email?: string }[];
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
}): GoogleCalEvent | null {
  if (!item.id) return null;
  if ((item.status || "").toLowerCase() === "cancelled") return null;
  const start = item.start?.dateTime || (item.start?.date ? `${item.start.date}T12:00:00` : "");
  const end = item.end?.dateTime || item.end?.date || "";
  if (!start) return null;
  return {
    id: item.id,
    title: (item.summary || "(No title)").trim(),
    start,
    end: end || start,
    status: item.status || "confirmed",
    htmlLink: item.htmlLink,
    attendees: Array.isArray(item.attendees) ? item.attendees.length : 0,
    location: item.location,
    description: item.description,
  };
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
    const json = (await res.json()) as Parameters<typeof itemToEvent>[0] & { error?: { message?: string } };
    const event = itemToEvent(json);
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
    let json: Parameters<typeof itemToEvent>[0] = {};
    try { json = raw ? JSON.parse(raw) as Parameters<typeof itemToEvent>[0] : {}; } catch { json = {}; }
    const event = itemToEvent(json);
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

export { openSlots, calendarScopeFlags };
