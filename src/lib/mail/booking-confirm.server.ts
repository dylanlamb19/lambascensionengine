import { getProspectByUid, upsertProspects } from "@/lib/prospects/repo.server";
import {
  audit,
  findBookedCalendarEvent,
  findBookingAuditEventId,
  finishBookingLink,
  loadTestState,
  saveCalendarEvent,
  saveTestState,
  stopSequencesForProspect,
  type SalesTestState,
} from "./sql.server";
import { isTestWorkflowUid } from "./test-loop";
import { promotedStageForBooking } from "./booking-stage";
import {
  BOOKING_CONFIRMED,
  BOOKING_PERSISTENCE_FAILED,
  TEST_BOOKING_STATE_RECONCILED,
  provenGoogleEventId,
  publicBookingDecision,
  shouldReconcileTestBooking,
} from "./booking-evidence";

export { BOOKING_PERSISTENCE_FAILED, publicBookingDecision };

export async function provenBookingEventId(
  userId: string,
  prospectUid: string,
  bookingToken?: string | null,
): Promise<{ eventId: string; startAt: string | null; endAt: string | null; title: string | null } | null> {
  const row = await findBookedCalendarEvent(userId, prospectUid, bookingToken);
  const auditId = await findBookingAuditEventId(userId, prospectUid);
  const eventId = provenGoogleEventId({
    calendarEventId: row?.google_event_id,
    auditEventId: auditId,
  });
  if (!eventId) return null;
  return {
    eventId,
    startAt: row?.start_at || null,
    endAt: row?.end_at || null,
    title: row?.title || null,
  };
}

export async function persistConfirmedBooking(opts: {
  userId: string;
  prospectUid: string;
  googleEventId: string;
  title: string;
  start: Date;
  end: Date;
  token?: string | null;
  method: "MANUAL" | "AUTOMATION";
}): Promise<{ ok: true } | { ok: false; code: typeof BOOKING_PERSISTENCE_FAILED; reason: string; eventId: string }> {
  try {
    if (opts.token) await finishBookingLink(opts.token, "used");
    await saveCalendarEvent(
      opts.userId,
      opts.prospectUid,
      opts.googleEventId,
      opts.title,
      opts.start,
      opts.end,
      opts.token,
    );
    await stopSequencesForProspect(opts.userId, opts.prospectUid);
    const prospect = await getProspectByUid(opts.userId, opts.prospectUid);
    if (prospect) {
      const { applyImmediateBooking } = await import("../autonomy/booking-link");
      const { salesBrief } = await import("../autonomy/sales");
      const { opportunities, recommendOffer } = await import("../review-brief");
      const offer = recommendOffer(prospect);
      const brief = salesBrief({
        company: prospect.name,
        contact: prospect.contacts?.[0]?.name || "",
        website: prospect.website,
        vertical: prospect.vertical,
        city: prospect.city,
        gaps: opportunities(prospect).map((o) => o.code),
        angle: prospect.outreach?.brief.angle || "",
        replySummary: (prospect.history || []).filter((h) => h.action === "reply" || h.action === "autonomy_replied").map((h) => h.detail || "").join(" "),
        emailsSent: (prospect.history || []).some((h) => h.action === "autonomy_sent" || h.action === "email_sent") ? 1 : 0,
        researchDone: prospect.research_status === "complete" || prospect.research_status === "partial",
        offerName: offer.name,
        offerWhy: offer.why,
      });
      const booked = applyImmediateBooking(prospect, {
        at: new Date().toISOString(),
        startIso: opts.start.toISOString(),
        eventId: opts.googleEventId,
        brief,
      });
      if (isTestWorkflowUid(opts.prospectUid)) booked.stage_plain = "Test call booked";
      await upsertProspects(opts.userId, [booked]);
    }
    if (isTestWorkflowUid(opts.prospectUid)) {
      await saveTestState(opts.userId, {
        event_id: opts.googleEventId,
        pipeline_stage: "Call Booked",
        step: 11,
      });
    }
    await audit(opts.userId, BOOKING_CONFIRMED, "Prospect booked a time", {
      prospectUid: opts.prospectUid,
      method: opts.method,
      providerIds: opts.googleEventId,
    });
    return { ok: true };
  } catch {
    try {
      await audit(
        opts.userId,
        BOOKING_PERSISTENCE_FAILED,
        `google_event_id=${opts.googleEventId}`,
        { prospectUid: opts.prospectUid, method: opts.method, providerIds: opts.googleEventId },
      );
    } catch {
      /* keep original failure */
    }
    return {
      ok: false,
      code: BOOKING_PERSISTENCE_FAILED,
      reason: "The Calendar event was created, but booking state could not be saved. No second event was created.",
      eventId: opts.googleEventId,
    };
  }
}

export async function applyExistingBookingToTestState(
  userId: string,
  prospectUid: string,
  eventId: string,
  start?: Date | string | null,
  end?: Date | string | null,
  title?: string | null,
): Promise<SalesTestState> {
  const prospect = await getProspectByUid(userId, prospectUid);
  const promoted = prospect ? promotedStageForBooking(prospect.stage) : null;
  if (prospect && promoted) {
    prospect.stage = promoted;
    prospect.stage_plain = isTestWorkflowUid(prospectUid) ? "Test call booked" : "Call is on the calendar";
    await upsertProspects(userId, [prospect]);
  }
  if (start && end && eventId) {
    await saveCalendarEvent(
      userId,
      prospectUid,
      eventId,
      title || (isTestWorkflowUid(prospectUid) ? "TEST sales call" : "Sales call"),
      start instanceof Date ? start : new Date(start),
      end instanceof Date ? end : new Date(end),
    );
  }
  if (!isTestWorkflowUid(prospectUid)) {
    return loadTestState(userId);
  }
  const current = await loadTestState(userId);
  if (current.prospect_uid && current.prospect_uid !== prospectUid) {
    return current;
  }
  return saveTestState(userId, {
    event_id: eventId,
    pipeline_stage: "Call Booked",
    step: 11,
  });
}

export async function reconcileTestBookingFromPersisted(userId: string): Promise<{
  ok: true;
  reconciled: boolean;
  eventId: string | null;
  state: SalesTestState;
  reason?: string;
}> {
  const state = await loadTestState(userId);
  const uid = state.prospect_uid;
  if (!isTestWorkflowUid(uid)) {
    return { ok: true, reconciled: false, eventId: state.event_id, state };
  }
  const proven = await provenBookingEventId(userId, uid, state.booking_token);
  if (!shouldReconcileTestBooking({
    prospectUid: uid,
    testEventId: state.event_id,
    persistedGoogleEventId: proven?.eventId,
  })) {
    return { ok: true, reconciled: false, eventId: state.event_id || proven?.eventId || null, state };
  }
  const eventId = proven!.eventId;
  const next = await applyExistingBookingToTestState(
    userId,
    uid,
    eventId,
    proven?.startAt,
    proven?.endAt,
    proven?.title,
  );
  await audit(userId, TEST_BOOKING_STATE_RECONCILED, `google_event_id=${eventId}`, {
    prospectUid: uid,
    method: "AUTOMATION",
    providerIds: eventId,
  });
  return { ok: true, reconciled: true, eventId, state: next };
}
