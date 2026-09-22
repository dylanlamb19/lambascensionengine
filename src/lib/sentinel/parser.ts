import { asIsoTimestamp, compareEventStart, normalizeGoogleCalendarEvent } from "../google/calendar.ts";

/** In-process Calendar parser regression. Never calls Google. */
export const MALFORMED_CALENDAR_FIXTURE: unknown[] = [
  null,
  { id: "bad" },
  { status: "cancelled", id: "gone", start: { dateTime: "2026-09-21T19:00:00-05:00" } },
  {
    id: "evt-ok",
    summary: "Calendar Test",
    start: { dateTime: "2026-09-22T15:00:00-05:00" },
    end: { dateTime: "2026-09-22T15:30:00-05:00" },
  },
  { id: "evt-allday", summary: "Out", start: { date: "2026-09-23" }, end: { date: "2026-09-24" } },
  {
    id: "evt-conference",
    summary: "Meet",
    start: { dateTime: "2026-09-22T16:00:00-05:00" },
    end: { dateTime: "2026-09-22T16:30:00-05:00" },
    attendees: { "0": { email: "a@x.com" } },
    conferenceData: { entryPoints: [{ uri: "https://meet.google.com/abc" }] },
  },
];

export function runCalendarParserFixture(items: unknown[] = MALFORMED_CALENDAR_FIXTURE): {
  kept: number;
  skipped: number;
  threw: boolean;
  ids: string[];
} {
  const events: { id: string; start: string }[] = [];
  let skipped = 0;
  try {
    for (const item of items) {
      const event = normalizeGoogleCalendarEvent(item);
      if (event) events.push({ id: event.id, start: event.start });
      else if (item && typeof item === "object") {
        const status = String((item as { status?: unknown }).status || "").toLowerCase();
        if (status !== "cancelled") skipped += 1;
      }
    }
    const mixed = [
      ...events,
      { id: "sale-pg", start: asIsoTimestamp(new Date("2026-09-22T16:00:00.000Z")) },
    ];
    mixed.sort(compareEventStart);
    return { kept: events.length, skipped, threw: false, ids: events.map((e) => e.id) };
  } catch {
    return { kept: events.length, skipped, threw: true, ids: events.map((e) => e.id) };
  }
}
