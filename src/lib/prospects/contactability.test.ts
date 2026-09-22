import assert from "node:assert/strict";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import { evaluateContactability, routeQualifiedWithoutEmail } from "./contactability.ts";
import { reachKind } from "./reach.ts";

function base(partial: Partial<Prospect> = {}): Prospect {
  return {
    id: 1,
    uid: "p1",
    name: "Acme Dental",
    vertical: "Dental",
    city: "Austin",
    website: "https://acme.example",
    review_count: 40,
    google_rating: "4.8",
    phone: "(512) 555-0100",
    job_value_est: 0,
    score: 72,
    fit: "strong",
    fit_plain: "Good fit",
    stage: "New",
    stage_plain: "Just added",
    research_status: "complete",
    findings: [],
    readiness: "STRONG CANDIDATE FOR FURTHER QUALIFICATION",
    ...partial,
  };
}

test("phone alone is NOT CONTACTABLE / NOT READY_TO_CONTACT", () => {
  const p = base({
    contacts: [{ name: "Pat Owner", title: "Owner", email: "", email_status: "none", profile_url: "", source: "listing", last_verified: "" }],
  });
  assert.equal(reachKind(p), "NEEDS_CONTACT_INFO");
  const c = evaluateContactability(p);
  assert.equal(c.status, "NEEDS_CONTACT_INFORMATION");
  assert.equal(c.contactable, false);
  assert.equal(c.ownerLabel, "NEEDS CONTACT INFORMATION");
});

test("usable email + qual => CONTACTABLE", () => {
  const p = base({
    contacts: [{
      name: "Pat Owner",
      title: "Owner",
      email: "pat@acme.example",
      email_status: "verified",
      profile_url: "",
      source: "contact page",
      last_verified: "2026-09-22",
    }],
  });
  assert.equal(reachKind(p), "READY_TO_CONTACT");
  const c = evaluateContactability(p);
  assert.equal(c.status, "CONTACTABLE");
  assert.equal(c.contactable, true);
  assert.equal(c.ownerLabel, "READY TO CONTACT");
});

test("owner-provided email is OWNER PROVIDED and contactable, not VERIFIED", () => {
  const p = base({
    contacts: [{
      name: "Pat Owner",
      title: "Owner",
      email: "pat@acme.example",
      email_status: "unverified",
      email_source: "OWNER PROVIDED",
      profile_url: "",
      source: "OWNER PROVIDED",
      last_verified: "",
    }],
  });
  const c = evaluateContactability(p);
  assert.equal(c.contactable, true);
  assert.equal(c.emailProvenance, "OWNER PROVIDED");
  assert.ok(c.reasons.some((r) => /OWNER PROVIDED/i.test(r)));
});

test("suppressed is SUPPRESSED not CONTACTABLE", () => {
  const p = base({
    suppressed: true,
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  assert.equal(reachKind(p), "SUPPRESSED");
  assert.equal(evaluateContactability(p).status, "SUPPRESSED");
  assert.equal(evaluateContactability(p).contactable, false);
});

test("demo is not autonomously contactable", () => {
  const p = base({
    is_demo: true,
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  const c = evaluateContactability(p);
  assert.equal(c.contactable, false);
  assert.equal(c.isRealProspect, false);
});

test("hard bounce suppresses contactability", () => {
  const p = base({
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  const c = evaluateContactability(p, { hardBounced: true });
  assert.equal(c.status, "SUPPRESSED");
  assert.equal(c.contactable, false);
});

test("cooldown blocks contactable flag", () => {
  const p = base({
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  const future = new Date(Date.now() + 60_000).toISOString();
  const c = evaluateContactability(p, { cooldownUntil: future });
  assert.equal(c.status, "CONTACTABLE");
  assert.equal(c.contactable, false);
  assert.ok(c.blockers.includes("cooldown"));
});

test("Part 3 routeQualifiedWithoutEmail", () => {
  const p = base({ contacts: [] });
  const r = routeQualifiedWithoutEmail(p);
  assert.equal(r.queue, "NEEDS_CONTACT_INFORMATION");
});
