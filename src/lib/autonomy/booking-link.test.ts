import assert from "node:assert/strict";
import test from "node:test";
import { applyImmediateBooking, replyWantsBooking, shouldReuseBookingToken, trackedBookingUrl } from "./booking-link.ts";
import { planReply } from "./replies.ts";
import { publicBookingDecision } from "../mail/booking-evidence.ts";

test("interested reply gets one company booking link and booking stops outreach immediately", () => {
  const token = "8f3c1a0e-6b2d-4c91-9a77-0d4e5f6a7b8c";
  const other = "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809";
  const url = trackedBookingUrl("https://lamb-ascension-engine.vercel.app", token);
  assert.equal(url, `https://lamb-ascension-engine.vercel.app/book/${token}`);
  assert.notEqual(trackedBookingUrl("https://lamb-ascension-engine.vercel.app", other), url);
  assert.equal(replyWantsBooking("INTERESTED"), true);
  assert.equal(replyWantsBooking("NOT_INTERESTED"), false);
  assert.equal(shouldReuseBookingToken({ status: "open", expiresAt: "2099-01-01T00:00:00.000Z" }), true);
  assert.equal(shouldReuseBookingToken({ status: "open", expiresAt: "2000-01-01T00:00:00.000Z" }), false);
  assert.equal(shouldReuseBookingToken({ status: "used", expiresAt: "2099-01-01T00:00:00.000Z" }), false);

  const plan = planReply({
    text: "Sounds good, let's talk",
    name: "Amos",
    company: "AWO Lending",
    bookingUrl: url,
    finding: "no homepage form",
  });
  assert.equal(plan.send, true);
  assert.match(plan.body, new RegExp(token));
  assert.doesNotMatch(plan.body, new RegExp(other));
  assert.doesNotMatch(plan.body, /guarantee|\$\d/);

  const booked = applyImmediateBooking({
    name: "AWO Lending",
    stage: "Replied",
    meeting_at: "",
    meeting_event_id: "",
    history: [{ at: "2026-09-23T12:00:00.000Z", action: "autonomy_sent", detail: "sent" }],
  }, {
    at: "2026-09-23T18:00:00.000Z",
    startIso: "2026-09-24T16:00:00.000Z",
    eventId: "evt-awo",
    brief: "AWO Lending\nVerified gaps: NO_HOMEPAGE_FORM.",
  });
  assert.equal(booked.stage, "Call Booked");
  assert.equal(booked.meeting_at, "2026-09-24T16:00:00.000Z");
  assert.equal(booked.meeting_event_id, "evt-awo");
  assert.ok(booked.history?.some((h) => h.action === "call_prep" && /NO_HOMEPAGE_FORM/.test(h.detail || "")));
  assert.equal(publicBookingDecision({ linkStatus: "used", persistedGoogleEventId: "evt-awo" }).action, "return_existing");
  assert.equal(publicBookingDecision({ linkStatus: "expired" }).action, "invalid");
});
