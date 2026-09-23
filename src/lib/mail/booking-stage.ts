/** Stages that already satisfy a booked Google Calendar event. Do not downgrade these. */
export const BOOKING_SATISFIED_STAGES = [
  "Call Booked",
  "Proposal Sent",
  "Negotiation",
  "Won",
] as const;

const SATISFIED = new Set<string>(BOOKING_SATISFIED_STAGES);

export function bookingSatisfied(stage: string | null | undefined): boolean {
  return SATISFIED.has(stage || "");
}

/** Promote only when a booked event exists and the pipeline is still behind Call Booked. */
export function promotedStageForBooking(stage: string | null | undefined): "Call Booked" | null {
  const current = stage || "";
  if (!current || bookingSatisfied(current)) return null;
  if (current === "Lost" || current === "Do Not Contact") return null;
  return "Call Booked";
}
