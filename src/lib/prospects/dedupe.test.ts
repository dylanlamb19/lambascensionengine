import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import { importWithoutDuplicates, matchExisting, matchProspectsBySpokenName, mergeProspect } from "./dedupe.ts";
import { prospectProfileSearch, prospectProfileUrl, websiteDomain } from "./ids.ts";

function p(partial: Partial<Prospect> & { name: string }): Prospect {
  return {
    id: partial.id ?? 1,
    uid: partial.uid,
    provider_place_id: partial.provider_place_id,
    name: partial.name,
    vertical: partial.vertical || "Roofing",
    city: partial.city || "Dallas",
    website: partial.website || "",
    review_count: partial.review_count ?? 0,
    google_rating: partial.google_rating || "UNKNOWN",
    phone: partial.phone || "UNKNOWN",
    job_value_est: 0,
    score: partial.score ?? 50,
    fit: "possible",
    fit_plain: "Possible",
    stage: partial.stage || "New",
    stage_plain: partial.stage_plain || "Just added",
    research_status: partial.research_status || "none",
    findings: partial.findings || [],
    facts: partial.facts,
    outreach: partial.outreach,
    suppressed: partial.suppressed,
    history: partial.history,
    contacts: partial.contacts,
    readiness: partial.readiness,
    readiness_why: partial.readiness_why,
  };
}

test("duplicate migration does not duplicate by uid, place id, or website+city", () => {
  const a = p({ id: 1, uid: "u1", name: "Acme Roofing", website: "https://acme.com", city: "Dallas" });
  const again = p({ id: 99, uid: "u1", name: "Acme Roofing", website: "https://www.acme.com", city: "Dallas" });
  const { next, imported } = importWithoutDuplicates([a], [again]);
  assert.equal(next.length, 1);
  assert.equal(imported.length, 0);
  const byPlace = importWithoutDuplicates(
    [p({ id: 1, uid: "a", provider_place_id: "Ch1", name: "Place Co", city: "Austin" })],
    [p({ id: 2, uid: "b", provider_place_id: "Ch1", name: "Place Co", city: "Austin" })],
  );
  assert.equal(byPlace.next.length, 1);
});

test("merge keeps DNC and richer research", () => {
  const server = p({
    id: 1, uid: "u1", name: "Acme", stage: "Do Not Contact", suppressed: true,
    research_status: "complete", findings: [{ id: "https", result: "HTTPS", status: "VERIFIED" }],
  });
  const incoming = p({ id: 1, uid: "u1", name: "Acme", stage: "New", research_status: "queued" });
  const m = mergeProspect(server, incoming);
  assert.equal(m.stage, "Do Not Contact");
  assert.equal(m.suppressed, true);
  assert.equal(m.research_status, "complete");
});

test("website domain strips www", () => {
  assert.equal(websiteDomain("https://www.Acme.com/path"), "acme.com");
});

test("matchExisting does not invent a match across cities", () => {
  const hit = matchExisting(
    [p({ name: "Acme", city: "Dallas", website: "https://acme.com" })],
    p({ name: "Acme", city: "Houston", website: "https://other.com" }),
  );
  assert.equal(hit, undefined);
});

test("colliding numeric id 7 does not merge the wrong company — UID wins", () => {
  const a = p({ uid: "company-a", id: 7, name: "Dallas Roof Co", city: "Dallas", stage: "New" });
  const b = p({ uid: "company-b", id: 7, name: "Fort Worth HVAC", city: "Fort Worth", stage: "New" });
  const updateB = p({
    uid: "company-b",
    id: 7,
    name: "Fort Worth HVAC",
    city: "Fort Worth",
    stage: "Approved for Outreach",
    stage_plain: "Ready for you to send a note",
  });
  const { next, imported, merged } = importWithoutDuplicates([a, b], [updateB]);
  assert.equal(next.length, 2);
  assert.equal(imported.length, 0);
  assert.equal(merged.length, 1);
  const afterA = next.find((x) => x.uid === "company-a");
  const afterB = next.find((x) => x.uid === "company-b");
  assert.equal(afterA?.name, "Dallas Roof Co");
  assert.equal(afterA?.stage, "New");
  assert.equal(afterA?.id, 7);
  assert.equal(afterB?.name, "Fort Worth HVAC");
  assert.equal(afterB?.uid, "company-b");
  assert.notEqual(afterB?.stage, "Approved for Outreach");
  assert.equal(afterB?.stage, "Researching");
});

test("import keeps Approved for Outreach when the company is READY TO CONTACT", () => {
  const ready = p({
    uid: "company-ready",
    id: 3,
    name: "Ready Dental",
    city: "Austin",
    stage: "New",
    fit: "strong",
    readiness: "STRONG CANDIDATE FOR FURTHER QUALIFICATION",
    research_status: "complete",
    contacts: [{
      name: "Pat Owner",
      title: "Owner",
      email: "pat@ready.example",
      email_status: "verified",
      profile_url: "",
      source: "contact page",
      last_verified: "2026-09-22",
    }],
  });
  const approved = p({
    ...ready,
    stage: "Approved for Outreach",
    stage_plain: "Ready for you to send a note",
  });
  const { next } = importWithoutDuplicates([ready], [approved]);
  assert.equal(next.find((x) => x.uid === "company-ready")?.stage, "Approved for Outreach");
});

test("dedupe never locates a merge row by numeric id", () => {
  const src = readFileSync(new URL("./dedupe.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /e\.id === hit\.id/);
  assert.match(src, /e\.uid === hit\.uid/);
});

test("overlapping Place ID search keeps researched why and contacts", () => {
  const server = p({
    id: 1,
    uid: "u1",
    provider_place_id: "Ch1",
    name: "Place Co",
    city: "Austin",
    research_status: "complete",
    findings: [{ id: "https", result: "HTTPS", status: "VERIFIED" }],
    facts: [{ key: "place_id", value: "Ch1", source: "Google Places", checked_at: "t", confidence: "high", status: "VERIFIED" }],
    readiness: "POSSIBLE CANDIDATE",
    readiness_why: ["Public website loaded"],
    contacts: [{
      name: "Ada Owner", title: "Owner", email: "", email_status: "none",
      profile_url: "", source: "https://place.co/about", last_verified: "t",
    }],
  });
  const incoming = p({
    id: 9,
    uid: "new",
    provider_place_id: "Ch1",
    name: "Place Co",
    city: "Austin",
    research_status: "queued",
  });
  const m = mergeProspect(server, incoming);
  assert.equal(m.uid, "u1");
  assert.equal(m.research_status, "complete");
  assert.equal(m.readiness_why?.[0], "Public website loaded");
  assert.equal(m.contacts?.[0]?.name, "Ada Owner");
});

test("spoken name match is exact/normalized, never a fuzzy single token", () => {
  const fire = p({ uid: "uid-fire", name: "Firefighter Roofing", city: "Fort Worth" });
  const fireLlc = p({ uid: "uid-fire", name: "Firefighter Roofing LLC", city: "Fort Worth" });
  const other = p({ uid: "uid-abc", name: "ABC Roofing", city: "Dallas" });
  const abc2 = p({ uid: "uid-abc2", name: "ABC Roofing", city: "Houston" });
  assert.equal(matchProspectsBySpokenName([fire, other], "Firefighter Roofing")[0]?.uid, "uid-fire");
  assert.equal(matchProspectsBySpokenName([fireLlc], "Firefighter Roofing")[0]?.uid, "uid-fire");
  assert.equal(matchProspectsBySpokenName([fire, other], "roofing").length, 0);
  assert.equal(matchProspectsBySpokenName([other, abc2], "ABC Roofing").length, 2);
  assert.equal(matchProspectsBySpokenName([fire], "uid-fire")[0]?.uid, "uid-fire");
  assert.equal(prospectProfileSearch("uid-fire"), "/?p=uid-fire");
  assert.equal(
    prospectProfileUrl("https://lamb-ascension-engine.vercel.app", "uid-fire"),
    "https://lamb-ascension-engine.vercel.app/?p=uid-fire",
  );
});
