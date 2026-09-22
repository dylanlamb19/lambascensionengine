import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_INVARIANTS, evaluateInvariants } from "./invariants.ts";

describe("Sentinel invariants", () => {
  it("all healthy snapshot yields no findings", () => {
    assert.equal(evaluateInvariants(EMPTY_INVARIANTS).length, 0);
  });

  it("duplicate Place ID is PROSPECT_DUPLICATE_IDENTITY", () => {
    const findings = evaluateInvariants({
      ...EMPTY_INVARIANTS,
      duplicatePlaceIds: [{ placeId: "ChIJabc", uids: ["p1", "p2"] }],
    });
    assert.equal(findings[0]?.code, "PROSPECT_DUPLICATE_IDENTITY");
    assert.equal(findings[0]?.severity, "high");
  });

  it("reply with scheduled follow-up is FOLLOWUP_NOT_CANCELLED_AFTER_REPLY", () => {
    const findings = evaluateInvariants({
      ...EMPTY_INVARIANTS,
      replyButFollowupScheduled: [{ prospectUid: "p1", followupId: "fu-1" }],
    });
    assert.equal(findings[0]?.code, "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY");
  });

  it("booked row missing google event id is BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE", () => {
    const findings = evaluateInvariants({
      ...EMPTY_INVARIANTS,
      bookedMissingEventId: [{ id: "ce-1", prospectUid: "p1" }],
    });
    assert.equal(findings[0]?.code, "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE");
    assert.equal(findings[0]?.severity, "critical");
  });

  it("DNC with active sequence is critical", () => {
    const findings = evaluateInvariants({
      ...EMPTY_INVARIANTS,
      dncActiveSequence: [{ prospectUid: "p1", sequenceId: "seq-1" }],
    });
    assert.equal(findings[0]?.code, "DNC_SEQUENCE_ACTIVE");
    assert.equal(findings[0]?.severity, "critical");
  });

  it("test-mode leak is critical", () => {
    const findings = evaluateInvariants({
      ...EMPTY_INVARIANTS,
      testModeLeak: [{ messageId: "m1", recipient: "real@example.com" }],
    });
    assert.equal(findings[0]?.code, "TEST_MODE_INVARIANT_FAILED");
    assert.equal(findings[0]?.severity, "critical");
  });
});
