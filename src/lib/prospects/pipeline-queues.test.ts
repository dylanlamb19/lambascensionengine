import assert from "node:assert/strict";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import {
  assignQueue,
  defaultActivePipelineFilter,
  filterForQueue,
  matchesQueue,
  needsDylan,
  queueFromFilterable,
} from "./pipeline-queues.ts";
import { fromProspect } from "./view-filter.ts";

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

test("default active filter hides test/demo and sets ACTIVE queue", () => {
  const f = defaultActivePipelineFilter();
  assert.equal(f.excludeTest, true);
  assert.equal(f.excludeDemo, true);
  assert.equal(f.queue, "ACTIVE_PIPELINE");
});

test("needs contact info goes to secondary queue", () => {
  const p = base({ contacts: [] });
  assert.equal(assignQueue(p), "NEEDS_CONTACT_INFORMATION");
  const row = fromProspect(p);
  assert.equal(matchesQueue(row, "NEEDS_CONTACT_INFORMATION", p), true);
  assert.equal(matchesQueue(row, "ACTIVE_PIPELINE", p), false);
});

test("email-ready New lands in active pipeline, not Needs Dylan", () => {
  const p = base({
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  assert.equal(assignQueue(p), "ACTIVE_PIPELINE");
  assert.equal(needsDylan(p), false);
  const row = fromProspect(p);
  assert.equal(matchesQueue(row, "ACTIVE_PIPELINE", p), true);
  assert.equal(matchesQueue(row, "NEEDS_DYLAN", p), false);
});

test("replied needs Dylan and still matches Active Pipeline", () => {
  const p = base({
    stage: "Replied",
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  assert.equal(assignQueue(p), "NEEDS_DYLAN");
  const row = fromProspect(p);
  assert.equal(matchesQueue(row, "NEEDS_DYLAN", p), true);
  assert.equal(matchesQueue(row, "ACTIVE_PIPELINE", p), true);
});

test("filterForQueue replace semantics", () => {
  const f = filterForQueue("NEEDS_RESEARCH");
  assert.equal(f.queue, "NEEDS_RESEARCH");
  assert.equal(f.replace, true);
});

test("Approved for Outreach without email is not an active pipeline card", () => {
  const p = base({ stage: "Approved for Outreach", stage_plain: "Ready for you to send a note", contacts: [] });
  assert.equal(assignQueue(p), "NEEDS_CONTACT_INFORMATION");
  const row = fromProspect(p);
  assert.equal(row.reach, "NEEDS_CONTACT_INFO");
  assert.equal(matchesQueue(row, "ACTIVE_PIPELINE", p), false);
  assert.equal(matchesQueue(row, "NEEDS_CONTACT_INFORMATION", p), true);
  assert.equal(queueFromFilterable(row), "NEEDS_CONTACT_INFORMATION");
});

test("Approved for Outreach with a usable email stays on the active pipeline", () => {
  const p = base({
    stage: "Approved for Outreach",
    contacts: [{ name: "Pat", title: "Owner", email: "pat@acme.example", email_status: "verified", profile_url: "", source: "x", last_verified: "" }],
  });
  assert.equal(assignQueue(p), "ACTIVE_PIPELINE");
  const row = fromProspect(p);
  assert.equal(matchesQueue(row, "ACTIVE_PIPELINE", p), true);
  assert.equal(queueFromFilterable(row), "ACTIVE_PIPELINE");
});

test("Contacted and Call Booked stay on the pipeline without a fresh email", () => {
  const contacted = base({ stage: "Contacted", contacts: [] });
  assert.equal(assignQueue(contacted), "ACTIVE_PIPELINE");
  const contactedRow = fromProspect(contacted);
  assert.equal(matchesQueue(contactedRow, "ACTIVE_PIPELINE", contacted), true);
  assert.equal(queueFromFilterable(contactedRow), "ACTIVE_PIPELINE");

  const booked = base({ stage: "Call Booked", contacts: [] });
  assert.equal(assignQueue(booked), "NEEDS_DYLAN");
  const bookedRow = fromProspect(booked);
  assert.equal(matchesQueue(bookedRow, "NEEDS_DYLAN", booked), true);
  assert.equal(matchesQueue(bookedRow, "ACTIVE_PIPELINE", booked), true);
  assert.equal(needsDylan(booked), true);
});
