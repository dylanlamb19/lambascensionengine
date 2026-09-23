import type { InboundClass } from "./replies.ts";

const PROD = "https://lamb-ascension-engine.vercel.app";

export function publicBookingOrigin(): string {
  const auth = (process.env.BETTER_AUTH_URL || "").trim().replace(/\/$/, "");
  if (/^https:\/\//i.test(auth)) return auth;
  const vercel = (process.env.VERCEL_URL || "").replace(/^https?:\/\//, "").trim();
  if (vercel) return `https://${vercel}`;
  return PROD;
}

export function trackedBookingUrl(origin: string, token: string): string {
  const base = (origin || PROD).replace(/\/$/, "");
  return `${base}/book/${token}`;
}

export function replyWantsBooking(cls: InboundClass): boolean {
  return cls === "INTERESTED" || cls === "BOOKING_REQUEST" || cls === "WANTS_AUDIT" || cls === "WANTS_MORE_INFORMATION" || cls === "PRICING_QUESTION";
}

export function shouldReuseBookingToken(link: { status: string; expiresAt?: string | null } | null, now = Date.now()): boolean {
  if (!link || link.status !== "open") return false;
  if (!link.expiresAt) return true;
  const exp = new Date(link.expiresAt).getTime();
  return Number.isFinite(exp) && exp > now;
}

export function applyImmediateBooking<T extends {
  stage?: string;
  stage_plain?: string;
  meeting_at?: string;
  meeting_event_id?: string;
  history?: { at?: string; action?: string; detail?: string }[];
}>(prospect: T, opts: { at: string; startIso: string; eventId: string; brief: string }): T {
  const stage = prospect.stage || "";
  const locked = stage === "Won" || stage === "Lost" || stage === "Do Not Contact";
  const history = [...(prospect.history || [])];
  if (!history.some((h) => h.action === "call_prep")) {
    history.push({ at: opts.at, action: "call_prep", detail: opts.brief });
  }
  history.push({ at: opts.at, action: "meeting_booked", detail: `Booked ${opts.startIso}. Event ${opts.eventId}. Outreach stopped.` });
  return {
    ...prospect,
    stage: locked ? stage : "Call Booked",
    stage_plain: locked ? prospect.stage_plain : "Call is on the calendar",
    meeting_at: opts.startIso,
    meeting_event_id: opts.eventId,
    history,
  };
}
