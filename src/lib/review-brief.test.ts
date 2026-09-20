import assert from "node:assert/strict";
import test from "node:test";
import { explainCompany, opportunities, recommendOffer, whyConsider, type Prospect } from "./review-brief.ts";

function align(): Prospect {
  return {
    id: 2, name: "Align Foundation Repair", vertical: "Foundation repair", city: "Dallas-Fort Worth",
    website: "https://alignfoundationrepair.com/", review_count: 80, google_rating: "UNKNOWN",
    phone: "UNKNOWN", job_value_est: 12000, score: 68, fit: "strong", fit_plain: "Good fit",
    stage: "Qualified", stage_plain: "Research done", research_status: "complete",
    findings: [
      { id: "click_to_call", result: "tel: link found (tel:214.710.2555)", status: "VERIFIED" },
      { id: "contact_form", result: "No form detected on homepage", status: "OBSERVED" },
      { id: "contact_form_inner", result: "Form detected on an inner checked page", status: "VERIFIED" },
      { id: "primary_cta", result: "No common quote/estimate CTA text in first content", status: "OBSERVED" },
      { id: "meta_pixel", result: "Meta Pixel snippet detected on checked page", status: "VERIFIED" },
      { id: "gtm", result: "Google Tag Manager detected on checked page", status: "VERIFIED" },
      { id: "pagespeed_mobile", result: "PageSpeed quota exceeded", status: "ERROR" },
    ],
  };
}

function firefighter(): Prospect {
  return {
    id: 1, name: "Firefighter Roofing", vertical: "Roofing", city: "North Richland Hills",
    website: "https://firefighterroofing.com/", review_count: 400, google_rating: "4.9",
    phone: "(817) 479-8999", job_value_est: 16000, score: 72, fit: "strong", fit_plain: "Good fit",
    stage: "Ready for Review", stage_plain: "Waiting", research_status: "blocked",
    findings: [{ id: "resolves", result: "Request blocked by site", status: "UNKNOWN" }],
  };
}

test("Align opportunities come only from stored findings", () => {
  const opps = opportunities(align());
  assert.ok(opps.some((o) => o.code === "NO_HOMEPAGE_FORM"));
  assert.ok(opps.some((o) => o.code === "NO_HOMEPAGE_CTA"));
  assert.ok(!opps.some((o) => o.code === "SLOW_MOBILE"));
  assert.ok(!opps.some((o) => o.code === "NO_CLICK_TO_CALL"));
});

test("Align offer is Convert from funnel + tags + reviews", () => {
  const offer = recommendOffer(align());
  assert.equal(offer.name, "Convert");
  assert.match(offer.why, /homepage/i);
});

test("Firefighter blocked: no invented opportunities or offer", () => {
  const f = firefighter();
  assert.equal(opportunities(f).length, 0);
  assert.equal(recommendOffer(f).name, "Unknown");
  const why = whyConsider(f);
  assert.match(why, /400 public reviews/);
  assert.match(why, /Website research unavailable/i);
});

test("explain is company-specific and does not invent budget", () => {
  const text = explainCompany(align());
  assert.match(text, /Align Foundation Repair/);
  assert.match(text, /80 public reviews/);
  assert.match(text, /do NOT know their revenue/i);
  assert.match(text, /Convert/);
});
