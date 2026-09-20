import { opportunities, type Prospect } from "../review-brief.ts";
import type { OpportunityCode, OpportunityHypothesis } from "./types.ts";

function presentAd(p: Prospect, network: "google" | "meta"): boolean {
  return (p.ads || []).some(
    (a) => a.network === network && a.label === "ADVERTISING DETECTED",
  );
}

function finding(p: Prospect, id: string): string {
  const f = (p.findings || []).find((x) => x.id === id);
  if (!f) return "";
  return `${f.result} (${f.status})`;
}

/** Evidence-grounded hypotheses. Never claimed as proven revenue loss. */
export function hypothesesFor(p: Prospect): OpportunityHypothesis[] {
  if (p.research_status !== "complete" && p.research_status !== "partial") {
    return [];
  }

  const opps = opportunities(p);
  const out: OpportunityHypothesis[] = [];
  const seen = new Set<OpportunityCode>();

  function add(code: OpportunityCode, title: string, plain: string, evidence: string) {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, title, plain, evidence });
  }

  if (presentAd(p, "google")) {
    add(
      "HIGH-INTENT SEARCH OPPORTUNITY",
      "They appear to buy search ads",
      "A public source showed Google advertising. That is not proof spend is wasted — only that paid search is already in play, so a conversion or tracking conversation can be honest.",
      (p.ads || []).find((a) => a.network === "google")?.detail || "Google ad observation on file.",
    );
  }

  if (opps.some((o) => o.code === "NO_HOMEPAGE_FORM" || o.code === "NO_HOMEPAGE_CTA" || o.code === "DEMAND_WEAK_FUNNEL")) {
    add(
      "LANDING PAGE OPPORTUNITY",
      "The public homepage is hard to inquire from",
      "We observed a weak first-step on the homepage (form or quote CTA). That is a hypothesis about conversion, not a verified revenue loss.",
      opps.find((o) => ["NO_HOMEPAGE_FORM", "NO_HOMEPAGE_CTA", "DEMAND_WEAK_FUNNEL"].includes(o.code))?.plain || finding(p, "contact_form"),
    );
  }

  if (opps.some((o) => o.code === "NO_CLICK_TO_CALL" || o.code === "NO_HOMEPAGE_FORM" || o.code === "NO_HOMEPAGE_CTA")) {
    add(
      "CONVERSION RATE OPPORTUNITY",
      "The path from visitor to inquiry looks weak",
      "Public pages we checked make it harder than it should be to call or submit a form. We did not measure their actual conversion rate.",
      opps.find((o) => o.code === "NO_CLICK_TO_CALL")?.plain || finding(p, "primary_cta") || finding(p, "contact_form"),
    );
  }

  if (presentAd(p, "meta") || opps.some((o) => o.code === "NO_TRACKING") === false && (p.findings || []).some((f) => f.id === "meta_pixel" && !/^no /i.test(f.result))) {
    const pixel = (p.findings || []).find((f) => f.id === "meta_pixel");
    const pixelOn = pixel && !/^no /i.test(pixel.result || "") && pixel.status !== "ERROR" && pixel.status !== "UNKNOWN";
    if (presentAd(p, "meta") || pixelOn) {
      add(
        "META DEMAND GENERATION OPPORTUNITY",
        "Meta / demand-gen signals are on the public site",
        "A Meta pixel or Meta ad observation is on file. That is not proof they run a good (or any) Meta campaign — only that demand-gen is a fair topic.",
        presentAd(p, "meta")
          ? (p.ads || []).find((a) => a.network === "meta")?.detail || "Meta advertising detected."
          : finding(p, "meta_pixel"),
      );
    }
  }

  if (opps.some((o) => o.code === "NO_TRACKING" || o.code === "NO_ADS_CONVERSION_TAG")) {
    add(
      "TRACKING / ATTRIBUTION GAP",
      "Common tracking tags were missing where we looked",
      "Missing tags on checked pages does not prove they never advertise. It is a reason to ask how they know which leads pay.",
      opps.find((o) => o.code === "NO_TRACKING" || o.code === "NO_ADS_CONVERSION_TAG")?.plain || finding(p, "meta_pixel"),
    );
  }

  if (opps.some((o) => o.code === "NO_HOMEPAGE_FORM") && (presentAd(p, "google") || presentAd(p, "meta"))) {
    add(
      "LEAD HANDLING OPPORTUNITY",
      "Ads may send people to a weak inquire path",
      "We saw advertising signals and a weak homepage form. We do not know how they handle leads after they arrive.",
      "Advertising observation plus missing homepage form.",
    );
  }

  const hasBooking = (p.findings || []).some((f) => f.id === "booking" && !/^no /i.test(f.result || "") && f.status !== "UNKNOWN");
  if (!hasBooking && (p.research_status === "complete" || p.research_status === "partial") && out.length) {
    add(
      "FOLLOW-UP SYSTEM OPPORTUNITY",
      "No public booking path — follow-up is unknown",
      "We did not see online booking on pages we checked. Follow-up after a form or phone call is UNKNOWN until they tell us.",
      finding(p, "booking") || "No booking finding on checked pages.",
    );
  }

  if (!out.length) {
    add(
      "NO CLEAR OPPORTUNITY YET",
      "No honest pitch from public pages yet",
      "Research finished without a clear on-page gap we can stand behind. If their marketing looks strong, say so — do not invent a problem.",
      "Website research on file; no pitchable gap coded.",
    );
  }

  return out;
}

export function opportunityCodesFor(p: Prospect): OpportunityCode[] {
  return hypothesesFor(p).map((h) => h.code);
}
