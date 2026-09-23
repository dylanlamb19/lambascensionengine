import assert from "node:assert/strict";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import {
  buildTailoredOutreach,
  draftsArePersonalized,
  planReachOutToAll,
} from "./reach-out-all.ts";

function base(over: Partial<Prospect> & { uid: string; name: string }): Prospect {
  return {
    id: 1,
    uid: over.uid,
    name: over.name,
    vertical: over.vertical || "dental",
    city: over.city || "Dallas",
    website: over.website || "https://example.com",
    phone: over.phone || "UNKNOWN",
    review_count: over.review_count ?? 12,
    google_rating: over.google_rating || "4.6",
    job_value_est: 0,
    score: 50,
    fit: over.fit || "strong",
    fit_plain: "",
    stage: over.stage || "Qualified",
    stage_plain: "",
    research_status: over.research_status || "complete",
    findings: [],
    contacts: over.contacts || [],
    is_demo: over.is_demo,
    suppressed: over.suppressed,
    readiness: over.readiness || "STRONG CANDIDATE FOR FURTHER QUALIFICATION",
  };
}

const emailContact = (email: string, name = "Sam Owner") => [{
  name,
  title: "Owner",
  email,
  email_status: "verified" as const,
  profile_url: "",
  source: "site",
  last_verified: "",
}];

test("buildTailoredOutreach requires EMAIL contactable and uses real facts only", () => {
  const p = base({
    uid: "a1",
    name: "Acme Dental",
    city: "Austin",
    review_count: 90,
    contacts: emailContact("sam@acme.example"),
  });
  const d = buildTailoredOutreach(p);
  assert.ok(d);
  assert.equal(d!.recipient, "sam@acme.example");
  assert.match(d!.body, /Acme Dental/);
  assert.equal(/ROAS|\$\d|revenue|lead count/i.test(d!.body), false);
  assert.match(d!.subject, /Acme Dental/);
});

test("buildTailoredOutreach skips phone-only / no email", () => {
  const p = base({
    uid: "a2",
    name: "Phone Only",
    phone: "(512) 555-0100",
    contacts: [],
  });
  assert.equal(buildTailoredOutreach(p), null);
});

test("planReachOutToAll is EMAIL-only, soft-caps, personalized, Test Mode flags", () => {
  const prospects = [
    base({ uid: "b1", name: "Alpha Spa", city: "Austin", review_count: 100, contacts: emailContact("a@alpha.example", "Alex") }),
    base({ uid: "b2", name: "Beta Dental", city: "Dallas", review_count: 5, website: "https://beta.example", contacts: emailContact("b@beta.example", "Bea") }),
    base({ uid: "b3", name: "No Mail LLC", contacts: [] }),
    base({ uid: "b4", name: "Demo Co", is_demo: true, contacts: emailContact("d@demo.example") }),
  ];
  const plan = planReachOutToAll(prospects, 15);
  assert.equal(plan.testModeOnly, true);
  assert.equal(plan.liveEnabled, false);
  assert.equal(plan.eligible.length, 2);
  assert.ok(plan.skipped.length >= 2);
  assert.equal(draftsArePersonalized(plan.eligible), true);
  assert.equal(new Set(plan.eligible.map((d) => d.body)).size, 2);
});

test("planReachOutToAll soft-caps and marks truncated", () => {
  const prospects = Array.from({ length: 5 }, (_, i) =>
    base({
      uid: `c${i}`,
      name: `Shop ${i}`,
      city: `City${i}`,
      review_count: 10 + i * 20,
      contacts: emailContact(`s${i}@shop.example`, `Person ${i}`),
    }),
  );
  const plan = planReachOutToAll(prospects, 2);
  assert.equal(plan.eligible.length, 2);
  assert.equal(plan.truncated, true);
  assert.equal(plan.softCap, 2);
});
