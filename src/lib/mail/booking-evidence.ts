import { createHash } from "node:crypto";
import { isTestWorkflowUid } from "./test-loop.ts";

export const BOOKING_CONFIRMED = "booking_confirmed";
export const BOOKING_LINK_CREATED = "booking_link_created";
export const BOOKING_PERSISTENCE_FAILED = "BOOKING_PERSISTENCE_FAILED_AFTER_CALENDAR_CREATE";
export const TEST_BOOKING_STATE_RECONCILED = "TEST_BOOKING_STATE_RECONCILED";
/** Legacy public-booking audit. It was written only after a Google event id existed. */
export const LEGACY_BOOKING_LINK_ACTION = "booking_link";

const CONFIRMED_ACTIONS = new Set([
  BOOKING_CONFIRMED,
  LEGACY_BOOKING_LINK_ACTION,
  "test_booking",
  TEST_BOOKING_STATE_RECONCILED,
]);

export function isBookingConfirmedAction(action: string): boolean {
  return CONFIRMED_ACTIONS.has(action);
}

export function isBookingLinkCreatedAction(action: string): boolean {
  return action === BOOKING_LINK_CREATED;
}

export function bookingCheckOk(eventId: string | null | undefined): boolean {
  return Boolean(eventId && eventId.trim());
}

export function pipelineCheckOk(opts: {
  pipelineStage?: string | null;
  eventId?: string | null;
}): boolean {
  return opts.pipelineStage === "Call Booked" && bookingCheckOk(opts.eventId);
}

export function shouldReconcileTestBooking(opts: {
  prospectUid: string | null | undefined;
  testEventId?: string | null;
  persistedGoogleEventId?: string | null;
}): boolean {
  if (!isTestWorkflowUid(opts.prospectUid)) return false;
  if (bookingCheckOk(opts.testEventId)) return false;
  return bookingCheckOk(opts.persistedGoogleEventId);
}

export function publicBookingDecision(opts: {
  linkStatus: string;
  persistedGoogleEventId?: string | null;
}):
  | { action: "create" }
  | { action: "return_existing"; eventId: string }
  | { action: "persistence_failed" }
  | { action: "invalid" } {
  const id = (opts.persistedGoogleEventId || "").trim();
  if (opts.linkStatus === "open") return { action: "create" };
  if ((opts.linkStatus === "used" || opts.linkStatus === "booking") && id) {
    return { action: "return_existing", eventId: id };
  }
  if (opts.linkStatus === "used" || opts.linkStatus === "booking") {
    return { action: "persistence_failed" };
  }
  return { action: "invalid" };
}

/** Google Calendar event ids: base32hex (a-v, 0-9). SHA-256 hex is a subset. */
export function googleEventIdForBookingToken(token: string): string {
  return createHash("sha256").update(`lasc-book:${token}`).digest("hex").slice(0, 32);
}

export function eventIdsAgree(calendarId: string | null | undefined, auditId: string | null | undefined): boolean {
  const a = (calendarId || "").trim();
  const b = (auditId || "").trim();
  if (!a || !b) return true;
  return a === b;
}

export function provenGoogleEventId(opts: {
  calendarEventId?: string | null;
  auditEventId?: string | null;
}): string | null {
  const calendarId = (opts.calendarEventId || "").trim();
  const auditId = (opts.auditEventId || "").trim();
  if (calendarId && auditId && calendarId !== auditId) return null;
  return calendarId || auditId || null;
}
