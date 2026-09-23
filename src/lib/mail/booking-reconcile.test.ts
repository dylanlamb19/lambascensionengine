import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_REPAIR_MUTATES_CALENDAR,
  bookingLightFromInvariant,
  persistenceFailedRepairNote,
  repairSpeech,
  shouldRepairPipelineMismatch,
} from "./booking-reconcile.ts";
import { promotedStageForBooking } from "./booking-stage.ts";
import { EMPTY_INVARIANTS } from "../sentinel/invariants.ts";
import { evaluateInvariants } from "../sentinel/invariants.ts";

test("Booking mismatch turns Booking red", () => {
  const inv = {
    ...EMPTY_INVARIANTS,
    bookedMissingPipeline: [{ googleEventId: "gcal-abc", prospectUid: "uid-fire" }],
  };
  assert.equal(bookingLightFromInvariant(inv), "red");
  const findings = evaluateInvariants(inv);
  assert.equal(findings[0]?.code, "PIPELINE_STATE_MISMATCH");
  assert.equal(findings[0]?.severity, "high");
  assert.equal(findings[0]?.evidence.googleEventId, "gcal-abc");
  assert.equal(findings[0]?.evidence.prospectUid, "uid-fire");
  assert.match(findings[0]?.summary || "", /without a matching Call Booked/);
});

test("reverse Call Booked without google event uses distinct summary", () => {
  const inv = {
    ...EMPTY_INVARIANTS,
    bookedMissingPipeline: [{ googleEventId: "", prospectUid: "uid-reverse" }],
  };
  const findings = evaluateInvariants(inv);
  assert.equal(findings[0]?.code, "PIPELINE_STATE_MISMATCH");
  assert.match(findings[0]?.summary || "", /Call Booked without a booked Google Calendar event/);
  assert.equal(findings[0]?.evidence.googleEventId, "");
  assert.equal(findings[0]?.evidence.prospectUid, "uid-reverse");
});

test("repaired booking invariant turns Booking green", () => {
  assert.equal(bookingLightFromInvariant(EMPTY_INVARIANTS), "green");
  assert.equal(evaluateInvariants(EMPTY_INVARIANTS).length, 0);
});

test("association is repaired only with persisted google event id + prospect uid", () => {
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "evt-1",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "Approved for Outreach",
  }), true);
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "evt-1",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "Call Booked",
  }), false);
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "evt-1",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "Proposal Sent",
  }), false);
  assert.equal(promotedStageForBooking("Contacted"), "Call Booked");
  assert.equal(promotedStageForBooking("Won"), null);
  assert.equal(promotedStageForBooking("Do Not Contact"), null);
  assert.equal(promotedStageForBooking(""), "Call Booked");
  assert.equal(promotedStageForBooking("Booked"), "Call Booked");
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "evt-1",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "",
  }), true);
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "evt-1",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "Booked",
  }), true);
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "New",
  }), false);
});

test("repair speech says what changed", () => {
  assert.match(repairSpeech({
    repaired: 1,
    remaining: 0,
    rows: [{ name: "AWO Lending", repaired: true, toStage: "Call Booked" }],
  }), /AWO Lending is now Call Booked/);
  assert.match(repairSpeech({
    repaired: 1,
    remaining: 0,
    rows: [{ name: "TEST", repaired: true, toStage: "Approved for Outreach" }],
  }), /moved it back to Approved for Outreach/);
  assert.match(repairSpeech({ repaired: 0, remaining: 1, rows: [] }), /Nothing was changed/);
});

test("repair path never mutates Calendar / never invents events", () => {
  assert.equal(BOOKING_REPAIR_MUTATES_CALENDAR, false);
  assert.match(
    persistenceFailedRepairNote("evt-9", "uid-x"),
    /No new Calendar event/,
  );
  assert.match(
    persistenceFailedRepairNote("", "uid-x"),
    /will not invent/,
  );
});
