import { makeFinding } from "./ledger.ts";
import type { InvariantSnapshot, SentinelFinding } from "./types.ts";
import { evaluateContactabilityInvariants } from "./contactability-check.ts";

export function evaluateInvariants(snap: InvariantSnapshot): SentinelFinding[] {
  const out: SentinelFinding[] = [];

  for (const row of snap.duplicatePlaceIds) {
    if (row.uids.length < 2) continue;
    out.push(makeFinding(
      "PROSPECT_DUPLICATE_IDENTITY",
      `Google Place ID ${row.placeId} appears on ${row.uids.length} prospect rows.`,
      { placeId: row.placeId, uids: row.uids },
      {
        extraKey: row.placeId,
        affected: row.uids.map((uid) => ({ uid })),
        reproduction: "Find Clients on an overlapping market should not insert a second row for the same Place ID.",
      },
    ));
  }

  for (const row of snap.bookedMissingEventId) {
    out.push(makeFinding(
      "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE",
      "A booked sales call is missing its Google Calendar event id.",
      { id: row.id, prospectUid: row.prospectUid },
      { extraKey: row.id, affected: [{ id: row.id, prospectUid: row.prospectUid }] },
    ));
  }

  for (const row of snap.bookedMissingPipeline) {
    out.push(makeFinding(
      "PIPELINE_STATE_MISMATCH",
      "A Google Calendar booking exists without a matching Call Booked pipeline state.",
      { googleEventId: row.googleEventId, prospectUid: row.prospectUid },
      { extraKey: row.googleEventId, affected: [{ googleEventId: row.googleEventId, prospectUid: row.prospectUid }] },
    ));
  }

  for (const row of snap.replyButFollowupScheduled) {
    out.push(makeFinding(
      "FOLLOWUP_NOT_CANCELLED_AFTER_REPLY",
      "A prospect replied, but a follow-up is still scheduled.",
      { prospectUid: row.prospectUid, followupId: row.followupId },
      { extraKey: row.followupId, affected: [{ prospectUid: row.prospectUid, followupId: row.followupId }] },
    ));
  }

  for (const row of snap.dncActiveSequence) {
    out.push(makeFinding(
      "DNC_SEQUENCE_ACTIVE",
      "A Do Not Contact / skipped prospect still has an active outreach sequence.",
      { prospectUid: row.prospectUid, sequenceId: row.sequenceId },
      { extraKey: row.sequenceId, affected: [{ prospectUid: row.prospectUid }] },
    ));
  }

  for (const row of snap.bounceFutureSends) {
    out.push(makeFinding(
      "BOUNCE_FUTURE_SEND_SCHEDULED",
      "A hard bounce still has future sends scheduled.",
      { prospectUid: row.prospectUid, followupId: row.followupId },
      { extraKey: row.followupId, affected: [{ prospectUid: row.prospectUid }] },
    ));
  }

  for (const row of snap.testInRevenue) {
    out.push(makeFinding(
      "TEST_MODE_INVARIANT_FAILED",
      "A TEST workflow record is counted in real revenue / live pipeline totals.",
      { uid: row.uid },
      { extraKey: row.uid, affected: [{ uid: row.uid }] },
    ));
  }

  for (const row of snap.testModeLeak) {
    out.push(makeFinding(
      "TEST_MODE_INVARIANT_FAILED",
      "Test Mode is on, but a message was sent to an address that is not on the allowlist.",
      { messageId: row.messageId, recipient: row.recipient },
      { extraKey: row.messageId, affected: [{ messageId: row.messageId }] },
    ));
  }

  for (const row of snap.duplicateActivity) {
    if (row.count < 2) continue;
    out.push(makeFinding(
      "ARA_ACTION_DUPLICATE",
      `The same ${row.action} ran ${row.count} times from a repeated transcript.`,
      { action: row.action, detail: row.detail, count: row.count },
      { extraKey: `${row.action}|${row.detail}` },
    ));
  }

  if (snap.prospects?.length) out.push(...evaluateContactabilityInvariants(snap.prospects));
  return out;
}

export const EMPTY_INVARIANTS: InvariantSnapshot = {
  duplicatePlaceIds: [],
  bookedMissingEventId: [],
  bookedMissingPipeline: [],
  replyButFollowupScheduled: [],
  dncActiveSequence: [],
  bounceFutureSends: [],
  testInRevenue: [],
  testModeLeak: [],
  duplicateActivity: [],
};
