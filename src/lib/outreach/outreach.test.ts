import assert from "node:assert/strict";
import test from "node:test";
import { generateOutreach } from "./generate.ts";
import { classifyReply, draftReply } from "./reply.ts";
import { qualifyValueOffer } from "./discovery.ts";
import type { Prospect } from "../review-brief.ts";

function p(over: Partial<Prospect>): Prospect {
  return {
    id: 1, name: "X", vertical: "Roofing", city: "Dallas", website: "https://x.com",
    review_count: 0, google_rating: "UNKNOWN", phone: "UNKNOWN", job_value_est: 0,
    score: 70, fit: "strong", fit_plain: "Good fit", stage: "Approved for Outreach",
    stage_plain: "Ready", research_status: "complete", findings: [], ...over,
  };
}

test("local roofing uses listing facts when the site is blocked — no invented funnel", () => {
  const pack = generateOutreach(p({
    name: "Firefighter Roofing", vertical: "Roofing", city: "North Richland Hills",
    review_count: 400, google_rating: "4.9", research_status: "blocked",
    findings: [{ id: "resolves", result: "Request blocked by site", status: "UNKNOWN" }],
  }));
  const email = pack.messages.find((m) => m.kind === "email")!;
  assert.match(email.body, /400 public reviews/);
  assert.doesNotMatch(email.body, /could use improvement/i);
  assert.doesNotMatch(email.body, /\$10K|ROAS|ad spend/i);
  assert.match(pack.call.opener, /Firefighter Roofing/);
});

test("foundation company email mentions the verified homepage form gap", () => {
  const pack = generateOutreach(p({
    name: "Align Foundation Repair", vertical: "Foundation repair", city: "Dallas-Fort Worth",
    review_count: 80, research_status: "complete",
    findings: [
      { id: "contact_form", result: "No form detected on homepage", status: "OBSERVED" },
      { id: "contact_form_inner", result: "Form detected on an inner checked page", status: "VERIFIED" },
      { id: "primary_cta", result: "No common quote/estimate CTA text in first content", status: "OBSERVED" },
    ],
  }));
  const email = pack.messages.find((m) => m.kind === "email")!;
  assert.match(email.body, /didn’t see a contact form|did not find a contact form/i);
  assert.match(email.body, /inside page|inner/i);
  assert.match(email.angle_why, /homepage form/i);
});

test("B2B consulting with case studies does not use a local-reviews pitch", () => {
  const pack = generateOutreach(p({
    name: "Northstar Operations", vertical: "B2B consulting", city: "Austin",
    review_count: 18, company_kind: "b2b", research_status: "complete",
    contacts: [{ name: "Sara Chen", title: "Managing Partner", email: "sara@example.com", email_status: "unverified", profile_url: "https://linkedin.com/in/sara", source: "site", last_verified: "t" }],
    facts: [{ key: "case_studies", value: "Case-study / client-story language on a page we opened", source: "site", checked_at: "t", confidence: "low", status: "OBSERVED" }],
    findings: [],
  }));
  const email = pack.messages.find((m) => m.kind === "email")!;
  assert.match(email.body, /Sara|Northstar/);
  assert.match(email.body, /case-study|client-story|businesses/i);
  assert.doesNotMatch(email.body, /800 reviews/);
  const li = pack.messages.find((m) => m.kind === "linkedin");
  assert.ok(li);
  assert.notEqual(li!.body, email.body);
});

test("SaaS with 9 reviews uses enterprise wording, not a review-volume hook", () => {
  const pack = generateOutreach(p({
    name: "Ledgerflow", vertical: "SaaS / software", city: "Remote",
    review_count: 9, company_kind: "saas", research_status: "complete",
    contacts: [{ name: "Ava Patel", title: "CEO", email: "", email_status: "none", profile_url: "", source: "site", last_verified: "t" }],
    facts: [{ key: "enterprise_language", value: "Enterprise / B2B wording on a page we opened", source: "site", checked_at: "t", confidence: "low", status: "OBSERVED" }],
  }));
  const email = pack.messages.find((m) => m.kind === "email")!;
  assert.match(email.body, /Ava|Ledgerflow/);
  assert.match(email.body, /businesses/i);
  assert.doesNotMatch(email.body, /9 public reviews make you a local brand/i);
});

test("medical company can use a homepage CTA gap without fake performance claims", () => {
  const pack = generateOutreach(p({
    name: "Lumen Aesthetics", vertical: "Med spa / cosmetic", city: "Fort Worth",
    review_count: 40, locations_count: 2, research_status: "complete",
    findings: [{ id: "primary_cta", result: "No common quote/estimate CTA text in first content", status: "OBSERVED" }],
  }));
  const email = pack.messages.find((m) => m.kind === "email")!;
  assert.match(email.body, /quote|estimate|Lumen/i);
  assert.doesNotMatch(email.body, /ROAS|conversion rate/i);
});

test("unsubscribe reply is classified and never asks them to stay", () => {
  assert.equal(classifyReply("Please unsubscribe me"), "UNSUBSCRIBE");
  assert.match(draftReply("UNSUBSCRIBE", "Sam"), /off this thread/i);
});

test("$10K label requires client-provided economics, not Google reviews", () => {
  const weak = qualifyValueOffer({});
  assert.equal(weak.fit, "NEED MORE INFORMATION");
  const high = qualifyValueOffer({ customer_value: "15000", monthly_ad_budget: "5000", capacity: "20 jobs/month" });
  assert.equal(high.fit, "HIGH-VALUE OFFER MAY MAKE SENSE");
});
