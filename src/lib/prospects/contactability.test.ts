import assert from "node:assert/strict";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import {
  admitToActivePipeline,
  evaluateContactability,
  reachKindFromContactability,
  routeOffEarlyPipeline,
  routeQualifiedWithoutEmail,
} from "./contactability.ts";
import { reachKind } from "./reach.ts";
import { evaluateContactabilityInvariants } from "../sentinel/contactability-check.ts";
import { TEST_RECORD_NAME, TEST_WORKFLOW_UID, testRunUid } from "../mail/test-loop.ts";

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
  assert.equal(c.status, "BLOCKED");
  assert.equal(c.isRealProspect, false);
  assert.equal(reachKind(p), "BLOCKED");
});

test("TEST outreach verification agrees: reach and contactability are both BLOCKED", () => {
  const email = {
    name: "Dylan",
    title: "Owner",
    email: "dylan@example.com",
    email_status: "verified" as const,
    profile_url: "",
    source: "test",
    last_verified: "2026-09-22",
  };
  const rows = [
    base({ uid: TEST_WORKFLOW_UID, name: TEST_RECORD_NAME, contacts: [email] }),
    base({ uid: testRunUid("abc123"), name: TEST_RECORD_NAME, contacts: [email] }),
  ];
  for (const row of rows) {
    assert.equal(reachKind(row), "BLOCKED");
    assert.equal(evaluateContactability(row).status, "BLOCKED");
  }
  const findings = evaluateContactabilityInvariants(rows);
  assert.equal(findings.length, 0);
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

const emailContact = {
  name: "Pat Owner",
  title: "Owner",
  email: "pat@acme.example",
  email_status: "verified" as const,
  profile_url: "",
  source: "contact page",
  last_verified: "2026-09-22",
};

test("admit to Approved for Outreach requires READY TO CONTACT", () => {
  const phoneOnly = base({ stage: "Qualified", contacts: [] });
  const refused = admitToActivePipeline(phoneOnly, "Approved for Outreach");
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /email/i);

  const ready = base({ stage: "Qualified", contacts: [emailContact] });
  const allowed = admitToActivePipeline(ready, "Approved for Outreach");
  assert.equal(allowed.allowed, true);
  assert.equal(evaluateContactability(ready).status, "CONTACTABLE");
  assert.equal(evaluateContactability(ready).ownerLabel, "READY TO CONTACT");
});

test("admit refuses a new Contacted row without email and allows one with email", () => {
  const refused = admitToActivePipeline(base({ stage: "New", contacts: [] }), "Contacted");
  assert.equal(refused.allowed, false);
  const allowed = admitToActivePipeline(base({ stage: "New", contacts: [emailContact] }), "Contacted");
  assert.equal(allowed.allowed, true);
});

test("Test Mode workflow records keep pipeline admission", () => {
  const testRow = base({
    uid: TEST_WORKFLOW_UID,
    name: TEST_RECORD_NAME,
    stage: "New",
    contacts: [],
  });
  const gate = admitToActivePipeline(testRow, "Approved for Outreach");
  assert.equal(gate.allowed, true);
  const stayed = routeOffEarlyPipeline({ ...testRow, stage: "Approved for Outreach" });
  assert.equal(stayed.changed, false);
  assert.equal(stayed.prospect.stage, "Approved for Outreach");
});

test("booking repair and mid-deal moves stay admitted without a new email", () => {
  const thin = base({ stage: "New", contacts: [], phone: "UNKNOWN", website: "UNKNOWN", research_status: "none" });
  const repair = admitToActivePipeline(thin, "Call Booked", { fromStage: "New", bookingRepair: true });
  assert.equal(repair.allowed, true);
  const progress = admitToActivePipeline(
    { ...thin, stage: "Contacted" },
    "Negotiation",
    { fromStage: "Contacted" },
  );
  assert.equal(progress.allowed, true);
});

test("routeOffEarlyPipeline moves Approved for Outreach without email off the pipeline", () => {
  const needsContact = base({ stage: "Approved for Outreach", stage_plain: "Ready for you to send a note", contacts: [] });
  const routed = routeOffEarlyPipeline(needsContact);
  assert.equal(routed.changed, true);
  assert.equal(routed.queue, "NEEDS_CONTACT_INFORMATION");
  assert.equal(routed.prospect.stage, "Qualified");
  assert.equal(routed.prospect.phone, needsContact.phone);
  assert.equal(routed.prospect.contacts, needsContact.contacts);

  const needsResearch = base({
    stage: "Approved for Outreach",
    contacts: [],
    phone: "UNKNOWN",
    website: "UNKNOWN",
    research_status: "none",
    findings: [],
  });
  const researched = routeOffEarlyPipeline(needsResearch);
  assert.equal(researched.queue, "NEEDS_RESEARCH");
  assert.equal(researched.prospect.stage, "Researching");
});

test("routeOffEarlyPipeline preserves booked and later deals and ready approvals", () => {
  for (const stage of ["Contacted", "Replied", "Call Booked", "Proposal Sent", "Negotiation"] as const) {
    const deal = routeOffEarlyPipeline(base({ stage, contacts: [] }));
    assert.equal(deal.changed, false);
    assert.equal(deal.prospect.stage, stage);
  }
  const ready = routeOffEarlyPipeline(base({ stage: "Approved for Outreach", contacts: [emailContact] }));
  assert.equal(ready.changed, false);
  assert.equal(ready.prospect.stage, "Approved for Outreach");
  const demo = routeOffEarlyPipeline(base({ stage: "Approved for Outreach", is_demo: true, contacts: [] }));
  assert.equal(demo.changed, false);
  assert.equal(demo.prospect.stage, "Approved for Outreach");
});

test("routeOffEarlyPipeline leaves blank and Booked stages for booking repair", () => {
  const blank = routeOffEarlyPipeline(base({ stage: "", contacts: [] }));
  assert.equal(blank.changed, false);
  assert.equal(blank.prospect.stage, "");
  const alias = routeOffEarlyPipeline(base({ stage: "Booked", contacts: [] }));
  assert.equal(alias.changed, false);
  assert.equal(alias.prospect.stage, "Booked");
});

test("label sync: queued research with listing phone or website matches contactability", () => {
  const withSite = base({
    research_status: "queued",
    website: "https://medspa.example",
    phone: "",
    contacts: [],
  });
  const withPhone = base({
    research_status: "queued",
    website: "",
    phone: "(512) 555-0199",
    contacts: [],
  });
  for (const p of [withSite, withPhone]) {
    const c = evaluateContactability(p);
    assert.equal(c.status, "NEEDS_CONTACT_INFORMATION");
    assert.equal(reachKind(p), "NEEDS_CONTACT_INFO");
    assert.equal(reachKind(p), reachKindFromContactability(c.status));
  }
});

test("label sync: named people, incomplete research, no phone or website match", () => {
  const p = base({
    website: "",
    phone: "",
    research_status: "none",
    contacts: [{ name: "Alex Owner", title: "Owner", email: "", email_status: "none", profile_url: "", source: "listing", last_verified: "" }],
  });
  const c = evaluateContactability(p);
  assert.equal(c.status, "NEEDS_CONTACT_INFORMATION");
  assert.equal(reachKind(p), "NEEDS_CONTACT_INFO");
  assert.equal(reachKind(p), reachKindFromContactability(c.status));
});

test("label sync: demo and test rows with email are BLOCKED for both classifiers", () => {
  const email = {
    name: "Pat",
    title: "Owner",
    email: "pat@acme.example",
    email_status: "verified" as const,
    profile_url: "",
    source: "x",
    last_verified: "",
  };
  const rows = [
    base({ is_demo: true, contacts: [email] }),
    base({ uid: TEST_WORKFLOW_UID, name: TEST_RECORD_NAME, contacts: [email] }),
    base({ uid: testRunUid("label-sync"), name: TEST_RECORD_NAME, contacts: [email] }),
  ];
  for (const p of rows) {
    const c = evaluateContactability(p);
    assert.equal(c.status, "BLOCKED");
    assert.equal(reachKind(p), "BLOCKED");
    assert.notEqual(reachKind(p), "READY_TO_CONTACT");
  }
  assert.equal(evaluateContactabilityInvariants(rows).length, 0);
});

test("reachKind always equals reachKindFromContactability(evaluateContactability.status)", () => {
  const email = { name: "Pat", title: "Owner", email: "a@b.co", email_status: "verified" as const, profile_url: "", source: "x", last_verified: "" };
  const samples = [
    base({ contacts: [] }),
    base({ research_status: "queued", contacts: [] }),
    base({ research_status: "queued", website: "", phone: "(512) 555-0100", contacts: [] }),
    base({ website: "", phone: "", research_status: "none", contacts: [{ name: "Sam", title: "Owner", email: "", email_status: "none", profile_url: "", source: "x", last_verified: "" }] }),
    base({ suppressed: true, contacts: [email] }),
    base({ is_demo: true, contacts: [email] }),
    base({ uid: TEST_WORKFLOW_UID, name: TEST_RECORD_NAME, contacts: [email] }),
    base({ contacts: [email] }),
  ];
  for (const p of samples) {
    const c = evaluateContactability(p);
    assert.equal(reachKind(p), reachKindFromContactability(c.status), `${p.name}/${p.research_status}/${c.status}`);
  }
  assert.equal(evaluateContactabilityInvariants(samples).filter((f) => f.code === "CONTACTABILITY_MISMATCH").length, 0);
});
