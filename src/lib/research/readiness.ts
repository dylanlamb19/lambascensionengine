import { companyKind, kindPlain, type CompanyKind } from "./company-type.ts";
import type { SiteSignals } from "./site-signals.ts";
import { emptySignals } from "./site-signals.ts";
import type { DecisionMaker, DeepInput, Readiness } from "./types.ts";

export type QualifyExtras = {
  websiteOk: boolean;
  socials: number;
  signals?: SiteSignals;
  funnelOk?: boolean;
};

export type QualifyResult = {
  readiness: Readiness;
  kind: CompanyKind;
  why: string[];
  missing: string[];
  points: number;
};

type Hit = { pts: number; why: string };

function hits(input: DeepInput, contacts: DecisionMaker[], extras: QualifyExtras): { kind: CompanyKind; hits: Hit[]; missing: string[] } {
  const kind = companyKind(input.vertical);
  const sig = extras.signals || emptySignals();
  const named = contacts.filter((c) => c.name && c.name !== "UNKNOWN");
  const reviews = input.review_count || 0;
  const locations = input.locations_count || 1;
  const years = input.years_in_business || 0;
  const ratingOk = Boolean(input.google_rating && input.google_rating !== "UNKNOWN");
  const out: Hit[] = [];
  const missing: string[] = [
    "Revenue",
    "Profit",
    "Advertising budget",
    "Whether they can pay a $2,500–$10,000/month retainer",
  ];

  if (kind !== "other") {
    out.push({
      pts: 2,
      why: `Category: ${kindPlain(kind)} — we treat this as a possible high-ticket type, not as verified revenue.`,
    });
  } else if (input.vertical) {
    out.push({
      pts: 1,
      why: `Category on file: ${input.vertical}. We did not force local-service rules, and we did not assume they can pay $10K.`,
    });
  }

  if (extras.websiteOk) out.push({ pts: 1, why: "A public website loaded (one professionalism signal)." });
  if (extras.funnelOk) out.push({ pts: 1, why: "The site has a visible inquire path or tracking snippet (not proof they buy ads)." });
  if (named.length) out.push({ pts: Math.min(2, named.length), why: `Published decision-maker${named.length > 1 ? "s" : ""}: ${named.map((c) => c.name).join(", ")}.` });
  if (locations > 1) out.push({ pts: 2, why: `More than one location on file (${locations}).` });
  if (years >= 8) out.push({ pts: 1, why: `Years in business on file: ${years} (unconfirmed unless a source verified it).` });
  if (ratingOk) out.push({ pts: 1, why: `Public rating on file: ${input.google_rating}.` });
  if (extras.socials > 0) out.push({ pts: 1, why: "Public social profile link(s) found on their site." });

  if (reviews >= 400) out.push({ pts: kind === "local_service" ? 3 : 2, why: `${reviews} public reviews (demand signal — not revenue).` });
  else if (reviews >= 80) out.push({ pts: kind === "local_service" ? 2 : 1, why: `${reviews} public reviews (one demand signal, not required for B2B/SaaS).` });
  else if (reviews >= 20) out.push({ pts: 1, why: `${reviews} public reviews — useful, but not a gate.` });
  else if (reviews > 0) missing.push("Strong public review volume (not required for every business type)");

  if (sig.case_studies) out.push({ pts: kind === "b2b" || kind === "saas" ? 2 : 1, why: "Case-study / client-story language on a page we opened (wording only — not verified contract value)." });
  if (sig.client_logos) out.push({ pts: 1, why: "‘Trusted by’ / client language on a page we opened (not a verified logo list)." });
  if (sig.enterprise_language) out.push({ pts: kind === "saas" || kind === "b2b" ? 2 : 1, why: "Enterprise / B2B wording on a page we opened." });
  if (sig.national_reach) out.push({ pts: 2, why: "Nationwide / national wording on a page we opened (not a verified service map)." });
  if (sig.hiring) out.push({ pts: 1, why: "Hiring / careers wording on a page we opened (growth language, not headcount)." });
  if (sig.team_page) out.push({ pts: 1, why: "Team / leadership wording on a page we opened." });
  if (sig.commercial_positioning) out.push({ pts: 1, why: "Commercial-client wording on a page we opened." });

  return { kind, hits: out, missing };
}

export function classifyQualification(input: DeepInput, contacts: DecisionMaker[], extras: QualifyExtras): QualifyResult {
  const { kind, hits: list, missing } = hits(input, contacts, extras);
  const points = list.reduce((n, h) => n + h.pts, 0);
  const independent = list.length;
  const why = list.map((h) => h.why);

  let readiness: Readiness;
  if (independent <= 1 && points <= 2 && !extras.websiteOk && (input.review_count || 0) < 10) {
    readiness = "LOW PRIORITY";
    why.push("Almost no verified signals yet.");
  } else if (points >= 6 && independent >= 3) {
    readiness = "STRONG CANDIDATE FOR FURTHER QUALIFICATION";
  } else if (points >= 4 && independent >= 2) {
    readiness = "POSSIBLE CANDIDATE";
  } else {
    readiness = "NOT ENOUGH INFORMATION";
    why.push("Not enough verified signals for this business type yet. Reviews are optional — we still need other proof.");
  }

  return { readiness, kind, why, missing, points };
}

/** Back-compat wrapper used by older tests. */
export function classifyReadiness(input: DeepInput, contacts: DecisionMaker[], websiteOk: boolean): Readiness {
  return classifyQualification(input, contacts, { websiteOk, socials: 0 }).readiness;
}

export function shouldRunPaidEnrichment(q: QualifyResult, score: number, minScore: number): boolean {
  if (q.readiness === "LOW PRIORITY" || q.readiness === "NOT ENOUGH INFORMATION") return false;
  if (score < minScore && q.readiness !== "STRONG CANDIDATE FOR FURTHER QUALIFICATION") return false;
  return q.readiness === "STRONG CANDIDATE FOR FURTHER QUALIFICATION" || q.readiness === "POSSIBLE CANDIDATE";
}
