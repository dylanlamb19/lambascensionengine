import { openSlots, type Busy } from "../calendar/slots.ts";

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

export async function listEvents(
  accessToken: string,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; events: GoogleCalEvent[] } | { ok: false; reason: string }> {
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
    if (!res.ok) return { ok: false, reason: CALENDAR_VIEW_UNREADABLE };
    const json = (await res.json()) as {
      error?: { message?: string };
      items?: { id?: string; summary?: string; status?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[];
    };
    if (json.error || !Array.isArray(json.items)) return { ok: false, reason: CALENDAR_VIEW_UNREADABLE };
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
    return { ok: false, reason: CALENDAR_VIEW_UNREADABLE };
  }
}

export type ListBusyResult =
  | { ok: true; busy: Busy[] }
  | { ok: false; reason: string };

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
    if (!res.ok) return { ok: false, reason: CALENDAR_UNREADABLE };
    const json = (await res.json()) as {
      error?: { message?: string };
      calendars?: { primary?: { busy?: { start: string; end: string }[]; errors?: unknown[] } };
    };
    if (json.error) return { ok: false, reason: CALENDAR_UNREADABLE };
    const primary = json.calendars?.primary;
    if (!primary) return { ok: false, reason: CALENDAR_UNREADABLE };
    if (primary.errors && primary.errors.length) return { ok: false, reason: CALENDAR_UNREADABLE };
    const busy = (primary.busy || []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    return { ok: true, busy };
  } catch {
    return { ok: false, reason: CALENDAR_UNREADABLE };
  }
}

export async function createEvent(
  accessToken: string,
  opts: { title: string; start: Date; end: Date; description?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
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
  const json = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) return { ok: false, error: json.error?.message || "Calendar could not create the event." };
  return { ok: true, id: json.id };
}

export async function probeFreeBusy(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const from = new Date();
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const result = await listBusy(accessToken, from, to, fetchImpl);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true };
}

export async function offeredSlots(
  accessToken: string,
  opts: { from?: Date; count?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; busy: Busy[]; slots: { start: Date; end: Date; label: string }[] } | { ok: false; reason: string; slots: [] }> {
  const from = opts.from || new Date();
  const result = await listBusy(accessToken, from, new Date(from.getTime() + 14 * 86400000), fetchImpl);
  if (!result.ok) return { ok: false, reason: CALENDAR_UNREADABLE, slots: [] };
  return { ok: true, busy: result.busy, slots: openSlots({ from, busy: result.busy, count: opts.count ?? 3 }) };
}

export { openSlots };
