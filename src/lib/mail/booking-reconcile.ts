import { isTestWorkflowUid } from "./test-loop.ts";
import { promotedStageForBooking } from "./booking-stage.ts";
import type { InvariantSnapshot } from "../sentinel/types.ts";

export const BOOKING_INVARIANT_RECONCILED = "BOOKING_INVARIANT_RECONCILED";

export type BookingMismatchRow = {
  calendarId: string;
  googleEventId: string;
  prospectUid: string;
  title: string;
  calendarStatus: string;
  pipelineStage: string;
  isTest: boolean;
};

/** Proven association: booked calendar row + Google event id + existing prospect uid. */
export function shouldRepairPipelineMismatch(row: {
  googleEventId: string;
  prospectUid: string;
  calendarStatus: string;
  pipelineStage: string;
}): boolean {
  return Boolean(row.googleEventId && row.googleEventId.trim())
    && Boolean(row.prospectUid && row.prospectUid.trim())
    && row.calendarStatus === "booked"
    && promotedStageForBooking(row.pipelineStage) !== null;
}

export function bookingLightFromInvariant(inv: Pick<InvariantSnapshot, "bookedMissingPipeline" | "bookedMissingEventId">): "green" | "red" {
  if (inv.bookedMissingPipeline.length || inv.bookedMissingEventId.length) return "red";
  return "green";
}

export async function loadBookingMismatchRows(userId: string): Promise<BookingMismatchRow[]> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    google_event_id: string;
    prospect_uid: string;
    title: string;
    status: string;
    stage: string;
  }>`
    select ce.id, ce.google_event_id, ce.prospect_uid, ce.title, ce.status, p.stage
    from calendar_events ce
    join prospects p on p.user_id = ce.user_id and p.uid = ce.prospect_uid
    where ce.user_id = ${userId}
      and ce.status = 'booked'
      and ce.google_event_id is not null and ce.google_event_id <> ''
      and coalesce(p.stage, '') not in ('Call Booked', 'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'Do Not Contact')
  `;
  return rows.map((r) => ({
    calendarId: r.id,
    googleEventId: r.google_event_id,
    prospectUid: r.prospect_uid,
    title: r.title || "",
    calendarStatus: r.status,
    pipelineStage: r.stage || "",
    isTest: isTestWorkflowUid(r.prospect_uid),
  }));
}

export async function repairPipelineBookingMismatches(userId: string, sha = ""): Promise<{
  inspected: number;
  repaired: number;
  skipped: number;
  remaining: number;
  rows: Array<{
    googleEventId: string;
    prospectUid: string;
    calendarId: string;
    fromStage: string;
    toStage: string;
    isTest: boolean;
    repaired: boolean;
  }>;
}> {
  const mismatches = await loadBookingMismatchRows(userId);
  const { applyExistingBookingToTestState } = await import("./booking-confirm.server");
  const { audit } = await import("./sql.server");
  const out: Array<{
    googleEventId: string;
    prospectUid: string;
    calendarId: string;
    fromStage: string;
    toStage: string;
    isTest: boolean;
    repaired: boolean;
  }> = [];
  let repaired = 0;
  let skipped = 0;
  for (const row of mismatches) {
    if (!shouldRepairPipelineMismatch(row)) {
      skipped += 1;
      out.push({
        googleEventId: row.googleEventId,
        prospectUid: row.prospectUid,
        calendarId: row.calendarId,
        fromStage: row.pipelineStage,
        toStage: row.pipelineStage,
        isTest: row.isTest,
        repaired: false,
      });
      continue;
    }
    await applyExistingBookingToTestState(userId, row.prospectUid, row.googleEventId, null, null, row.title);
    await audit(userId, BOOKING_INVARIANT_RECONCILED, `google_event_id=${row.googleEventId} uid=${row.prospectUid} ${row.pipelineStage}->Call Booked sha=${sha}`, {
      prospectUid: row.prospectUid,
      method: "MANUAL",
      providerIds: row.googleEventId,
    });
    repaired += 1;
    out.push({
      googleEventId: row.googleEventId,
      prospectUid: row.prospectUid,
      calendarId: row.calendarId,
      fromStage: row.pipelineStage,
      toStage: "Call Booked",
      isTest: row.isTest,
      repaired: true,
    });
  }
  const remaining = (await loadBookingMismatchRows(userId)).length;
  return { inspected: mismatches.length, repaired, skipped, remaining, rows: out };
}
