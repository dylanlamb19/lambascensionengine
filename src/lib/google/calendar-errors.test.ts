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
