import { whyConsider, type Prospect } from "../review-brief.ts";
import { hypothesesFor } from "./hypotheses.ts";
import type { IndustryAttack, ProposalDoc } from "./types.ts";

const AD_SPEND = "Advertising spend is separate from the management fee. We do not set or claim a spend number until you and the client agree.";

export function buildProposal(p: Prospect, opts: { monthlyFee: number | null; attack?: IndustryAttack | null }): ProposalDoc {
  const hy = hypothesesFor(p);
  const named = (p.contacts || []).filter((c) => c.name && c.name !== "UNKNOWN");
  const fee = opts.monthlyFee != null && Number.isFinite(opts.monthlyFee) && opts.monthlyFee > 0
    ? opts.monthlyFee
    : null;
  const feeLine = fee == null
    ? "Management fee: UNKNOWN — you still need to enter a monthly fee. Lamb Ascension will not invent one."
    : `Management fee: $${Math.round(fee).toLocaleString("en-US")} / month.`;

  const opps = hy.filter((h) => h.code !== "NO CLEAR OPPORTUNITY YET");
  const sit = whyConsider(p);
  const oppLines = opps.length
    ? opps.map((h) => `- ${h.title}: ${h.plain}`).join("\n")
    : "- No clear public opportunity was verified. We will not invent one in this proposal.";

  const unknowns: string[] = [];
  const d = p.discovery || {};
  if (!d.customer_value) unknowns.push("average customer value");
  if (!d.close_rate) unknowns.push("close rate");
  if (!d.monthly_ad_budget) unknowns.push("current advertising budget");
  const unknownLine = unknowns.length
    ? `Still unknown (must be confirmed with the client): ${unknowns.join(", ")}.`
    : "Client-provided economics are on file for this draft.";

  const body = [
    `Proposal — ${p.name}`,
    "",
    "Current situation",
    sit,
    "",
    "Opportunity (hypotheses from public pages — not guaranteed revenue)",
    oppLines,
    "",
    "Lamb Ascension acquisition system",
    opts.attack?.offer
      || "We help you get more of the right customers. We will not promise a revenue number we have not measured.",
    "",
    "What we will manage",
    "- Research, tracking hygiene, and campaign direction you approve",
    "- Creative and landing-page drafts from verified facts only",
    "- Reporting on spend, leads, and outcomes we can actually see",
    "",
    "What the client needs to provide",
    "- Offer, service area, and brand assets",
    "- Ad account / analytics access",
    "- Honest economics (customer value, close rate, capacity)",
    named.length ? `- Primary contact: ${named[0].name}` : "- A named decision-maker (UNKNOWN until they tell us)",
    "",
    "Tracking / measurement",
    "We do not launch paid media until conversion measurement is checked. Platform-attributed numbers are labeled separately from CRM-verified numbers.",
    "",
    feeLine,
    AD_SPEND,
    "",
    unknownLine,
    "",
    "Next steps",
    "1. You review this draft.",
    "2. Nothing is sent until you approve.",
    "3. After they sign, onboarding starts — that is a later phase, not this proposal.",
    "",
    "This document does not guarantee revenue, ROAS, or a specific number of customers.",
  ].join("\n");

  return {
    status: "draft",
    monthly_fee: fee,
    ad_spend_note: AD_SPEND,
    body,
    generated_at: new Date().toISOString(),
  };
}
