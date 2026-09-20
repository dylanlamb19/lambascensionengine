import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreLiveChecks } from "./test-mode.ts";
import { revenueSnapshot } from "../attack/revenue.ts";
import { TEST_RECORD_NAME } from "./test-loop.ts";
import {
  BOOKING_CONFIRMED,
  BOOKING_LINK_CREATED,
  BOOKING_PERSISTENCE_FAILED,
  LEGACY_BOOKING_LINK_ACTION,
  bookingCheckOk,
  eventIdsAgree,
  googleEventIdForBookingToken,
  isBookingConfirmedAction,
  isBookingLinkCreatedAction,
  pipelineCheckOk,
  provenGoogleEventId,
  publicBookingDecision,
  shouldReconcileTestBooking,
} from "./booking-evidence.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("booking check is green only from a persisted Google event id", () => {
  assert.equal(bookingCheckOk(null), false);
  assert.equal(bookingCheckOk(""), false);
  assert.equal(bookingCheckOk("google-event-1"), true);
  const linkOnly = scoreLiveChecks({ slotsOffered: 3 });
  assert.equal(linkOnly.find((c) => c.key === "availability")?.ok, true);
  assert.equal(linkOnly.find((c) => c.key === "booking")?.ok, false);
  assert.equal(linkOnly.find((c) => c.key === "pipeline")?.ok, false);
  const booked = scoreLiveChecks({ eventId: "google-event-1", slotsOffered: 3 });
  assert.equal(booked.find((c) => c.key === "booking")?.ok, true);
  assert.equal(booked.find((c) => c.key === "pipeline")?.ok, false);
});

test("pipeline sync is green only with Call Booked AND a real event id", () => {
  assert.equal(pipelineCheckOk({ pipelineStage: "Call Booked" }), false);
  assert.equal(pipelineCheckOk({ eventId: "g1" }), false);
  assert.equal(pipelineCheckOk({ pipelineStage: "Contacted", eventId: "g1" }), false);
  assert.equal(pipelineCheckOk({ pipelineStage: "Call Booked", eventId: "g1" }), true);
  const checks = scoreLiveChecks({ eventId: "g1", pipelineStage: "Call Booked" });
  assert.equal(checks.find((c) => c.key === "booking")?.ok, true);
  assert.equal(checks.find((c) => c.key === "pipeline")?.ok, true);
});

test("booking-link creation is not a booking confirmation", () => {
  assert.equal(isBookingLinkCreatedAction(BOOKING_LINK_CREATED), true);
  assert.equal(isBookingConfirmedAction(BOOKING_LINK_CREATED), false);
  assert.equal(isBookingConfirmedAction(BOOKING_CONFIRMED), true);
  assert.equal(isBookingConfirmedAction(LEGACY_BOOKING_LINK_ACTION), true);
  assert.equal(isBookingConfirmedAction("test_booking"), true);
  const ui = readFileSync(join(here, "../../components/test-desk.tsx"), "utf8");
  assert.match(ui, /booking_link_created: "booking link created"/);
  assert.match(ui, /booking_confirmed: "booking confirmed"/);
});

test("duplicate booking request returns existing event and does not create", () => {
  assert.deepEqual(
    publicBookingDecision({ linkStatus: "used", persistedGoogleEventId: "g1" }),
    { action: "return_existing", eventId: "g1" },
  );
  assert.deepEqual(
    publicBookingDecision({ linkStatus: "booking", persistedGoogleEventId: "g1" }),
    { action: "return_existing", eventId: "g1" },
  );
  assert.deepEqual(publicBookingDecision({ linkStatus: "open" }), { action: "create" });
  assert.deepEqual(
    publicBookingDecision({ linkStatus: "used" }),
    { action: "persistence_failed" },
  );
  const api = readFileSync(join(here, "../../routes/api/book/$token.ts"), "utf8");
  assert.match(api, /return_existing/);
  assert.match(api, /googleEventIdForBookingToken/);
  assert.doesNotMatch(api, /action: "booking_link"/);
  assert.match(api, /persistConfirmedBooking/);
});

test("Calendar-success / DB-failure is a named state and keeps the Google event id", () => {
  assert.equal(BOOKING_PERSISTENCE_FAILED, "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE");
  const confirm = readFileSync(join(here, "booking-confirm.server.ts"), "utf8");
  assert.match(confirm, /BOOKING_PERSISTENCE_FAILED/);
  assert.match(confirm, /eventId: opts\.googleEventId/);
  assert.match(confirm, /No second event was created/);
  const flow = readFileSync(join(here, "test-flow.server.ts"), "utf8");
  assert.match(flow, /reconcileTestBookingFromPersisted/);
  assert.match(flow, /BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE/);
});

test("TEST Call Booked stays out of real sales metrics", () => {
  const snap = revenueSnapshot([
    {
      id: 3,
      uid: "test-sales-flow:run_booked",
      name: TEST_RECORD_NAME,
      vertical: "Internal test",
      city: "Test Mode",
      website: "",
      review_count: 0,
      google_rating: "UNKNOWN",
      phone: "UNKNOWN",
      job_value_est: 0,
      job_value_kind: "UNKNOWN",
      score: 0,
      fit: "possible",
      stage: "Call Booked",
    } as never,
    {
      id: 4,
      uid: "company-a",
      name: "ABC",
      vertical: "Roofing",
      city: "Fort Worth",
      website: "",
      review_count: 0,
      google_rating: "UNKNOWN",
      phone: "UNKNOWN",
      job_value_est: 0,
      job_value_kind: "UNKNOWN",
      score: 0,
      fit: "possible",
      stage: "Call Booked",
    } as never,
  ]);
  assert.equal(snap.calls, 1);
});

test("reconcile requires a TEST uid plus a proven persisted Google event id", () => {
  assert.equal(shouldReconcileTestBooking({
    prospectUid: "test-sales-flow:abc",
    testEventId: null,
    persistedGoogleEventId: "g1",
  }), true);
  assert.equal(shouldReconcileTestBooking({
    prospectUid: "test-sales-flow:abc",
    testEventId: "g1",
    persistedGoogleEventId: "g1",
  }), false);
  assert.equal(shouldReconcileTestBooking({
    prospectUid: "company-a",
    testEventId: null,
    persistedGoogleEventId: "g1",
  }), false);
  assert.equal(shouldReconcileTestBooking({
    prospectUid: "test-sales-flow:abc",
    testEventId: null,
    persistedGoogleEventId: null,
  }), false);
});

test("mismatched calendar vs audit event ids are not proven", () => {
  assert.equal(eventIdsAgree("g1", "g1"), true);
  assert.equal(eventIdsAgree("g1", null), true);
  assert.equal(eventIdsAgree(null, "g1"), true);
  assert.equal(eventIdsAgree("g1", "g2"), false);
  assert.equal(provenGoogleEventId({ calendarEventId: "g1", auditEventId: "g1" }), "g1");
  assert.equal(provenGoogleEventId({ calendarEventId: "g1", auditEventId: "g2" }), null);
  assert.equal(provenGoogleEventId({ calendarEventId: "g1" }), "g1");
  assert.equal(provenGoogleEventId({ auditEventId: "g1" }), "g1");
});

test("booking session identity is a stable Google event id, not Date.now", () => {
  const a = googleEventIdForBookingToken("tok-1");
  const b = googleEventIdForBookingToken("tok-2");
  assert.equal(a, googleEventIdForBookingToken("tok-1"));
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(a, /\d{13}/);
});

test("TEST booking persist writes Call Booked and event id", () => {
  const flow = readFileSync(join(here, "test-flow.server.ts"), "utf8");
  assert.match(flow, /persistConfirmedBooking/);
  assert.match(flow, /booking_link_created/);
  const confirm = readFileSync(join(here, "booking-confirm.server.ts"), "utf8");
  assert.match(confirm, /pipeline_stage: "Call Booked"/);
  assert.match(confirm, /event_id: opts\.googleEventId/);
  assert.match(confirm, /TEST_BOOKING_STATE_RECONCILED/);
});
