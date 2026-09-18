import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Prospect } from "../review-brief.ts";
import { importWithoutDuplicates, matchExisting, mergeProspect } from "./dedupe.ts";
import { websiteDomain } from "./ids.ts";

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
  assert.equal(afterB?.stage, "Approved for Outreach");
  assert.equal(afterB?.uid, "company-b");
});

test("dedupe never locates a merge row by numeric id", () => {
  const src = readFileSync(new URL("./dedupe.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /e\.id === hit\.id/);
  assert.match(src, /e\.uid === hit\.uid/);
});
