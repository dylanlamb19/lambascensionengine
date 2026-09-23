/**
 * PIPELINE_STATE_MISMATCH repair — booking-reconcile ONLY.
 *
 * Rules:
 * - Set stage to Call Booked ONLY when a booked calendar row already has googleEventId + prospect uid
 *   and the pipeline is still behind Call Booked (Proposal Sent, Negotiation, Won, Lost, and Do Not Contact stay put).
 * - Do NOT create new Google Calendar events.
 * - Do NOT invent bookings.
 * - BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE is audited elsewhere (persistConfirmedBooking);
 *   this module only reconciles pipeline stage to proven calendar evidence.
 */
import { isTestWorkflowUid } from "./test-loop.ts";
import { promotedStageForBooking } from "./booking-stage.ts";
import type { InvariantSnapshot } from "../sentinel/types.ts";

export const BOOKING_INVARIANT_RECONCILED = "BOOKING_INVARIANT_RECONCILED";

/** Explicit: repair path never mutates Calendar / never creates events. */
export const BOOKING_REPAIR_MUTATES_CALENDAR = false as const;

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

/**
 * Harden note for BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE:
 * when Calendar create succeeded but pipeline save failed, repair uses the
 * already-persisted googleEventId — never invents a second event.
 */
export function persistenceFailedRepairNote(googleEventId: string, prospectUid: string): string {
  const eid = (googleEventId || "").trim();
  const uid = (prospectUid || "").trim();
  if (!eid || !uid) {
    return "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE: missing proven googleEventId or prospect uid — will not invent a Calendar event.";
  }
  return `BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE: reconciling pipeline to existing google_event_id=${eid} for uid=${uid}. No new Calendar event.`;
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
  spoken: string;
  mutatedCalendar: typeof BOOKING_REPAIR_MUTATES_CALENDAR;
  rows: Array<{
    googleEventId: string;
    prospectUid: string;
    calendarId: string;
    fromStage: string;
    toStage: string;
    isTest: boolean;
    repaired: boolean;
    note: string;
    name: string;
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
    note: string;
    name: string;
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
        note: "Skipped — association not proven, or stage is already at or past Call Booked.",
        name: row.title || "A prospect",
      });
      continue;
    }
    // applyExistingBookingToTestState updates prospect stage + may upsert the EXISTING
    // calendar row metadata — it does not call Google Calendar create.
    await applyExistingBookingToTestState(userId, row.prospectUid, row.googleEventId, null, null, row.title);
    const note = persistenceFailedRepairNote(row.googleEventId, row.prospectUid);
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
      note,
      name: row.title || "A prospect",
    });
  }
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const orphans = await sql<{ uid: string; name: string }>`
    select p.uid, p.name
    from prospects p
    where p.user_id = ${userId}
      and p.stage = 'Call Booked'
      and not exists (
        select 1 from calendar_events ce
        where ce.user_id = p.user_id and ce.prospect_uid = p.uid
          and ce.status = 'booked'
          and ce.google_event_id is not null and ce.google_event_id <> ''
      )
  `;
  const { getProspectByUid, upsertProspects } = await import("@/lib/prospects/repo.server");
  for (const orphan of orphans) {
    const prospect = await getProspectByUid(userId, orphan.uid);
    if (!prospect || prospect.stage !== "Call Booked") {
      skipped += 1;
      continue;
    }
    prospect.stage = "Approved for Outreach";
    prospect.stage_plain = "No calendar event — not Call Booked";
    await upsertProspects(userId, [prospect]);
    if (isTestWorkflowUid(orphan.uid)) {
      const { saveTestState } = await import("./sql.server");
      await saveTestState(userId, { pipeline_stage: "Approved for Outreach", event_id: "" });
    }
    await audit(userId, BOOKING_INVARIANT_RECONCILED, `uid=${orphan.uid} Call Booked->Approved for Outreach (no booked event) sha=${sha}`, {
      prospectUid: orphan.uid,
      method: "MANUAL",
    });
    repaired += 1;
    out.push({
      googleEventId: "",
      prospectUid: orphan.uid,
      calendarId: "",
      fromStage: "Call Booked",
      toStage: "Approved for Outreach",
      isTest: isTestWorkflowUid(orphan.uid),
      repaired: true,
      note: "Call Booked with no booked Google event. Moved back. No calendar event was created.",
      name: orphan.name || "A prospect",
    });
  }
  const remaining = (await loadBookingMismatchRows(userId)).length
    + (await sql<{ n: number }>`
      select count(*)::int as n from prospects p
      where p.user_id = ${userId} and p.stage = 'Call Booked'
        and not exists (
          select 1 from calendar_events ce
          where ce.user_id = p.user_id and ce.prospect_uid = p.uid
            and ce.status = 'booked'
            and ce.google_event_id is not null and ce.google_event_id <> ''
        )
    `)[0]?.n || 0;
  const spoken = repairSpeech({ repaired, remaining, rows: out });
  return {
    inspected: mismatches.length + orphans.length,
    repaired,
    skipped,
    remaining,
    spoken,
    mutatedCalendar: BOOKING_REPAIR_MUTATES_CALENDAR,
    rows: out,
  };
}

export function repairSpeech(result: {
  repaired: number;
  remaining: number;
  rows: Array<{ name?: string; repaired: boolean; toStage: string }>;
}): string {
  const fixed = result.rows.filter((row) => row.repaired);
  if (!fixed.length) {
    return "Pipeline and Calendar disagree, but I could not find a saved booking to correct. Nothing was changed, and no calendar event was created.";
  }
  const lines = fixed.map((row) => {
    const who = row.name || "A prospect";
    if (row.toStage === "Call Booked") return `${who} is now Call Booked, matching the calendar event.`;
    return `${who} said Call Booked, but there is no calendar event. I moved it back to Approved for Outreach.`;
  });
  return `${lines.join(" ")}${result.remaining ? ` ${result.remaining} still open.` : " That problem is fixed."}`;
}
