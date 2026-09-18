import assert from "node:assert/strict";
import test from "node:test";
import { schedulerEvidenceOk, workerLight } from "./heartbeat.ts";
import { scoreLiveChecks } from "./test-mode.ts";
import { listBusy, offeredSlots, CALENDAR_UNREADABLE } from "../google/calendar.ts";
import { slotIsOffered } from "./booking.ts";
import { openSlots } from "../calendar/slots.ts";

test("worker secret without an actual worker run does NOT show Scheduler ✅", () => {
  const checks = scoreLiveChecks({
    sequenceId: "seq-1",
    followupsBeforeReply: 1,
    secretPresent: true,
  });
  assert.equal(checks.find((c) => c.key === "scheduler")?.ok, false);
  assert.equal(
    schedulerEvidenceOk({ secretPresent: true, sequenceId: "seq-1", followupsScheduled: 1 }),
    false,
  );
});

test("a real worker run that saw the test workflow can show Scheduler ✅", () => {
  const checks = scoreLiveChecks({
    sequenceId: "seq-1",
    followupsBeforeReply: 1,
    workerRunId: "run-1",
    workerSeenAt: "2026-09-17T21:00:00.000Z",
  });
  assert.equal(checks.find((c) => c.key === "scheduler")?.ok, true);
});

test("worker light: missing / configured / running", () => {
  const now = 1_000_000;
  assert.equal(workerLight({ secretPresent: false, lastCompletedAt: null, now }).state, "missing");
  assert.match(workerLight({ secretPresent: false, lastCompletedAt: null, now }).detail, /not configured/);
  const configured = workerLight({ secretPresent: true, lastCompletedAt: null, now });
  assert.equal(configured.state, "configured");
  assert.match(configured.detail, /no run observed/);
  const running = workerLight({ secretPresent: true, lastCompletedAt: now - 60_000, now });
  assert.equal(running.state, "running");
  assert.match(running.detail, /last successful run 1 minute/);
});

test("Google free/busy HTTP failure produces zero offered slots and an error", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  const busy = await listBusy("tok", new Date(), new Date(), fetchImpl);
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.reason, CALENDAR_UNREADABLE);
  const offered = await offeredSlots("tok", { count: 3 }, fetchImpl);
  assert.equal(offered.ok, false);
  assert.equal(offered.slots.length, 0);
});

test("zero actual busy events still works normally", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), { status: 200 })) as typeof fetch;
  const busy = await listBusy("tok", new Date("2026-09-21T12:00:00Z"), new Date("2026-09-28T12:00:00Z"), fetchImpl);
  assert.equal(busy.ok, true);
  if (busy.ok) assert.equal(busy.busy.length, 0);
  const from = new Date("2026-09-21T14:00:00Z");
  const slots = openSlots({ from, busy: [], count: 3 });
  assert.ok(slots.length > 0);
});

test("public booking fails closed when Calendar cannot be read", async () => {
  const fetchImpl = (async () => new Response("", { status: 401 })) as typeof fetch;
  const offered = await offeredSlots("tok", {}, fetchImpl);
  assert.equal(offered.ok, false);
  if (!offered.ok) assert.equal(offered.reason, CALENDAR_UNREADABLE);
  assert.equal(offered.slots.length, 0);
});

test("Test Sales Flow fails closed when Calendar cannot be read", async () => {
  const fetchImpl = (async () => {
    throw new Error("network");
  }) as typeof fetch;
  const offered = await offeredSlots("tok", { count: 3 }, fetchImpl);
  assert.equal(offered.ok, false);
  assert.equal(offered.slots.length, 0);
  if (!offered.ok) assert.equal(offered.reason, CALENDAR_UNREADABLE);
});

test("owner scheduling rechecks availability immediately before event creation", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  const offered = [{ start: new Date("2026-09-22T15:00:00Z"), end: new Date("2026-09-22T15:30:00Z") }];
  const stale = slotIsOffered(
    { start: new Date("2026-09-22T18:00:00Z"), end: new Date("2026-09-22T18:30:00Z") },
    offered,
    now,
  );
  assert.equal(stale.ok, false);
  const ok = slotIsOffered(offered[0], offered, now);
  assert.equal(ok.ok, true);
});

test("calendar errors array is not treated as an empty free calendar", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ calendars: { primary: { busy: [], errors: [{ reason: "notFound" }] } } }),
      { status: 200 },
    )) as typeof fetch;
  const busy = await listBusy("tok", new Date(), new Date(), fetchImpl);
  assert.equal(busy.ok, false);
});
