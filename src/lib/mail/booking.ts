export type OfferedSlot = { start: Date; end: Date };

const SLOT_MS = 30 * 60 * 1000;
const MATCH_MS = 60 * 1000;

export function slotIsOffered(requested: OfferedSlot, offered: OfferedSlot[], now: Date): { ok: true } | { ok: false; reason: string } {
  if (Number.isNaN(requested.start.getTime()) || Number.isNaN(requested.end.getTime())) {
    return { ok: false, reason: "Pick a listed time." };
  }
  if (requested.start.getTime() <= now.getTime()) {
    return { ok: false, reason: "That time has already passed." };
  }
  const duration = requested.end.getTime() - requested.start.getTime();
  if (duration < SLOT_MS - MATCH_MS || duration > SLOT_MS + MATCH_MS) {
    return { ok: false, reason: "Meetings are 30 minutes. That time was not offered." };
  }
  const hit = offered.some(
    (s) =>
      Math.abs(s.start.getTime() - requested.start.getTime()) <= MATCH_MS &&
      Math.abs(s.end.getTime() - requested.end.getTime()) <= MATCH_MS,
  );
  if (!hit) return { ok: false, reason: "That time was not offered. Pick one of the listed times." };
  return { ok: true };
}

export type BookingLink = { token: string; status: "open" | "booking" | "used" | "expired"; expiresAt: number };

export function claimBooking(link: BookingLink, now: number): "won" | "used" | "expired" {
  if (now > link.expiresAt) return "expired";
  if (link.status !== "open") return "used";
  link.status = "booking";
  return "won";
}

export function makeBookingClaim(): (link: BookingLink, now: number) => Promise<"won" | "used" | "expired"> {
  let chain = Promise.resolve();
  return (link, now) => {
    let result: "won" | "used" | "expired" = "used";
    const next = chain.then(() => {
      result = claimBooking(link, now);
    });
    chain = next.then(() => undefined, () => undefined);
    return next.then(() => result);
  };
}
