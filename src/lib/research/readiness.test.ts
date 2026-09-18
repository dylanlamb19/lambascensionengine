import assert from "node:assert/strict";
import test from "node:test";
import { classifyQualification, shouldRunPaidEnrichment } from "./readiness.ts";
import { extractSiteSignals } from "./site-signals.ts";
import type { DeepInput } from "./types.ts";

function base(over: Partial<DeepInput>): DeepInput {
  return {
    name: "X", website: "https://example.com", vertical: "", city: "Dallas",
    phone: "UNKNOWN", google_rating: "UNKNOWN", review_count: 0, score: 60,
    research_status: "complete", ...over,
  };
}

test("roofing with many reviews can be strong even if the website is blocked", () => {
  const q = classifyQualification(
    base({ name: "Big Roof", vertical: "Roofing", review_count: 800, google_rating: "4.8", locations_count: 3, score: 80 }),
    [],
    { websiteOk: false, socials: 0 },
  );
  assert.equal(q.readiness, "STRONG CANDIDATE FOR FURTHER QUALIFICATION");
  assert.ok(q.why.some((w) => /800 public reviews/i.test(w)));
});

test("B2B consulting with 20 reviews + case studies + people is strong — reviews are not the gate", () => {
  const q = classifyQualification(
    base({ name: "Northstar Ops", vertical: "B2B consulting", review_count: 20, score: 70 }),
    [
      { name: "Sara Chen", title: "Managing Partner", email: "", email_status: "none", profile_url: "", source: "site", last_verified: "t" },
      { name: "Mark Ellis", title: "CEO", email: "", email_status: "none", profile_url: "", source: "site", last_verified: "t" },
    ],
    {
      websiteOk: true,
      socials: 1,
      signals: { case_studies: true, client_logos: true, enterprise_language: true, national_reach: true, hiring: false, team_page: true, commercial_positioning: false },
    },
  );
  assert.equal(q.readiness, "STRONG CANDIDATE FOR FURTHER QUALIFICATION");
  assert.ok(q.why.some((w) => /B2B/i.test(w)));
  assert.equal(shouldRunPaidEnrichment(q, 70, 65), true);
});

test("SaaS with thin Google reviews can still qualify on product/maturity language", () => {
  const q = classifyQualification(
    base({ name: "Ledgerflow", vertical: "SaaS / software", review_count: 12, score: 66 }),
    [{ name: "Ava Patel", title: "CEO", email: "", email_status: "none", profile_url: "", source: "site", last_verified: "t" }],
    {
      websiteOk: true,
      socials: 1,
      funnelOk: true,
      signals: { case_studies: false, client_logos: true, enterprise_language: true, national_reach: false, hiring: true, team_page: true, commercial_positioning: false },
    },
  );
  assert.notEqual(q.readiness, "LOW PRIORITY");
  assert.notEqual(q.readiness, "NOT ENOUGH INFORMATION");
  assert.ok(q.why.some((w) => /12 public reviews/i.test(w) || /Enterprise/i.test(w)));
  assert.equal(shouldRunPaidEnrichment(q, 66, 65), true);
});

test("medical / cosmetic uses procedures + locations + funnel, not review volume alone", () => {
  const q = classifyQualification(
    base({ name: "Lumen Aesthetics", vertical: "Med spa / cosmetic", review_count: 40, locations_count: 2, score: 68 }),
    [],
    { websiteOk: true, socials: 0, funnelOk: true },
  );
  assert.ok(q.readiness === "POSSIBLE CANDIDATE" || q.readiness === "STRONG CANDIDATE FOR FURTHER QUALIFICATION");
});

test("a thin unknown shop with almost no signals is not forced through by category guesses", () => {
  const q = classifyQualification(
    base({ name: "Corner Cart", vertical: "Coffee", review_count: 3, score: 20, research_status: "none" }),
    [],
    { websiteOk: false, socials: 0 },
  );
  assert.ok(q.readiness === "LOW PRIORITY" || q.readiness === "NOT ENOUGH INFORMATION");
  assert.equal(shouldRunPaidEnrichment(q, 20, 65), false);
});

test("site-signal extractor does not turn marketing copy into revenue", () => {
  const s = extractSiteSignals("<p>Trusted by enterprise teams. Read our case studies. We’re hiring.</p>");
  assert.equal(s.enterprise_language, true);
  assert.equal(s.case_studies, true);
  assert.equal(s.hiring, true);
});
