/**
 * Ara "reach out to all prospects" — EMAIL-contactable only.
 * Tailored casual drafts from REAL profile facts only.
 * No prices, no invented ROAS / revenue / lead counts.
 * Soft caps. Never identical blast. Test Mode gated at arm/send layer.
 */
import type { Prospect } from "../review-brief.ts";
import { evaluateContactability } from "../prospects/contactability.ts";
import { decisionMaker, verifiedWebsite, whatWeKnow } from "../prospects/reach.ts";
import { mergeFieldsFromProspect } from "./merge.ts";

export const REACH_OUT_ALL_SOFT_CAP_DEFAULT = 15;
export const REACH_OUT_ALL_CAMPAIGN_NAME = "Ara reach-out-all (Test Mode)";

export type TailoredDraft = {
  prospectUid: string;
  recipient: string;
  subject: string;
  body: string;
  factsUsed: string[];
};

export type ReachOutPlan = {
  eligible: TailoredDraft[];
  skipped: Array<{ prospectUid: string; reason: string }>;
  softCap: number;
  truncated: boolean;
  testModeOnly: true;
  liveEnabled: false;
};

function realBits(p: Prospect): string[] {
  const bits: string[] = [];
  const dm = decisionMaker(p);
  if (dm) bits.push(dm.value);
  if (p.vertical && p.vertical.trim()) bits.push(p.vertical.trim());
  if (p.city && p.city.trim() && p.city.toUpperCase() !== "UNKNOWN") bits.push(p.city.trim());
  if (verifiedWebsite(p)) bits.push("website on file");
  if (p.review_count > 0) bits.push(`${p.review_count} public reviews`);
  const rating = (p.google_rating || "").trim();
  if (rating && rating.toUpperCase() !== "UNKNOWN") bits.push(`public rating ${rating}`);
  return bits;
}

/**
 * Build a casual, per-prospect draft from stored facts only.
 * Intentionally varies wording from real fields so blasts are never identical.
 */
export function buildTailoredOutreach(p: Prospect): TailoredDraft | null {
  const c = evaluateContactability(p);
  if (!c.contactable || !c.emailRoute?.value) return null;
  const fields = mergeFieldsFromProspect(p);
  const facts = realBits(p);
  const company = fields.company || (p.name || "").trim();
  if (!company) return null;

  const dm = fields.decision_maker;
  const vertical = fields.vertical || "local";
  const city = fields.city;
  const hi = dm ? `Hi ${dm.split(",")[0].trim()},` : "Hi,";

  let hook: string;
  if (p.review_count >= 80 && city) {
    hook = `Noticed ${company} has a solid public presence in ${city} (${p.review_count} reviews on the listing).`;
  } else if (verifiedWebsite(p) && vertical) {
    hook = `I was looking at ${company}'s site — ${vertical.toLowerCase()} shops like yours are usually juggling a lot of inbound.`;
  } else if (city && vertical) {
    hook = `Quick note for a ${vertical.toLowerCase()} business in ${city}.`;
  } else if (vertical) {
    hook = `Quick note for ${company} (${vertical}).`;
  } else {
    hook = `Quick note for ${company}.`;
  }

  const body = [
    hi,
    "",
    hook,
    "",
    "I help owners book more of the right conversations without guessing contact info or inventing results.",
    "",
    "Worth a short look when you have a minute?",
    "",
    "— Dylan",
  ].join("\n");

  const subject = city
    ? `Quick note for ${company} (${city})`
    : `Quick note for ${company}`;

  return {
    prospectUid: p.uid || "",
    recipient: c.emailRoute.value,
    subject: subject.slice(0, 120),
    body,
    factsUsed: facts.length ? facts : whatWeKnow(p).slice(0, 4),
  };
}

/** Pure planner — EMAIL contactable only, soft-capped, Test Mode flags fixed. */
export function planReachOutToAll(
  prospects: Prospect[],
  softCap = REACH_OUT_ALL_SOFT_CAP_DEFAULT,
): ReachOutPlan {
  const cap = Math.max(1, Math.min(50, softCap));
  const eligible: TailoredDraft[] = [];
  const skipped: Array<{ prospectUid: string; reason: string }> = [];

  for (const p of prospects) {
    const uid = (p.uid || "").trim();
    if (!uid) continue;
    const c = evaluateContactability(p);
    if (!c.contactable) {
      skipped.push({
        prospectUid: uid,
        reason: c.reasons[0] || `Not EMAIL-contactable (${c.status}).`,
      });
      continue;
    }
    const draft = buildTailoredOutreach(p);
    if (!draft) {
      skipped.push({ prospectUid: uid, reason: "Could not build tailored draft from real facts." });
      continue;
    }
    eligible.push(draft);
  }

  eligible.sort((a, b) => a.subject.localeCompare(b.subject));
  const truncated = eligible.length > cap;
  const capped = eligible.slice(0, cap);

  const bodies = new Set(capped.map((d) => d.body));
  if (capped.length > 1 && bodies.size === 1) {
    for (let i = 0; i < capped.length; i++) {
      const d = capped[i];
      capped[i] = {
        ...d,
        body: `${d.body}\n\n(P.S. This note is for ${d.factsUsed[0] || "your team"} — tailored, not a blast.)`,
      };
    }
  }

  return {
    eligible: capped,
    skipped,
    softCap: cap,
    truncated,
    testModeOnly: true,
    liveEnabled: false,
  };
}

export function draftsArePersonalized(drafts: TailoredDraft[]): boolean {
  if (drafts.length <= 1) return true;
  const subjects = new Set(drafts.map((d) => d.subject));
  const bodies = new Set(drafts.map((d) => d.body));
  return subjects.size === drafts.length || bodies.size === drafts.length;
}
