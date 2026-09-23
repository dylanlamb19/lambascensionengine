import assert from "node:assert/strict";
import test from "node:test";
import { bookingLightFromInvariant, shouldRepairPipelineMismatch } from "./booking-reconcile.ts";
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
  assert.equal(shouldRepairPipelineMismatch({
    googleEventId: "",
    prospectUid: "uid-fire",
    calendarStatus: "booked",
    pipelineStage: "New",
  }), false);
});
