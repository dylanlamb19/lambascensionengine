import assert from "node:assert/strict";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import {
  applyEmailHit,
  extractStoredPublicEmail,
  looksLikeEmail,
  needsEmailEnrichment,
  planEmailEnrichAttempt,
} from "./email-enrich.ts";
import { evaluateContactability } from "./contactability.ts";
import { usefulEmail } from "./reach.ts";

function base(partial: Partial<Prospect> = {}): Prospect {
  return {
    id: 1,
    uid: "p-enrich-1",
    name: "MedSpa Austin",
    vertical: "Med Spa",
    city: "Austin",
    website: "https://medspa.example",
    review_count: 40,
    google_rating: "4.8",
    phone: "(512) 555-0199",
    job_value_est: 0,
    score: 72,
    fit: "strong",
    fit_plain: "Good fit",
    stage: "New",
    stage_plain: "Just added",
    research_status: "complete",
    findings: [],
    readiness: "STRONG CANDIDATE FOR FURTHER QUALIFICATION",
    contacts: [],
    ...partial,
  };
}

test("looksLikeEmail rejects blanks and non-emails", () => {
  assert.equal(looksLikeEmail(""), false);
  assert.equal(looksLikeEmail("UNKNOWN"), false);
  assert.equal(looksLikeEmail("not-an-email"), false);
  assert.equal(looksLikeEmail("hello@medspa.example"), true);
});

test("needsEmailEnrichment only for NEEDS_CONTACT_INFORMATION gaps", () => {
  const gap = base({ contacts: [] });
  assert.equal(evaluateContactability(gap).status, "NEEDS_CONTACT_INFORMATION");
  assert.equal(needsEmailEnrichment(gap), true);

  const ready = base({
    contacts: [{
      name: "Pat",
      title: "Owner",
      email: "pat@medspa.example",
      email_status: "verified",
      profile_url: "",
      source: "site",
      last_verified: "",
    }],
  });
  assert.equal(needsEmailEnrichment(ready), false);
});

test("extractStoredPublicEmail reads website finding only — never invents", () => {
  const p = base({
    findings: [{
      id: "mailto_link",
      result: "Contact: hello@medspa.example",
      status: "VERIFIED",
      source: "website HTML",
    }],
  });
  const hit = extractStoredPublicEmail(p);
  assert.ok(hit);
  assert.equal(hit!.email, "hello@medspa.example");
  assert.equal(hit!.source, "website_finding");
});

test("extractStoredPublicEmail ignores LinkedIn findings", () => {
  const p = base({
    findings: [{
      id: "linkedin_email",
      result: "scraped@linkedin.example",
      status: "OBSERVED",
      source: "linkedin scrape",
    }],
  });
  assert.equal(extractStoredPublicEmail(p), null);
});

test("planEmailEnrichAttempt marks unresolved after max attempts", () => {
  const p = base({ contacts: [], findings: [] });
  const plan = planEmailEnrichAttempt(p, 2, 3);
  assert.equal(plan.hit, null);
  assert.equal(plan.unresolved, true);
  assert.equal(plan.attemptsAfter, 3);
  assert.match(plan.note, /will not invent/i);
});

test("applyEmailHit attaches email without inventing extras", () => {
  const p = base({
    findings: [{
      id: "contact_email",
      result: "owner@medspa.example",
      status: "VERIFIED",
      source: "contact page",
    }],
  });
  const hit = extractStoredPublicEmail(p)!;
  const next = applyEmailHit(p, hit);
  assert.ok(usefulEmail(next));
  assert.equal(usefulEmail(next)!.value, "owner@medspa.example");
  assert.equal(evaluateContactability(next).status, "CONTACTABLE");
});
