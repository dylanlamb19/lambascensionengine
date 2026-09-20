import assert from "node:assert/strict";
import test from "node:test";
import { contactSummary, ownerQualify } from "./qualify.ts";
import type { Prospect } from "../review-brief.ts";

function base(partial: Partial<Prospect> = {}): Prospect {
  return {
    id: 1,
    uid: "u1",
    provider: "google_places",
    provider_place_id: "ChREAL",
    provider_source_url: "https://maps.google.com/?cid=1",
    provider_category: "Roofing contractor",
    address: "100 Main, Fort Worth, TX",
    name: "FW Roof Co",
    vertical: "Roofing",
    city: "Fort Worth, TX",
    website: "https://fwroof.example",
    phone: "(817) 555-0100",
    google_rating: "4.8",
    review_count: 12,
    job_value_est: 15000,
    score: 58,
    fit: "possible",
    fit_plain: "Possible, not a sure thing",
    stage: "New",
    stage_plain: "Just added",
    research_status: "none",
    findings: [],
    ...partial,
  };
}

test("listing-only prospect is not discarded and does not invent a decision maker", () => {
  const q = ownerQualify(base());
  assert.equal(q.headline, "POSSIBLE FIT");
  assert.ok(q.why.some((w) => /google listing/i.test(w)));
  assert.ok(q.unknown.some((u) => /decision maker/i.test(u)));
  assert.match(q.found.join(" "), /Decision maker unknown/i);
  assert.doesNotMatch(q.who, /Jane Doe|John Smith/);
});

test("website research unavailable stays on the card and keeps Place ID", () => {
  const q = ownerQualify(base({
    research_status: "blocked",
    website_note: "Website research unavailable. Google listing evidence is kept.",
  }));
  assert.equal(q.websiteResearch, "unavailable");
  assert.ok(q.found.some((f) => /Place ID ChREAL/.test(f)));
  assert.ok(q.found.some((f) => /Website research unavailable/i.test(f)));
});

test("named person + email points next action at draft outreach, not skip", () => {
  const q = ownerQualify(base({
    research_status: "complete",
    readiness: "STRONG CANDIDATE FOR FURTHER QUALIFICATION",
    contacts: [{
      name: "Pat Owner",
      title: "Owner",
      email: "pat@fwroof.example",
      email_status: "unverified",
      profile_url: "",
      source: "https://fwroof.example/about",
      last_verified: "2026-09-20",
    }],
  }));
  assert.equal(q.headline, "GOOD FIT");
  assert.match(q.next, /Draft outreach/i);
  const summary = contactSummary(base({
    contacts: [{
      name: "Pat Owner", title: "Owner", email: "pat@fwroof.example",
      email_status: "unverified", profile_url: "", source: "https://fwroof.example/about", last_verified: "t",
    }],
  }));
  assert.match(summary, /unverified|FOUND PUBLICLY|source/i);
  assert.doesNotMatch(summary, /verified decision-maker email/i);
});

test("review count is a why-signal, never the only reason they disappear", () => {
  const q = ownerQualify(base({ review_count: 2, google_rating: "UNKNOWN" }));
  assert.ok(q.why.some((w) => /2 public reviews/.test(w)));
  assert.notEqual(q.headline, undefined);
});
