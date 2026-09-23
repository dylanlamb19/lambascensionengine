import type { AutonomySettings } from "./settings.ts";

export type AutoView = {
  name: string;
  stage: string;
  suppressed?: boolean;
  researchStatus: string;
  hasWebsite: boolean;
  hasEmail: boolean;
  hasOpportunity: boolean;
  fit: string;
  hasPack: boolean;
  alreadySent: boolean;
  booked: boolean;
  prepDone: boolean;
  disqualified: boolean;
  emailBlocked?: boolean;
  reputationPaused?: boolean;
  sendFailed?: boolean;
};

export type AutoDecision =
  | { action: "off"; reason: string }
  | { action: "skip"; reason: string }
  | { action: "research"; reason: string }
  | { action: "disqualify"; reason: string }
  | { action: "generate"; reason: string }
  | { action: "hold"; reason: string }
  | { action: "send"; reason: string }
  | { action: "prep"; reason: string };

const CLOSED = new Set(["Won", "Lost", "Do Not Contact", "Call Booked", "Replied", "Proposal Sent", "Negotiation"]);

export function decideProspect(p: AutoView, settings: AutonomySettings, opts: { testMode: boolean; sentToday: number }): AutoDecision {
  if (!settings.autonomous) return { action: "off", reason: "Autonomous outreach is off." };
  if (p.suppressed || p.stage === "Do Not Contact") return { action: "skip", reason: "Do not contact. Nothing will be sent." };
  if (p.reputationPaused) return { action: "hold", reason: "Sending is paused. Bounce rate is high enough to protect the inbox." };
  if (p.sendFailed) return { action: "skip", reason: "A send already failed for this company. It will not retry forever." };
  if (p.emailBlocked) return { action: "skip", reason: "This address is not safe to mail." };
  if (p.booked || p.stage === "Call Booked") {
    if (!p.prepDone) return { action: "prep", reason: "A call is booked. Outreach stays stopped and call prep is ready." };
    return { action: "skip", reason: "Call is booked and prep already exists. Sequence stays stopped." };
  }
  if (p.stage === "Replied") return { action: "skip", reason: "They already replied. Follow-ups stay stopped." };
  if (p.disqualified) return { action: "skip", reason: "Already passed over. The engine will not email them." };
  if (CLOSED.has(p.stage) && p.stage !== "Approved for Outreach" && p.stage !== "Contacted") {
    return { action: "skip", reason: `${p.stage} is already in a later conversation.` };
  }
  if (p.alreadySent || p.stage === "Contacted") return { action: "skip", reason: "First email already went out. Follow-ups use the existing sequence." };
  if (!p.researchStatus || p.researchStatus === "none" || p.researchStatus === "queued") {
    if (!p.hasWebsite) return { action: "disqualify", reason: "No website on file, so there is nothing verified to research or personalize." };
    return { action: "research", reason: "Website is on file. Research runs before any email." };
  }
  if (p.researchStatus === "blocked" || p.researchStatus === "failed") {
    return { action: "disqualify", reason: "The website could not be reviewed. The engine will not invent a finding or send a generic pitch." };
  }
  if (p.researchStatus !== "complete" && p.researchStatus !== "partial") {
    return { action: "research", reason: "Research is not finished." };
  }
  if (!p.hasOpportunity) return { action: "disqualify", reason: "Research finished and there is no verified acquisition gap. The engine will not send a generic note." };
  if (!p.hasEmail) return { action: "disqualify", reason: "No usable email on file. The engine will not guess one." };
  if (!p.hasPack) return { action: "generate", reason: "Qualified. A personalized draft is written from the stored research." };
  if (!settings.autoSend) return { action: "hold", reason: "Auto send is off. The draft is saved and nothing was sent." };
  if (opts.testMode) return { action: "hold", reason: "Test Mode is on. The draft is saved. No real email was sent." };
  if (opts.sentToday >= settings.dailySendLimit) return { action: "hold", reason: "Daily send limit reached. Nothing else goes out today." };
  return { action: "send", reason: "Qualified, researched, and inside today’s send limit." };
}

export function isSameCompany(a: { name: string; website?: string }, b: { name: string; website?: string }): boolean {
  const an = a.name.trim().toLowerCase();
  const bn = b.name.trim().toLowerCase();
  if (an && an === bn) return true;
  const aw = (a.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
  const bw = (b.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
  return Boolean(aw && bw && aw === bw);
}
