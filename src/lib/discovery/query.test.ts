import assert from "node:assert/strict";
import test from "node:test";
import {
  discoveryCacheKey,
  dropClosedPlaces,
  parseFindQuery,
  rankPlaceHits,
  usefulnessScore,
  useLocationBias,
} from "./query.ts";
import type { PlaceHit } from "./places.ts";

function hit(partial: Partial<PlaceHit> & { provider_place_id: string; name: string }): PlaceHit {
  return {
    provider: "google_places",
    source_url: "https://maps.google.com/?cid=1",
    website: "UNKNOWN",
    phone: "UNKNOWN",
    address: "UNKNOWN",
    city: "Fort Worth",
    state: "TX",
    google_rating: "UNKNOWN",
    review_count: 0,
    category: "UNKNOWN",
    lat: 0,
    lng: 0,
    vertical: "Roofing",
    job_value_est: 15000,
    business_status: "OPERATIONAL",
    ...partial,
  };
}

test("Roofing companies in Fort Worth, Texas parses to Roofing + Fort Worth", () => {
  const q = parseFindQuery({ vertical: "Roofing companies in Fort Worth, Texas", location: "" });
  assert.equal(q.vertical, "Roofing");
  assert.match(q.location, /Fort Worth/i);
  assert.match(q.textQuery, /roofing contractor in Fort Worth/i);
});

test("roofers Fort Worth via separate fields still maps to Roofing", () => {
  const q = parseFindQuery({ vertical: "roofers", location: "Fort Worth, Texas" });
  assert.equal(q.vertical, "Roofing");
  assert.equal(q.location, "Fort Worth, Texas");
});

test("overlapping roofers vs roofing companies share a cache key", () => {
  const a = parseFindQuery({ vertical: "roofers", location: "Fort Worth" });
  const b = parseFindQuery({ vertical: "roofing companies", location: "Fort Worth" });
  assert.equal(a.vertical, b.vertical);
  assert.equal(
    discoveryCacheKey({ vertical: a.vertical, location: a.location, limit: 5, radiusM: 40000, minRating: 0, textQuery: a.textQuery }),
    discoveryCacheKey({ vertical: b.vertical, location: b.location, limit: 5, radiusM: 40000, minRating: 0, textQuery: b.textQuery }),
  );
});

test("Texas-only search does not use a tight location bias", () => {
  assert.equal(useLocationBias("Texas"), false);
  assert.equal(useLocationBias("Fort Worth, Texas"), true);
});

test("closed-permanently listings are dropped; low reviews are kept", () => {
  const rows = dropClosedPlaces([
    hit({ provider_place_id: "ChA", name: "Open Co", review_count: 3, website: "https://open.com" }),
    hit({ provider_place_id: "ChB", name: "Gone Co", business_status: "CLOSED_PERMANENTLY", review_count: 400 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider_place_id, "ChA");
});

test("usefulness prefers website + operational over review volume alone", () => {
  const thin = hit({ provider_place_id: "Ch1", name: "Busy", review_count: 200, website: "UNKNOWN" });
  const useful = hit({
    provider_place_id: "Ch2",
    name: "Real Site",
    review_count: 8,
    website: "https://realsite.com",
    phone: "(817) 555-0100",
  });
  assert.ok(usefulnessScore(useful) > usefulnessScore(thin));
  const ranked = rankPlaceHits([thin, useful]);
  assert.equal(ranked[0].provider_place_id, "Ch2");
});

test("Other free-text is the query, not the generic word company", () => {
  const q = parseFindQuery({ vertical: "commercial kitchen installers", location: "Dallas" });
  assert.equal(q.vertical, "Other");
  assert.match(q.textQuery, /commercial kitchen installers in Dallas/i);
  assert.doesNotMatch(q.textQuery, /^company in /i);
});
