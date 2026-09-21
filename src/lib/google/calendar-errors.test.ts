import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_API_DISABLED_MESSAGE,
  calendarFailureReason,
  classifyGoogleCalendarHttp,
} from "./calendar-errors.ts";
import { listBusy } from "./calendar.ts";

test("disabled Calendar API is a distinct stop condition", () => {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: "Google Calendar API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123 then retry.",
    },
  });
  assert.equal(classifyGoogleCalendarHttp(403, body), "CALENDAR_API_DISABLED");
  assert.equal(calendarFailureReason("CALENDAR_API_DISABLED"), CALENDAR_API_DISABLED_MESSAGE);
});

test("insufficient Gmail scopes means the API is enabled, not disabled", () => {
  const body = JSON.stringify({
    error: { status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." },
  });
  assert.equal(classifyGoogleCalendarHttp(403, body), "CALENDAR_SCOPE_MISSING");
  assert.notEqual(classifyGoogleCalendarHttp(403, body), "CALENDAR_API_DISABLED");
});

test("401 is CALENDAR_TOKEN_INVALID", () => {
  assert.equal(classifyGoogleCalendarHttp(401, "invalid_token"), "CALENDAR_TOKEN_INVALID");
});

test("generic free/busy failure fails closed", () => {
  assert.equal(classifyGoogleCalendarHttp(500, "nope"), "FREEBUSY_PROVIDER_ERROR");
  assert.match(calendarFailureReason("FREEBUSY_FAILED"), /couldn’t be read/i);
});

test("freeBusy reads calendars keyed by email, not only primary", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        calendars: {
          "lambascension99@gmail.com": { busy: [{ start: "2026-09-20T16:00:00Z", end: "2026-09-20T16:30:00Z" }] },
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  const busy = await listBusy("tok", new Date(), new Date(), fetchImpl, "lambascension99@gmail.com");
  assert.equal(busy.ok, true);
  if (busy.ok) {
    assert.equal(busy.busy.length, 1);
    assert.equal(busy.calendarId, "lambascension99@gmail.com");
  }
});

test("primary notFound still succeeds when the verified calendar id is readable", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        calendars: {
          primary: { busy: [], errors: [{ reason: "notFound" }] },
          "owner@example.com": { busy: [] },
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  const busy = await listBusy("tok", new Date(), new Date(), fetchImpl, "owner@example.com");
  assert.equal(busy.ok, true);
  if (busy.ok) assert.equal(busy.calendarId, "owner@example.com");
});

test("HTTP 200 with only notFound stays fail-closed", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ calendars: { primary: { busy: [], errors: [{ reason: "notFound" }] } } }),
      { status: 200 },
    )) as typeof fetch;
  const busy = await listBusy("tok", new Date(), new Date(), fetchImpl);
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.googleReason, "notFound");
});

test("owner personal createEvent never invites attendees and treats 409 as the same event", async () => {
  const { createEvent } = await import("./calendar.ts");
  const bodies: string[] = [];
  const urls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(String(init?.body || ""));
    return new Response(JSON.stringify({ error: { message: "The requested identifier already exists." } }), { status: 409 });
  }) as typeof fetch;
  const start = new Date("2026-09-21T21:00:00.000Z");
  const end = new Date("2026-09-21T21:30:00.000Z");
  const created = await createEvent("tok", {
    title: "Go to SouthState Bank and withdraw cash",
    start,
    end,
    timeZone: "America/Chicago",
    eventId: "abc123def456",
    reminderMinutes: [0],
  }, fetchImpl);
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.id, "abc123def456");
    assert.equal(created.alreadyExisted, true);
  }
  assert.match(urls[0], /sendUpdates=none/);
  const body = JSON.parse(bodies[0]) as Record<string, unknown>;
  assert.equal("attendees" in body, false);
  assert.equal(body.summary, "Go to SouthState Bank and withdraw cash");
  assert.deepEqual(body.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });
});

test("deleteEvent 404/410 is already gone, not a fresh failure", async () => {
  const { deleteEvent } = await import("./calendar.ts");
  const gone404 = await deleteEvent("tok", "evt-1", (async () => new Response("", { status: 404 })) as typeof fetch);
  assert.equal(gone404.ok, true);
  if (gone404.ok) assert.equal(gone404.alreadyGone, true);
  const gone410 = await deleteEvent("tok", "evt-1", (async () => new Response("", { status: 410 })) as typeof fetch);
  assert.equal(gone410.ok, true);
  if (gone410.ok) assert.equal(gone410.alreadyGone, true);
  const ok = await deleteEvent("tok", "evt-1", (async () => new Response("", { status: 200 })) as typeof fetch);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.alreadyGone, undefined);
});

test("getEvent 404 is missing and patchEvent only sends changed fields with sendUpdates=none", async () => {
  const { getEvent, patchEvent } = await import("./calendar.ts");
  const missing = await getEvent("tok", "evt-gone", (async () => new Response("{}", { status: 404 })) as typeof fetch);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.missing, true);

  const urls: string[] = [];
  const bodies: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(String(init?.body || ""));
    return new Response(JSON.stringify({
      id: "evt-1",
      summary: "Dentist appointment",
      status: "confirmed",
      start: { dateTime: "2026-09-21T21:00:00-05:00" },
      end: { dateTime: "2026-09-21T21:30:00-05:00" },
    }), { status: 200 });
  }) as typeof fetch;
  const patched = await patchEvent("tok", "evt-1", {
    start: new Date("2026-09-21T21:00:00.000Z"),
    end: new Date("2026-09-21T21:30:00.000Z"),
    timeZone: "America/Chicago",
  }, fetchImpl);
  assert.equal(patched.ok, true);
  if (patched.ok) assert.equal(patched.event.id, "evt-1");
  assert.match(urls[0], /sendUpdates=none/);
  const body = JSON.parse(bodies[0]) as Record<string, unknown>;
  assert.equal("summary" in body, false);
  assert.equal("attendees" in body, false);
  assert.equal("description" in body, false);
  assert.ok(body.start);
});

test("listEvents treats missing items as an empty calendar, not unreadable", async () => {
  const { listEvents } = await import("./calendar.ts");
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ kind: "calendar#events", summary: "Dylan" }), { status: 200 })) as typeof fetch;
  const listed = await listEvents("tok", new Date("2026-09-20T05:00:00Z"), new Date("2026-09-27T05:00:00Z"), fetchImpl);
  assert.equal(listed.ok, true);
  if (listed.ok) assert.equal(listed.events.length, 0);
});

test("listEvents retries email calendar id when primary is notFound", async () => {
  const { listEvents } = await import("./calendar.ts");
  const urls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    if (String(url).includes("calendars/primary/")) {
      return new Response(JSON.stringify({ error: { errors: [{ reason: "notFound" }] } }), { status: 404 });
    }
    return new Response(JSON.stringify({
      items: [{
        id: "evt-1",
        summary: "Dentist",
        status: "confirmed",
        start: { dateTime: "2026-09-21T19:00:00-05:00" },
        end: { dateTime: "2026-09-21T19:30:00-05:00" },
      }],
    }), { status: 200 });
  }) as typeof fetch;
  const listed = await listEvents(
    "tok",
    new Date("2026-09-20T05:00:00Z"),
    new Date("2026-09-27T05:00:00Z"),
    fetchImpl,
    "lambascension99@gmail.com",
  );
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.equal(listed.events.length, 1);
    assert.equal(listed.calendarId, "lambascension99@gmail.com");
  }
  assert.ok(urls.some((u) => decodeURIComponent(u).includes("lambascension99@gmail.com")));
});

test("listEvents classifies 401 as CALENDAR_LIST_AUTH_FAILED", async () => {
  const { listEvents } = await import("./calendar.ts");
  const listed = await listEvents(
    "tok",
    new Date("2026-09-20T05:00:00Z"),
    new Date("2026-09-27T05:00:00Z"),
    (async () => new Response("invalid_token", { status: 401 })) as typeof fetch,
  );
  assert.equal(listed.ok, false);
  if (!listed.ok) {
    assert.equal(listed.code, "CALENDAR_LIST_AUTH_FAILED");
    assert.match(listed.reason, /CALENDAR_LIST_AUTH_FAILED/);
  }
});

test("listEvents prefers primary and still reads events when the email calendar id is refused", async () => {
  const { listEvents } = await import("./calendar.ts");
  const urls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    if (decodeURIComponent(String(url)).includes("owner@example.com")) {
      return new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 });
    }
    return new Response(JSON.stringify({
      items: [{
        id: "evt-primary",
        summary: "Dentist",
        status: "confirmed",
        start: { dateTime: "2026-09-21T19:00:00-05:00" },
        end: { dateTime: "2026-09-21T19:30:00-05:00" },
      }],
    }), { status: 200 });
  }) as typeof fetch;
  const listed = await listEvents(
    "tok",
    new Date("2026-09-20T05:00:00Z"),
    new Date("2026-09-27T05:00:00Z"),
    fetchImpl,
    "owner@example.com",
  );
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.equal(listed.events[0]?.id, "evt-primary");
    assert.equal(listed.calendarId, "primary");
  }
  assert.ok(urls.some((u) => u.includes("calendars/primary/")));
  assert.equal(urls.some((u) => decodeURIComponent(u).includes("owner@example.com")), false);
});

test("inverted date range is CALENDAR_LIST_BAD_RANGE", async () => {
  const { listEvents } = await import("./calendar.ts");
  const listed = await listEvents("tok", new Date("2026-09-27T00:00:00Z"), new Date("2026-09-20T00:00:00Z"));
  assert.equal(listed.ok, false);
  if (!listed.ok) assert.equal(listed.code, "CALENDAR_LIST_BAD_RANGE");
});

test("normalizeGoogleCalendarEvent skips cancelled, null, and missing-start events without throwing", async () => {
  const { normalizeGoogleCalendarEvent } = await import("./calendar.ts");
  assert.equal(normalizeGoogleCalendarEvent(null), null);
  assert.equal(normalizeGoogleCalendarEvent("nope"), null);
  assert.equal(normalizeGoogleCalendarEvent({ id: "x", status: "cancelled", start: { dateTime: "2026-09-21T19:00:00-05:00" } }), null);
  assert.equal(normalizeGoogleCalendarEvent({ id: "x", start: {} }), null);
  const timed = normalizeGoogleCalendarEvent({
    id: "evt-1",
    summary: "Dentist",
    start: { dateTime: "2026-09-21T19:00:00-05:00" },
    end: { dateTime: "2026-09-21T19:30:00-05:00" },
    attendees: [{ email: "a@x.com" }, { email: "b@x.com" }],
    conferenceData: { entryPoints: [{ uri: "https://meet.google.com/abc" }] },
  });
  assert.equal(timed?.id, "evt-1");
  assert.equal(timed?.title, "Dentist");
  assert.equal(timed?.attendees, 2);
  const allDay = normalizeGoogleCalendarEvent({
    id: "evt-day",
    start: { date: "2026-09-22" },
    end: { date: "2026-09-23" },
  });
  assert.equal(allDay?.allDay, true);
  assert.equal(allDay?.title, "(No title)");
  assert.match(allDay?.start || "", /^2026-09-22/);
});

test("listEvents keeps readable events when one item is malformed", async () => {
  const { listEvents } = await import("./calendar.ts");
  const fetchImpl = (async () =>
    new Response(JSON.stringify({
      items: [
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
      ],
    }), { status: 200 })) as typeof fetch;
  const listed = await listEvents("tok", new Date("2026-09-20T05:00:00Z"), new Date("2026-09-27T05:00:00Z"), fetchImpl);
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.equal(listed.events.length, 3);
    assert.deepEqual(listed.events.map((e) => e.id).sort(), ["evt-allday", "evt-conference", "evt-ok"]);
    assert.equal(listed.events.find((e) => e.id === "evt-conference")?.attendees, 1);
  }
});

test("asIsoTimestamp coerces Postgres Date objects so agenda sort cannot throw", async () => {
  const { asIsoTimestamp, compareEventStart } = await import("./calendar.ts");
  const d = new Date("2026-09-22T16:00:00.000Z");
  assert.equal(asIsoTimestamp(d), "2026-09-22T16:00:00.000Z");
  assert.equal(asIsoTimestamp("2026-09-22"), "2026-09-22T00:00:00");
  const events = [
    { start: d },
    { start: "2026-09-22T15:00:00.000Z" },
  ];
  events.sort(compareEventStart);
  assert.equal(asIsoTimestamp(events[0].start).startsWith("2026-09-22T15"), true);
  const dateStart = d as unknown as string;
  assert.equal(typeof dateStart.localeCompare, "undefined");
  assert.throws(() => dateStart.localeCompare("2026-09-22T15:00:00.000Z"));
});

test("deleteEvent uses sendUpdates=none", async () => {
  const { deleteEvent } = await import("./calendar.ts");
  const urls: string[] = [];
  const gone = await deleteEvent("tok", "evt-1", (async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return new Response("", { status: 200 });
  }) as typeof fetch);
  assert.equal(gone.ok, true);
  assert.match(urls[0], /sendUpdates=none/);
});

