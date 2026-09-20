import { openSlots, type Busy } from "../calendar/slots.ts";
import {
  calendarFailureReason,
  classifyGoogleCalendarHttp,
  CALENDAR_API_DISABLED_MESSAGE,
  type CalendarFailureCode,
} from "./calendar-errors.ts";

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
};

async function readGoogleError(res: Response): Promise<{ status: number; body: string; code: CalendarFailureCode }> {
  const body = await res.text().catch(() => "");
  return { status: res.status, body, code: classifyGoogleCalendarHttp(res.status, body) };
}

export async function probeCalendarApiEnabled(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
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
        items: [{ id: "primary" }],
      }),
    });
    if (res.ok) return { enabled: true, code: null, reason: "" };
    const err = await readGoogleError(res);
    if (err.code === "CALENDAR_API_DISABLED") {
      return { enabled: false, code: err.code, reason: CALENDAR_API_DISABLED_MESSAGE };
    }
    if (err.code === "CALENDAR_NOT_AUTHORIZED") {
      return { enabled: true, code: err.code, reason: "" };
    }
    return { enabled: "unknown", code: err.code, reason: calendarFailureReason(err.code) };
  } catch {
    return { enabled: "unknown", code: "FREEBUSY_FAILED", reason: CALENDAR_UNREADABLE };
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
      items?: { id?: string; summary?: string; status?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[];
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
      });
    }
    return { ok: true, events };
  } catch {
    return { ok: false, reason: CALENDAR_VIEW_UNREADABLE, code: "FREEBUSY_FAILED" };
  }
}

export type ListBusyResult =
  | { ok: true; busy: Busy[] }
  | { ok: false; reason: string; code: CalendarFailureCode };

export async function listBusy(
  accessToken: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<ListBusyResult> {
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
        items: [{ id: "primary" }],
      }),
    });
    if (!res.ok) {
      const err = await readGoogleError(res);
      if (err.code === "CALENDAR_API_DISABLED") return { ok: false, reason: CALENDAR_API_DISABLED_MESSAGE, code: err.code };
      if (err.code === "TOKEN_INVALID" || err.code === "CALENDAR_NOT_AUTHORIZED") {
        return { ok: false, reason: calendarFailureReason(err.code), code: err.code };
      }
      return { ok: false, reason: CALENDAR_UNREADABLE, code: "FREEBUSY_FAILED" };
    }
    const json = (await res.json()) as {
      error?: { message?: string };
      calendars?: { primary?: { busy?: { start: string; end: string }[]; errors?: unknown[] } };
    };
    if (json.error) return { ok: false, reason: CALENDAR_UNREADABLE, code: "FREEBUSY_FAILED" };
    const primary = json.calendars?.primary;
    if (!primary) return { ok: false, reason: CALENDAR_UNREADABLE, code: "FREEBUSY_FAILED" };
    if (primary.errors && primary.errors.length) return { ok: false, reason: CALENDAR_UNREADABLE, code: "FREEBUSY_FAILED" };
    const busy = (primary.busy || []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    return { ok: true, busy };
  } catch {
    return { ok: false, reason: CALENDAR_UNREADABLE, code: "FREEBUSY_FAILED" };
  }
}

export async function createEvent(
  accessToken: string,
  opts: { title: string; start: Date; end: Date; description?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; id: string } | { ok: false; error: string; code: CalendarFailureCode }> {
  const res = await fetchImpl("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: opts.title,
      description: opts.description || "",
      start: { dateTime: opts.start.toISOString() },
      end: { dateTime: opts.end.toISOString() },
    }),
  });
  const raw = await res.text().catch(() => "");
  let json: { id?: string; error?: { message?: string } } = {};
  try { json = raw ? JSON.parse(raw) as { id?: string; error?: { message?: string } } : {}; } catch { json = {}; }
  if (!res.ok || !json.id) {
    const code = classifyGoogleCalendarHttp(res.status, raw);
    const mapped = code === "FREEBUSY_FAILED" ? "EVENT_CREATE_FAILED" : code;
    if (mapped === "CALENDAR_API_DISABLED") return { ok: false, error: CALENDAR_API_DISABLED_MESSAGE, code: mapped };
    return { ok: false, error: json.error?.message || calendarFailureReason(mapped), code: mapped };
  }
  return { ok: true, id: json.id };
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string; code: CalendarFailureCode }> {
  const id = encodeURIComponent(eventId);
  const res = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok || res.status === 410 || res.status === 404) return { ok: true };
  const err = await readGoogleError(res);
  return { ok: false, error: calendarFailureReason(err.code === "FREEBUSY_FAILED" ? "EVENT_CREATE_FAILED" : err.code), code: err.code };
}

export async function probeFreeBusy(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string; code: CalendarFailureCode }> {
  const from = new Date();
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const result = await listBusy(accessToken, from, to, fetchImpl);
  if (!result.ok) return { ok: false, reason: result.reason, code: result.code };
  return { ok: true };
}

export async function offeredSlots(
  accessToken: string,
  opts: { from?: Date; count?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; busy: Busy[]; slots: { start: Date; end: Date; label: string }[] } | { ok: false; reason: string; slots: []; code: CalendarFailureCode }> {
  const from = opts.from || new Date();
  const result = await listBusy(accessToken, from, new Date(from.getTime() + 14 * 86400000), fetchImpl);
  if (!result.ok) return { ok: false, reason: CALENDAR_UNREADABLE, slots: [], code: result.code };
  return { ok: true, busy: result.busy, slots: openSlots({ from, busy: result.busy, count: opts.count ?? 3 }) };
}

export { openSlots };
