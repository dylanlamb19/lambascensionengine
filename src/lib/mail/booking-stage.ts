/** Stages that already satisfy a booked Google Calendar event. Do not downgrade these. */
export const BOOKING_SATISFIED_STAGES = [
  "Call Booked",
  "Proposal Sent",
  "Negotiation",
  "Won",
] as const;

const SATISFIED = new Set<string>(BOOKING_SATISFIED_STAGES);

/** Non-canonical labels that mean the same as Call Booked and should be rewritten. */
const BOOKED_ALIASES = new Set(["Booked", "booked", "Call booked", "call booked"]);

export function isBookedStageAlias(stage: string | null | undefined): boolean {
  return BOOKED_ALIASES.has((stage || "").trim());
}

export function normalizeBookingStage(stage: string | null | undefined): string {
  const current = (stage || "").trim();
  if (!current) return "";
  if (BOOKED_ALIASES.has(current)) return "Call Booked";
  return current;
}

export function bookingSatisfied(stage: string | null | undefined): boolean {
  return SATISFIED.has(normalizeBookingStage(stage));
}

/**
 * Promote only when a booked event exists and the pipeline is still behind Call Booked.
 * Empty / blank stage counts as behind (Prospect UI hardcodes Status: Booked from calendar
 * evidence while prospects.stage may never have been set to Call Booked).
 * Alias "Booked" is rewritten to canonical Call Booked.
 */
export function promotedStageForBooking(stage: string | null | undefined): "Call Booked" | null {
  const raw = (stage || "").trim();
  if (!raw || isBookedStageAlias(raw)) return "Call Booked";
  if (bookingSatisfied(raw)) return null;
  if (raw === "Lost" || raw === "Do Not Contact") return null;
  return "Call Booked";
}
